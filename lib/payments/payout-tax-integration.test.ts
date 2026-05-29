import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { _resetRedisCacheForTests } from '@/lib/redis'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { createBooking } from './booking-create'
import { computeVendorNetPayout, payoutWindowDays } from './payout-calculator'

/**
 * END-TO-END payout tax math (Issue #36, ADR-0016).
 *
 * Drives the real `createBooking` transaction so the TDS / TCS / commission
 * / GST snapshots are computed and PERSISTED exactly as production does,
 * then feeds the persisted row into `computeVendorNetPayout` and asserts the
 * concrete worked example:
 *
 *   net = gross − Commission − GST(18% on commission) − TDS − TCS
 *
 * Worked example (gross ₹10,000, 20% commission):
 *   commission       = 2000
 *   GST 18% on 2000  = 360
 *   TDS 0.1% gross   = 10   (vendor OVER the ₹5L 194-O threshold)  | 0 (UNDER)
 *   TCS 0.5% gross   = 50
 *   net (over ₹5L)   = 10000 − 2000 − 360 − 10 − 50 = 7580
 *   net (under ₹5L)  = 10000 − 2000 − 360 −  0 − 50 = 7590
 */
describe('payout tax math — end-to-end through createBooking (#36, ADR-0016)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_payv', email: 'payv@example.com' },
      { id: 'u_payc', email: 'payc@example.com' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, payments, refund_requests, bookings, commission_tiers, pricing_tiers, availability_slots, experiences, vendor_profiles CASCADE`,
    )
    _resetRedisCacheForTests()
    // Re-seed the vendor each test (TRUNCATE clears vendor_profiles). Business
    // tier so the ₹5,000/person worked-example price clears the Tier-2 cap.
    await db.insert(vendorProfiles).values({
      userId: 'u_payv',
      businessName: 'Payout Math Co',
      slug: 'payout-math-co',
      kycTier: 'business',
      pan: 'ABCDE1234F',
      taxpayerType: 'individual',
      commissionRate: '20.00',
      payoutMethod: 'upi',
      payoutDestination: { vpa: 'payout@upi' },
    })
  })

  async function seedExperienceAndSlot(opts: {
    pricePerPerson: string
    requiredPermits?: string[]
    multiDay?: boolean
  }): Promise<{ experienceId: string; slotId: string }> {
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_payv',
        slug: `worked-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Worked Example Trek',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: opts.pricePerPerson,
        pricePerPerson_3_5: opts.pricePerPerson,
        pricePerPerson_6_plus: opts.pricePerPerson,
        requiredPermits: opts.requiredPermits ?? [],
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'published',
      })
      .returning({ id: experiences.id })
    const experienceId = exp!.id

    const startAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    const endAt = opts.multiDay
      ? new Date(startAt.getTime() + 3 * 24 * 60 * 60 * 1000) // 3-day trek
      : new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })

    return { experienceId, slotId: slot!.id }
  }

  it('OVER ₹5L threshold: persists TDS and nets to ₹7,580 end-to-end', async () => {
    // Push the vendor over ₹5L FY gross first via a prior large booking, so
    // the worked-example booking's individual-vendor TDS is DEDUCTED.
    const big = await seedExperienceAndSlot({ pricePerPerson: '150000.00' })
    await createBooking(db, {
      customerUserId: 'u_payc',
      experienceId: big.experienceId,
      slotId: big.slotId,
      participantCount: 4, // gross 600000 → cumulative FY gross now > ₹5L
      paymentMode: 'full_upfront',
      idempotencyKey: crypto.randomUUID(),
    })

    // Worked-example booking: ₹5,000 × 2 = ₹10,000 gross.
    const { experienceId, slotId } = await seedExperienceAndSlot({
      pricePerPerson: '5000.00',
    })
    const r = await createBooking(db, {
      customerUserId: 'u_payc',
      experienceId,
      slotId,
      participantCount: 2,
      paymentMode: 'full_upfront',
      idempotencyKey: crypto.randomUUID(),
    })

    const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
    // The persisted snapshots are the worked-example inputs.
    expect(row?.grossTotalSnapshot).toBe('10000.00')
    expect(row?.commissionRateSnapshot).toBe('20.00')
    expect(row?.gstRateOnCommissionSnapshot).toBe('18.00')
    expect(row?.tdsAmountSnapshot).toBe('10.00') // 0.1% of 10000, over ₹5L → deducted
    expect(row?.tcsAmountSnapshot).toBe('50.00') // 0.5% of 10000

    const payout = computeVendorNetPayout({
      grossRupees: Math.floor(Number(row!.grossTotalSnapshot)),
      commissionRatePercent: row!.commissionRateSnapshot,
      gstRateOnCommissionPercent: row!.gstRateOnCommissionSnapshot,
      tdsRupees: Math.floor(Number(row!.tdsAmountSnapshot)),
      tcsRupees: Math.floor(Number(row!.tcsAmountSnapshot)),
    })

    expect(payout.commissionRupees).toBe(2000)
    expect(payout.gstOnCommissionRupees).toBe(360)
    expect(payout.tdsRupees).toBe(10)
    expect(payout.tcsRupees).toBe(50)
    expect(payout.netPayoutRupees).toBe(7580)
  })

  it('UNDER ₹5L threshold: NO TDS persisted and nets ₹10 higher (₹7,590)', async () => {
    // No prior bookings → cumulative FY gross = 10000 ≤ ₹5L, individual vendor → exempt.
    const { experienceId, slotId } = await seedExperienceAndSlot({
      pricePerPerson: '5000.00',
    })
    const r = await createBooking(db, {
      customerUserId: 'u_payc',
      experienceId,
      slotId,
      participantCount: 2,
      paymentMode: 'full_upfront',
      idempotencyKey: crypto.randomUUID(),
    })

    const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
    expect(row?.grossTotalSnapshot).toBe('10000.00')
    expect(row?.tdsAmountSnapshot).toBe('0.00') // individual under ₹5L → exempt
    expect(row?.tcsAmountSnapshot).toBe('50.00')

    const payout = computeVendorNetPayout({
      grossRupees: Math.floor(Number(row!.grossTotalSnapshot)),
      commissionRatePercent: row!.commissionRateSnapshot,
      gstRateOnCommissionPercent: row!.gstRateOnCommissionSnapshot,
      tdsRupees: Math.floor(Number(row!.tdsAmountSnapshot)),
      tcsRupees: Math.floor(Number(row!.tcsAmountSnapshot)),
    })

    expect(payout.tdsRupees).toBe(0)
    expect(payout.netPayoutRupees).toBe(7590)
  })

  it('payout window: single-day no-permit booking → T+7; permit-required → T+30', async () => {
    // Single-day, no permit.
    const plain = await seedExperienceAndSlot({ pricePerPerson: '5000.00' })
    const [plainExp] = await db
      .select({ requiredPermits: experiences.requiredPermits })
      .from(experiences)
      .where(eq(experiences.id, plain.experienceId))
    const [plainSlot] = await db
      .select({ startAt: availabilitySlots.startAt, endAt: availabilitySlots.endAt })
      .from(availabilitySlots)
      .where(eq(availabilitySlots.id, plain.slotId))
    const plainMultiDay =
      plainSlot!.endAt.getTime() - plainSlot!.startAt.getTime() > 24 * 60 * 60 * 1000
    expect(
      payoutWindowDays({
        permitRequired: plainExp!.requiredPermits.length > 0,
        multiDay: plainMultiDay,
      }),
    ).toBe(7)

    // Permit-required, multi-day trek → extended window.
    const trek = await seedExperienceAndSlot({
      pricePerPerson: '5000.00',
      requiredPermits: ['forest_entry'],
      multiDay: true,
    })
    const [trekExp] = await db
      .select({ requiredPermits: experiences.requiredPermits })
      .from(experiences)
      .where(eq(experiences.id, trek.experienceId))
    const [trekSlot] = await db
      .select({ startAt: availabilitySlots.startAt, endAt: availabilitySlots.endAt })
      .from(availabilitySlots)
      .where(eq(availabilitySlots.id, trek.slotId))
    const trekMultiDay =
      trekSlot!.endAt.getTime() - trekSlot!.startAt.getTime() > 24 * 60 * 60 * 1000
    expect(trekExp!.requiredPermits.length > 0).toBe(true)
    expect(trekMultiDay).toBe(true)
    expect(
      payoutWindowDays({
        permitRequired: trekExp!.requiredPermits.length > 0,
        multiDay: trekMultiDay,
      }),
    ).toBe(30)
  })
})
