import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiencePricingVariations } from '@/db/schema/experience-pricing-variations'
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
      // Business-verified (ADR-0007 Tier 3, unrestricted) — the seeded slot
      // holds capacity 10, above the Tier-2 per-slot cap, so the
      // booking-create tier re-check requires the unrestricted tier.
      kycTier: 'business',
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

    // Reset the vendor to business tier each test (vendor_profiles is not
    // truncated) so a tier-cap test that downgrades it cannot leak into later
    // tests if it throws before its inline restore.
    await db
      .update(vendorProfiles)
      .set({ kycTier: 'business' })
      .where(eq(vendorProfiles.userId, 'u_vendor'))

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

  // ---- Trip-group seat guard (ADR-0009 / #20) ----
  it('rejects a group-tagged checkout when the member cannot book that group', async () => {
    // A non-existent / ineligible group → assertCanBookForGroup throws, mapped
    // to a specific error BEFORE any Booking is created (money-path safety).
    const result = await executeStartCheckout(
      db,
      makeInput({ tripGroupId: '00000000-0000-0000-0000-000000000000' }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('trip_group_ineligible')
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

  // ---- Missing slot → specific field error, not a generic crash ----
  it('returns a specific slot field error when slotId is empty', async () => {
    const result = await executeStartCheckout(db, makeInput({ slotId: '' }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('slot_unavailable')
    expect(result.message).toMatch(/slot|date/i)
    // Must NOT leak as the generic "unexpected error" path.
    expect(result.message).not.toBe('An unexpected error occurred.')
  })

  it('returns a specific slot field error when slotId is not a uuid', async () => {
    const result = await executeStartCheckout(
      db,
      makeInput({ slotId: 'not-a-uuid' }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('slot_unavailable')
  })

  // ---- Tier-cap rejection → specific error, not generic "unknown" ----
  it('maps a tier-cap rejection to a specific error, not unknown', async () => {
    // Downgrade the vendor to identity tier and give the slot a capacity
    // above the Tier-2 per-slot cap (8) so booking-create's tier re-check
    // throws TIER_CAP_EXCEEDED.
    await db
      .update(vendorProfiles)
      .set({ kycTier: 'identity' })
      .where(eq(vendorProfiles.userId, 'u_vendor'))
    await db
      .update(availabilitySlots)
      .set({ capacity: 20 })
      .where(eq(availabilitySlots.id, slotId))

    const result = await executeStartCheckout(db, makeInput())

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('tier_cap_exceeded')
    expect(result.message).not.toBe('An unexpected error occurred.')
    // Vendor tier is reset to business in beforeEach — no inline restore needed,
    // so isolation holds even if an assertion above throws.
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

  // ---- Pricing variation threads to createBooking + snapshots its price (#08) ----
  it('snapshots the SELECTED variation price (not the bracket) end-to-end', async () => {
    // An active variation priced distinctly from every Group-size bracket.
    const [variation] = await db
      .insert(experiencePricingVariations)
      .values({
        experienceId,
        name: 'Private session',
        pricePerPerson: '3333.00',
        isActive: true,
      })
      .returning({ id: experiencePricingVariations.id })

    const result = await executeStartCheckout(
      db,
      makeInput({ participantCount: 2, variationId: variation!.id }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')

    const [bookingRow] = await db
      .select({
        snapshot: bookings.pricePerParticipantSnapshot,
        basis: bookings.pricingBasisSnapshot,
      })
      .from(bookings)
      .where(eq(bookings.id, result.bookingId))

    // The SERVER resolved + snapshotted the variation price — NOT the 1-2
    // bracket (2000) for a 2-person booking. The client never sent a price.
    expect(Number(bookingRow!.snapshot)).toBe(3333)
    expect(bookingRow!.basis).toBe(`pricing_variation:${variation!.id}`)
    // 2 participants × 3333 = 6666 → full upfront charge.
    expect(result.amountRupees).toBe(6666)
  })

  it('rejects a checkout whose variationId is INACTIVE (server guard, #08)', async () => {
    const [variation] = await db
      .insert(experiencePricingVariations)
      .values({
        experienceId,
        name: 'Retired option',
        pricePerPerson: '2500.00',
        isActive: false,
      })
      .returning({ id: experiencePricingVariations.id })

    const result = await executeStartCheckout(
      db,
      makeInput({ variationId: variation!.id }),
    )
    // resolvePricing THROWS on an inactive variation → no booking is created.
    expect(result.ok).toBe(false)
  })
})
