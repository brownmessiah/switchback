import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { walletBalances } from '@/db/schema/wallet-balances'
import {
  _setRazorpayClientForTests,
  _resetRazorpayClientForTests,
  type RazorpaySdkLike,
} from '@/lib/payments/razorpay-client'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { executeStartCheckout, type StartCheckoutInput } from './actions'

function makeStubRazorpay(
  overrides: Partial<RazorpaySdkLike> = {},
): RazorpaySdkLike {
  return {
    orders: {
      create: async (params) => ({
        id: `order_stub_${Date.now()}`,
        amount: params.amount,
        currency: params.currency,
        receipt: null,
        status: 'created' as const,
      }),
      ...overrides.orders,
    },
    payments: {
      capture: async () => ({
        id: 'pay_stub',
        amount: 0,
        status: 'captured',
        captured: true,
      }),
      refund: async () => ({
        id: 'rfnd_stub',
        amount: 0,
        payment_id: 'pay_stub',
        status: 'pending' as const,
      }),
      ...overrides.payments,
    },
  }
}

describe('executeStartCheckout (Task 20)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let slotId: string
  let experienceId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_customer', email: 'cust@test.com' },
      { id: 'u_vendor', email: 'vendor@test.com' },
    ])
    await db.insert(vendorProfiles).values({
      userId: 'u_vendor',
      businessName: 'Test Adventures',
      slug: 'test-adventures',
      pan: 'ABCDE1234F',
    })
  })

  afterAll(async () => {
    _resetRazorpayClientForTests()
    await teardown()
  })

  beforeEach(async () => {
    _resetRazorpayClientForTests()
    _setRazorpayClientForTests(makeStubRazorpay())
    await db.execute(sql`TRUNCATE TABLE audit_logs CASCADE`)
    await db.execute(sql`TRUNCATE TABLE wallet_balances CASCADE`)
    await db.execute(sql`TRUNCATE TABLE bookings CASCADE`)
    await db.execute(sql`TRUNCATE TABLE availability_slots CASCADE`)
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)

    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_vendor',
        slug: 'test-rafting',
        title: 'Test Rafting',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront', 'partial_pay'],
        pricePerPerson_1_2: '2000.00',
        pricePerPerson_3_5: '1800.00',
        pricePerPerson_6_plus: '1500.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'published',
      })
      .returning({ id: experiences.id })
    experienceId = exp!.id

    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId,
        startAt: futureDate,
        endAt: new Date(futureDate.getTime() + 4 * 60 * 60 * 1000),
        capacity: 10,
        capacityTaken: 0,
        status: 'open',
      })
      .returning({ id: availabilitySlots.id })
    slotId = slot!.id
  })

  function makeInput(overrides: Partial<StartCheckoutInput> = {}): StartCheckoutInput {
    return {
      customerUserId: 'u_customer',
      experienceId,
      slotId,
      participantCount: 2,
      paymentMode: 'full_upfront',
      acknowledgedPermits: false,
      idempotencyKey: crypto.randomUUID(),
      ...overrides,
    }
  }

  // ---- Happy path: creates booking + razorpay order ----
  it('returns bookingId and orderId on successful checkout', async () => {
    const result = await executeStartCheckout(db, makeInput())

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.bookingId).toBeTruthy()
    expect(result.orderId).toBeTruthy()
    expect(result.amountRupees).toBe(4000)
    expect(typeof result.keyId).toBe('string')
  })

  // ---- Wallet applied: reduces Razorpay remainder ----
  it('applies wallet balances and reduces Razorpay remainder', async () => {
    await db.insert(walletBalances).values([
      { userId: 'u_customer', balanceType: 'outvers_credit', amount: '500.00' },
      { userId: 'u_customer', balanceType: 'refund_balance', amount: '300.00' },
    ])

    const result = await executeStartCheckout(db, makeInput())

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.amountRupees).toBe(3200)
    expect(result.walletApplied.outversCreditAppliedRupees).toBe(500)
    expect(result.walletApplied.refundBalanceAppliedRupees).toBe(300)
  })

  // ---- Wallet covers full gross → razorpay remainder = 0, no order created ----
  it('skips Razorpay order creation when wallet covers full gross', async () => {
    await db.insert(walletBalances).values([
      { userId: 'u_customer', balanceType: 'outvers_credit', amount: '5000.00' },
    ])

    const result = await executeStartCheckout(db, makeInput())

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.amountRupees).toBe(0)
    expect(result.orderId).toBeNull()
  })

  // ---- Razorpay order failure rolls back booking ----
  it('returns error when Razorpay order creation fails', async () => {
    _resetRazorpayClientForTests()
    _setRazorpayClientForTests(
      makeStubRazorpay({
        orders: {
          create: async () => {
            throw Object.assign(new Error('Bad request'), {
              statusCode: 400,
              error: { code: 'BAD_REQUEST_ERROR', description: 'invalid amount' },
            })
          },
        },
      }),
    )

    const result = await executeStartCheckout(db, makeInput())
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('payment_failed')
  })

  // ---- RNPL rejected ----
  it('rejects reserve_now_pay_later with clear error', async () => {
    const result = await executeStartCheckout(
      db,
      makeInput({ paymentMode: 'reserve_now_pay_later' }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('rnpl_deferred')
  })
})
