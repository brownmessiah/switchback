import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { carts } from '@/db/schema/carts'
import { experiences } from '@/db/schema/experiences'
import { orders } from '@/db/schema/orders'
import { payments } from '@/db/schema/payments'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { walletBalances } from '@/db/schema/wallet-balances'
import { addToCart } from '@/lib/cart/core'
import { _resetRedisCacheForTests } from '@/lib/redis'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { CartCheckoutError, executeCartCheckout } from './checkout'

/**
 * Multi-item cart checkout (home-redesign issue 12, ADR-0021) — the
 * mandatory money-path battery from ADR-0021 §Consequences:
 *
 *   - all-or-nothing rollback when one item fails (no bookings, no wallet
 *     debit, no order row; rejection audit names the item);
 *   - per-booking snapshots correct across N items (each its own gross /
 *     commission / tax — never pooled);
 *   - the FY-cumulative 194-O ₹5L threshold flips mid-cart for a
 *     same-vendor individual crossing the line at item 2;
 *   - v1 full-upfront coercion (a partial-pay-capable Experience still
 *     books full_upfront through the cart);
 *   - deterministic item ordering (created_at, then id);
 *   - wallet applied ONCE at order level in ADR-0004 order, attributable
 *     per booking via audit rows;
 *   - action-level idempotency: a replayed checkout returns the SAME order
 *     and creates nothing new;
 *   - cart cleared on success;
 *   - payments XOR CHECK `payment_scope_exactly_one` (schema level).
 */

describe('cart checkout (PGlite)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let expensiveId: string
  let cheapId: string
  let expensiveSlot: string
  let cheapSlot: string

  const DAY_MS = 24 * 60 * 60 * 1000

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_v', email: 'v@test.com', name: 'Vendor' },
      { id: 'u_cust', email: 'c@test.com', name: 'Customer' },
    ])
    await db.insert(vendorProfiles).values({
      userId: 'u_v',
      businessName: 'Cart Checkout Adventures',
      slug: 'cart-checkout-adventures',
      // Business-verified: Tier-3 caps clear the ₹3L-gross single bookings
      // the 194-O test needs.
      kycTier: 'business',
      pan: 'ABCDE1234F',
      commissionRate: '20.00',
      payoutMethod: 'upi',
      payoutDestination: { vpa: 'vendor@upi' },
      // individual → the FY-cumulative 194-O ₹5L TDS threshold applies.
      taxpayerType: 'individual',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  async function seedExperience(opts: {
    slug: string
    price: string
    maxGroupSize?: number
    partialPay?: boolean
  }): Promise<string> {
    const [row] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: opts.slug,
        title: `Exp ${opts.slug}`,
        cancellationPreset: 'flexible',
        paymentModesAllowed: opts.partialPay
          ? ['full_upfront', 'partial_pay']
          : ['full_upfront'],
        pricePerPerson_1_2: opts.price,
        pricePerPerson_3_5: opts.price,
        pricePerPerson_6_plus: opts.price,
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        maxGroupSize: opts.maxGroupSize ?? 20,
        status: 'published',
      })
      .returning({ id: experiences.id })
    return row!.id
  }

  async function seedSlot(expId: string, offsetDays: number, capacity = 20): Promise<string> {
    const startAt = new Date(Date.now() + offsetDays * DAY_MS)
    const [row] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: expId,
        startAt,
        endAt: new Date(startAt.getTime() + 4 * 3600 * 1000),
        capacity,
      })
      .returning({ id: availabilitySlots.id })
    return row!.id
  }

  const KEY = () => crypto.randomUUID()

  beforeEach(async () => {
    _resetRedisCacheForTests()
    await db.execute(
      sql`TRUNCATE TABLE payments, bookings, orders, cart_items, carts, availability_slots, experiences, wallet_balances, audit_logs CASCADE`,
    )
    // ₹150,000/person ×2 = ₹300,000 gross per booking (194-O relevant);
    // cheap = ₹1,000/person.
    expensiveId = await seedExperience({ slug: 'exp-300k', price: '150000.00', partialPay: true })
    cheapId = await seedExperience({ slug: 'exp-cheap', price: '1000.00' })
    expensiveSlot = await seedSlot(expensiveId, 10)
    cheapSlot = await seedSlot(cheapId, 11)
  })

  async function cartUp(items: Array<{ experienceId: string; slotId: string; count: number }>) {
    for (const item of items) {
      await addToCart(db, {
        customerUserId: 'u_cust',
        experienceId: item.experienceId,
        slotId: item.slotId,
        participantCount: item.count,
      })
    }
  }

  it('happy path: N bookings under one order, snapshots per booking, cart cleared, full_upfront coerced', async () => {
    await cartUp([
      { experienceId: expensiveId, slotId: expensiveSlot, count: 2 },
      { experienceId: cheapId, slotId: cheapSlot, count: 3 },
    ])

    const result = await executeCartCheckout(db, {
      customerUserId: 'u_cust',
      idempotencyKey: KEY(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.bookingIds).toHaveLength(2)
    // 2×150000 + 3×1000
    expect(result.amountTotalRupees).toBe(303_000)
    expect(result.razorpayRemainderRupees).toBe(303_000)

    const bookingRows = await db.select().from(bookings)
    expect(bookingRows).toHaveLength(2)
    for (const b of bookingRows) {
      expect(b.orderId).toBe(result.orderId)
      // v1 coercion: even the partial-pay-capable line books full upfront.
      expect(b.paymentMode).toBe('full_upfront')
      expect(b.state).toBe('confirmed')
    }
    const grosses = bookingRows.map((b) => Math.floor(Number(b.grossTotalSnapshot))).sort((a, z) => a - z)
    expect(grosses).toEqual([3_000, 300_000])

    const [orderRow] = await db.select().from(orders)
    expect(orderRow!.customerUserId).toBe('u_cust')
    expect(Math.floor(Number(orderRow!.amountTotalSnapshot))).toBe(303_000)
    expect(orderRow!.state).toBe('created')

    // Cart cleared.
    const remaining = await db.execute(sql`select count(*)::int as n from cart_items`)
    expect(Number((remaining as unknown as { rows: Array<{ n: number }> }).rows[0]!.n)).toBe(0)

    // order.create audit row present.
    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'order.create'))
    expect(audits).toHaveLength(1)
  })

  it('all-or-nothing: a sold-out item rolls back EVERYTHING + rejection audit names it', async () => {
    // cheap slot capacity 2 — the cart wants 3 → INSUFFICIENT_CAPACITY on item 2.
    const tinySlot = await seedSlot(cheapId, 12, 2)
    await cartUp([
      { experienceId: expensiveId, slotId: expensiveSlot, count: 2 },
      { experienceId: cheapId, slotId: tinySlot, count: 2 },
    ])
    // Take the capacity out from under the cart before checkout.
    await db
      .update(availabilitySlots)
      .set({ capacityTaken: 2 })
      .where(eq(availabilitySlots.id, tinySlot))
    // Wallet credit that must NOT be debited on rollback.
    await db.insert(walletBalances).values({
      userId: 'u_cust',
      balanceType: 'switchback_credit',
      amount: '500.00',
    })

    const result = await executeCartCheckout(db, {
      customerUserId: 'u_cust',
      idempotencyKey: KEY(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('ITEM_FAILED')

    expect(await db.select().from(bookings)).toHaveLength(0)
    expect(await db.select().from(orders)).toHaveLength(0)
    const [credit] = await db
      .select()
      .from(walletBalances)
      .where(eq(walletBalances.userId, 'u_cust'))
    expect(credit!.amount).toBe('500.00')
    // Cart NOT cleared on failure.
    const remaining = await db.execute(sql`select count(*)::int as n from cart_items`)
    expect(Number((remaining as unknown as { rows: Array<{ n: number }> }).rows[0]!.n)).toBe(2)

    // Rejection audit on the top-level handle names the failing item.
    const rejects = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'order.reject'))
    expect(rejects).toHaveLength(1)
    const payload = rejects[0]!.payload as { failedSlotId?: string; code?: string }
    expect(payload.failedSlotId).toBe(tinySlot)
    expect(payload.code).toBe('INSUFFICIENT_CAPACITY')
  })

  it('194-O: the ₹5L FY threshold flips mid-cart for a same-vendor individual, in CART order', async () => {
    // DISTINGUISHABLE lines from the SAME individual vendor: line 1 = ₹2.5L
    // (FY gross 2.5L < 5L, no TDS), line 2 = ₹3L (crosses to 5.5L > 5L → TDS).
    // If the code processed lines in any other order the ₹3L booking would
    // be TDS-free and the ₹2L one taxed — the assertion below pins WHICH
    // slot's booking crossed, proving the (created_at, id) ordering.
    const midId = await seedExperience({ slug: 'exp-250k', price: '125000.00' })
    const midSlot = await seedSlot(midId, 9)
    const secondSlot = await seedSlot(expensiveId, 13)
    await cartUp([
      { experienceId: midId, slotId: midSlot, count: 2 }, // ₹250,000 — added FIRST
      { experienceId: expensiveId, slotId: secondSlot, count: 2 }, // ₹300,000 — added SECOND
    ])

    const result = await executeCartCheckout(db, {
      customerUserId: 'u_cust',
      idempotencyKey: KEY(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const rows = await db
      .select({
        tds: bookings.tdsAmountSnapshot,
        gross: bookings.grossTotalSnapshot,
        slotId: bookings.slotId,
        id: bookings.id,
      })
      .from(bookings)
    expect(rows).toHaveLength(2)
    const first = rows.find((r) => r.slotId === midSlot)!
    const second = rows.find((r) => r.slotId === secondSlot)!
    // The FIRST-added (₹2L) line stays under the threshold; the
    // SECOND-added (₹3L) line crosses it. Any other processing order would
    // tax the ₹2L booking instead.
    expect(Number(first.tds)).toBe(0)
    expect(Number(second.tds)).toBeGreaterThan(0)
    expect(result.bookingIds[0]).toBe(first.id)
    expect(result.bookingIds[1]).toBe(second.id)
  })

  it('wallet applies ONCE at order level (ADR-0004 order) and is attributable per booking', async () => {
    await cartUp([
      { experienceId: cheapId, slotId: cheapSlot, count: 2 }, // 2,000
    ])
    const secondCheapSlot = await seedSlot(cheapId, 14)
    await cartUp([{ experienceId: cheapId, slotId: secondCheapSlot, count: 3 }]) // 3,000

    await db.insert(walletBalances).values([
      { userId: 'u_cust', balanceType: 'switchback_credit', amount: '1500.00' },
      { userId: 'u_cust', balanceType: 'refund_balance', amount: '2000.00' },
    ])

    const result = await executeCartCheckout(db, {
      customerUserId: 'u_cust',
      idempotencyKey: KEY(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Total 5,000: credit 1,500 → refund 2,000 → remainder 1,500.
    expect(result.amountTotalRupees).toBe(5_000)
    expect(result.walletApplied.switchbackCreditAppliedRupees).toBe(1_500)
    expect(result.walletApplied.refundBalanceAppliedRupees).toBe(2_000)
    expect(result.razorpayRemainderRupees).toBe(1_500)

    // Balances debited exactly once.
    const balances = await db
      .select()
      .from(walletBalances)
      .where(eq(walletBalances.userId, 'u_cust'))
    const byType = Object.fromEntries(balances.map((b) => [b.balanceType, b.amount]))
    expect(byType.switchback_credit).toBe('0.00')
    expect(byType.refund_balance).toBe('0.00')

    // Per-booking attribution: one wallet audit row PER booking, allocations
    // summing to the applied amounts.
    const walletAudits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'wallet.apply_to_checkout'))
    expect(walletAudits).toHaveLength(2)
    const allocations = walletAudits.map(
      (a) => a.payload as { bookingId: string; switchbackCreditAppliedRupees: number; refundBalanceAppliedRupees: number },
    )
    expect(new Set(allocations.map((a) => a.bookingId)).size).toBe(2)
    expect(
      allocations.reduce((s, a) => s + a.switchbackCreditAppliedRupees, 0),
    ).toBe(1_500)
    expect(
      allocations.reduce((s, a) => s + a.refundBalanceAppliedRupees, 0),
    ).toBe(2_000)
  })

  it('replaying the same idempotency key returns the SAME order and creates nothing new', async () => {
    await cartUp([{ experienceId: cheapId, slotId: cheapSlot, count: 2 }])
    const key = KEY()

    const first = await executeCartCheckout(db, { customerUserId: 'u_cust', idempotencyKey: key })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const replay = await executeCartCheckout(db, { customerUserId: 'u_cust', idempotencyKey: key })
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.orderId).toBe(first.orderId)
    expect(replay.replayed).toBe(true)

    expect(await db.select().from(bookings)).toHaveLength(1)
    expect(await db.select().from(orders)).toHaveLength(1)
  })

  it('an empty cart refuses with CART_EMPTY', async () => {
    const result = await executeCartCheckout(db, {
      customerUserId: 'u_cust',
      idempotencyKey: KEY(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('CART_EMPTY')
  })

  it('CartCheckoutError carries stable codes', () => {
    expect(new CartCheckoutError('CART_EMPTY').code).toBe('CART_EMPTY')
  })

  // ── Schema: payments XOR (payment_scope_exactly_one) ──────────────────

  it('payments must be booking-scoped XOR order-scoped', async () => {
    await cartUp([{ experienceId: cheapId, slotId: cheapSlot, count: 2 }])
    const result = await executeCartCheckout(db, {
      customerUserId: 'u_cust',
      idempotencyKey: KEY(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [booking] = await db.select({ id: bookings.id }).from(bookings)

    // Neither scope → rejected.
    await expect(
      db.insert(payments).values({
        razorpayPaymentId: 'pay_neither',
        amount: '100.00',
        captureTrigger: 'booking_create',
      }),
    ).rejects.toThrow()

    // Both scopes → rejected.
    await expect(
      db.insert(payments).values({
        bookingId: booking!.id,
        orderId: result.orderId,
        razorpayPaymentId: 'pay_both',
        amount: '100.00',
        captureTrigger: 'booking_create',
      }),
    ).rejects.toThrow()

    // Order-scoped only → accepted.
    await db.insert(payments).values({
      orderId: result.orderId,
      razorpayPaymentId: 'pay_order_scoped',
      amount: '100.00',
      captureTrigger: 'booking_create',
    })
    // Booking-scoped only (legacy path) → still accepted.
    await db.insert(payments).values({
      bookingId: booking!.id,
      razorpayPaymentId: 'pay_booking_scoped',
      amount: '100.00',
      captureTrigger: 'booking_create',
    })
  })
  // ── Security-review hardenings (H1/M1/M2/M3 + battery gaps) ──────────

  it('wallet covering the FULL total: no Razorpay order and the order is PAID (M3)', async () => {
    await cartUp([{ experienceId: cheapId, slotId: cheapSlot, count: 2 }]) // 2,000
    await db.insert(walletBalances).values({
      userId: 'u_cust',
      balanceType: 'switchback_credit',
      amount: '5000.00',
    })
    const result = await executeCartCheckout(db, {
      customerUserId: 'u_cust',
      idempotencyKey: KEY(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.razorpayRemainderRupees).toBe(0)
    expect(result.razorpayOrderId).toBeNull()
    const [orderRow] = await db.select().from(orders)
    expect(orderRow!.state).toBe('paid')
  })

  it('two concurrent submits with distinct keys yield EXACTLY ONE order (H1)', async () => {
    await cartUp([{ experienceId: cheapId, slotId: cheapSlot, count: 2 }])
    const [a, b] = await Promise.all([
      executeCartCheckout(db, { customerUserId: 'u_cust', idempotencyKey: KEY() }),
      executeCartCheckout(db, { customerUserId: 'u_cust', idempotencyKey: KEY() }),
    ])
    const oks = [a, b].filter((r) => r.ok)
    expect(oks).toHaveLength(1)
    expect(await db.select().from(orders)).toHaveLength(1)
    expect(await db.select().from(bookings)).toHaveLength(1)
    const loser = [a, b].find((r) => !r.ok)!
    expect(loser.ok).toBe(false)
  })

  it('retry after a failed attempt with a FRESH key never resurrects rolled-back bookings (brief catch #1)', async () => {
    const tinySlot = await seedSlot(cheapId, 15, 2)
    await cartUp([{ experienceId: cheapId, slotId: tinySlot, count: 2 }])
    await db
      .update(availabilitySlots)
      .set({ capacityTaken: 2 })
      .where(eq(availabilitySlots.id, tinySlot))

    const failed = await executeCartCheckout(db, {
      customerUserId: 'u_cust',
      idempotencyKey: KEY(),
    })
    expect(failed.ok).toBe(false)

    // Capacity frees up; a retry with a FRESH action key books cleanly.
    await db
      .update(availabilitySlots)
      .set({ capacityTaken: 0 })
      .where(eq(availabilitySlots.id, tinySlot))
    const retry = await executeCartCheckout(db, {
      customerUserId: 'u_cust',
      idempotencyKey: KEY(),
    })
    expect(retry.ok).toBe(true)
    expect(await db.select().from(bookings)).toHaveLength(1)
    expect(await db.select().from(orders)).toHaveLength(1)
  })
  it('a permit-requiring line without acknowledgement rolls back the WHOLE cart', async () => {
    const permitId = await seedExperience({ slug: 'exp-permit', price: '2000.00' })
    await db
      .update(experiences)
      .set({ requiredPermits: ['forest-entry'] })
      .where(eq(experiences.id, permitId))
    const permitSlot = await seedSlot(permitId, 16)
    await cartUp([
      { experienceId: cheapId, slotId: cheapSlot, count: 2 },
      { experienceId: permitId, slotId: permitSlot, count: 2 },
    ])

    const refused = await executeCartCheckout(db, {
      customerUserId: 'u_cust',
      idempotencyKey: KEY(),
      acknowledgedPermits: false,
    })
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.failedCode).toBe('PERMITS_NOT_ACKNOWLEDGED')
    expect(await db.select().from(bookings)).toHaveLength(0)

    const accepted = await executeCartCheckout(db, {
      customerUserId: 'u_cust',
      idempotencyKey: KEY(),
      acknowledgedPermits: true,
    })
    expect(accepted.ok).toBe(true)
    expect(await db.select().from(bookings)).toHaveLength(2)
  })
})
