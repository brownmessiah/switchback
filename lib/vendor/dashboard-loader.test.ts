import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { payments } from '@/db/schema/payments'
import { refundRequests } from '@/db/schema/refund-requests'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  fillDays,
  formatDate,
  loadVendorDashboard,
  mapUpcomingBooking,
  rankInsights,
  shapeDashboardStats,
  slaColor,
  verifiedVendorBadgeLabel,
  type Insight,
} from './dashboard-loader'

describe('loadVendorDashboard', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string
  let slotId: string
  let futureSlotId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    // Clean tables in correct dependency order
    await db.execute(sql`DELETE FROM payments`)
    await db.execute(sql`DELETE FROM refund_requests`)
    await db.execute(sql`DELETE FROM bookings`)
    await db.execute(sql`DELETE FROM availability_slots`)
    await db.execute(sql`DELETE FROM experiences`)
    await db.execute(sql`DELETE FROM vendor_profiles`)
    await db.execute(sql`DELETE FROM users`)

    // Seed baseline data
    await db.insert(users).values([
      { id: 'u_v', email: 'vendor@test.com', name: 'Test Vendor' },
      { id: 'u_c', email: 'customer@test.com', name: 'Test Customer' },
    ])

    await db.insert(vendorProfiles).values({
      userId: 'u_v',
      businessName: 'Mountain Adventures',
      slug: 'mountain-adventures',
      kycTier: 'business',
      responseTimeSlaScore: '92.50',
      commissionRate: '20.00',
    })

    // Insert experience
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'paragliding-manali',
        title: 'Paragliding in Manali',
        cancellationPreset: 'moderate',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '5000.00',
        pricePerPerson_3_5: '4500.00',
        pricePerPerson_6_plus: '4000.00',
        regionSlug: 'manali',
        activitySlug: 'paragliding',
        status: 'published',
      })
      .returning({ id: experiences.id })
    experienceId = exp!.id

    // Past slot (today - 5 days)
    const pastDate = new Date()
    pastDate.setDate(pastDate.getDate() - 5)
    const pastDateEnd = new Date(pastDate)
    pastDateEnd.setHours(pastDateEnd.getHours() + 2)

    const [pastSlot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId,
        startAt: pastDate,
        endAt: pastDateEnd,
        capacity: 8,
        capacityTaken: 2,
      })
      .returning({ id: availabilitySlots.id })
    slotId = pastSlot!.id

    // Future slot (today + 10 days)
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 10)
    const futureDateEnd = new Date(futureDate)
    futureDateEnd.setHours(futureDateEnd.getHours() + 2)

    const [fSlot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId,
        startAt: futureDate,
        endAt: futureDateEnd,
        capacity: 8,
        capacityTaken: 0,
      })
      .returning({ id: availabilitySlots.id })
    futureSlotId = fSlot!.id
  })

  it('returns correct stats shape with empty bookings', async () => {
    const result = await loadVendorDashboard(db, 'u_v')

    expect(result.businessName).toBe('Mountain Adventures')
    expect(result.kycTier).toBe('business')
    expect(result.listingsCount).toBe(1)
    expect(result.totalBookings).toBe(0)
    expect(result.totalRevenue).toBe(0)
    expect(result.todayBookings).toBe(0)
    expect(result.monthRevenue).toBe(0)
    expect(result.slaScore).toBe(92.5)
    expect(result.pendingActionsCount).toBe(0)
    expect(result.bookingsTrend).toHaveLength(31) // 30 days + today
    expect(result.revenueTrend).toHaveLength(31)
    expect(result.actionItems.length).toBeGreaterThanOrEqual(0)
    expect(result.upcomingBookings).toHaveLength(0)
  })

  it('counts today bookings correctly', async () => {
    // Create a booking confirmed today
    await db.insert(bookings).values({
      customerUserId: 'u_c',
      experienceId,
      slotId: futureSlotId,
      participantCount: 2,
      state: 'confirmed',
      paymentMode: 'full_upfront',
      grossTotalSnapshot: '10000.00',
      pricePerParticipantSnapshot: '5000.00',
      pricingBasisSnapshot: 'per_person',
      commissionRateSnapshot: '20.00',
      commissionBasisSnapshot: 'vendor_base',
      cancellationPresetSnapshot: 'moderate',
      tdsAmountSnapshot: '10.00',
      confirmedAt: new Date(), // today
    })

    const result = await loadVendorDashboard(db, 'u_v')

    expect(result.todayBookings).toBe(1)
    expect(result.totalBookings).toBe(1)
    expect(result.totalRevenue).toBe(10000)
  })

  it('computes month revenue from payments', async () => {
    // Insert a booking
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_c',
        experienceId,
        slotId: futureSlotId,
        participantCount: 2,
        state: 'confirmed',
        paymentMode: 'full_upfront',
        grossTotalSnapshot: '10000.00',
        pricePerParticipantSnapshot: '5000.00',
        pricingBasisSnapshot: 'per_person',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_base',
        cancellationPresetSnapshot: 'moderate',
        tdsAmountSnapshot: '10.00',
        confirmedAt: new Date(),
      })
      .returning({ id: bookings.id })

    // Insert payment captured this month
    await db.insert(payments).values({
      bookingId: booking!.id,
      razorpayPaymentId: 'pay_test_001',
      amount: '10000.00',
      captureTrigger: 'booking_create',
      capturedAt: new Date(),
    })

    const result = await loadVendorDashboard(db, 'u_v')

    expect(result.monthRevenue).toBe(10000)
  })

  it('builds bookings trend with correct day-fill', async () => {
    // Create a booking 3 days ago
    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

    await db.insert(bookings).values({
      customerUserId: 'u_c',
      experienceId,
      slotId: futureSlotId,
      participantCount: 1,
      state: 'confirmed',
      paymentMode: 'full_upfront',
      grossTotalSnapshot: '5000.00',
      pricePerParticipantSnapshot: '5000.00',
      pricingBasisSnapshot: 'per_person',
      commissionRateSnapshot: '20.00',
      commissionBasisSnapshot: 'vendor_base',
      cancellationPresetSnapshot: 'moderate',
      tdsAmountSnapshot: '5.00',
      confirmedAt: threeDaysAgo,
    })

    const result = await loadVendorDashboard(db, 'u_v')

    // 31 days (30 days back + today)
    expect(result.bookingsTrend).toHaveLength(31)

    // Most days should be 0
    const zeroDays = result.bookingsTrend.filter((d) => d.value === 0)
    expect(zeroDays.length).toBe(30)

    // One day should be 1
    const nonZeroDays = result.bookingsTrend.filter((d) => d.value > 0)
    expect(nonZeroDays).toHaveLength(1)
    expect(nonZeroDays[0]!.value).toBe(1)
  })

  it('includes calendar gaps as action items', async () => {
    // futureSlotId already has capacityTaken=0, should be a gap
    const result = await loadVendorDashboard(db, 'u_v')

    const gaps = result.actionItems.filter((a) => a.type === 'calendar_gap')
    expect(gaps.length).toBeGreaterThanOrEqual(1)
    expect(gaps[0]!.title).toContain('No bookings')
    expect(gaps[0]!.title).toContain('Paragliding in Manali')
  })

  it('includes pending bookings as action items', async () => {
    // Insert a confirmed booking on the future slot
    await db.insert(bookings).values({
      customerUserId: 'u_c',
      experienceId,
      slotId: futureSlotId,
      participantCount: 3,
      state: 'confirmed',
      paymentMode: 'full_upfront',
      grossTotalSnapshot: '15000.00',
      pricePerParticipantSnapshot: '5000.00',
      pricingBasisSnapshot: 'per_person',
      commissionRateSnapshot: '20.00',
      commissionBasisSnapshot: 'vendor_base',
      cancellationPresetSnapshot: 'moderate',
      tdsAmountSnapshot: '15.00',
      confirmedAt: new Date(),
    })

    const result = await loadVendorDashboard(db, 'u_v')

    expect(result.pendingActionsCount).toBe(1)
    const bookingActions = result.actionItems.filter(
      (a) => a.type === 'unconfirmed_booking',
    )
    expect(bookingActions).toHaveLength(1)
    expect(bookingActions[0]!.subtitle).toContain('3 guests')
  })

  it('excludes refund_reverse from month revenue', async () => {
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_c',
        experienceId,
        slotId: futureSlotId,
        participantCount: 2,
        state: 'confirmed',
        paymentMode: 'full_upfront',
        grossTotalSnapshot: '10000.00',
        pricePerParticipantSnapshot: '5000.00',
        pricingBasisSnapshot: 'per_person',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_base',
        cancellationPresetSnapshot: 'moderate',
        tdsAmountSnapshot: '10.00',
        confirmedAt: new Date(),
      })
      .returning({ id: bookings.id })

    // Need a refund_requests row to satisfy the CHECK constraint on payments
    const [refundReq] = await db
      .insert(refundRequests)
      .values({
        bookingId: booking!.id,
        requestedByUserId: 'u_c',
        reason: 'vendor_cancelled',
        destination: 'refund_balance',
        state: 'approved',
        amount: '5000.00',
        cancellationPresetSnapshot: 'moderate',
        policyWindowBasisSnapshot: 'vendor_cancelled',
      })
      .returning({ id: refundRequests.id })

    // Insert a normal capture
    await db.insert(payments).values({
      bookingId: booking!.id,
      razorpayPaymentId: 'pay_normal_001',
      amount: '10000.00',
      captureTrigger: 'booking_create',
      capturedAt: new Date(),
    })

    // Insert a refund_reverse
    await db.insert(payments).values({
      bookingId: booking!.id,
      razorpayPaymentId: 'pay_refund_001',
      amount: '-5000.00',
      captureTrigger: 'refund_reverse',
      capturedAt: new Date(),
      refundRequestId: refundReq!.id,
    })

    const result = await loadVendorDashboard(db, 'u_v')

    // Month revenue should only count the positive capture
    expect(result.monthRevenue).toBe(10000)
  })

  it('returns defaults for non-existent vendor', async () => {
    const result = await loadVendorDashboard(db, 'u_nonexistent')

    expect(result.businessName).toBeNull()
    expect(result.kycTier).toBe('phone')
    expect(result.slaScore).toBe(100)
    expect(result.listingsCount).toBe(0)
    expect(result.totalBookings).toBe(0)
  })

  // ── C "Insight-First Growth Hub" rail (issue #74) ─────────────────────────
  // Every insight is computed from REAL aggregated vendor data — no ML, no
  // fabricated signals. These integration tests pin the exact derivation.

  it('top_performer insight is the experience with the most bookings', async () => {
    // A SECOND experience with FEWER bookings than the seeded one, so the
    // max-by-booking-count pick is unambiguous.
    const [exp2] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'kayaking-rishikesh',
        title: 'Kayaking in Rishikesh',
        cancellationPreset: 'moderate',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '2000.00',
        pricePerPerson_3_5: '1800.00',
        pricePerPerson_6_plus: '1600.00',
        regionSlug: 'rishikesh',
        activitySlug: 'kayaking',
        status: 'published',
      })
      .returning({ id: experiences.id })
    const exp2Id = exp2!.id

    const [exp2Slot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: exp2Id,
        startAt: new Date(Date.now() + 12 * 86_400_000),
        endAt: new Date(Date.now() + 12 * 86_400_000 + 7_200_000),
        capacity: 8,
        capacityTaken: 1,
      })
      .returning({ id: availabilitySlots.id })

    const baseBooking = {
      customerUserId: 'u_c',
      paymentMode: 'full_upfront' as const,
      pricePerParticipantSnapshot: '5000.00',
      pricingBasisSnapshot: 'per_person',
      commissionRateSnapshot: '20.00',
      commissionBasisSnapshot: 'vendor_base',
      cancellationPresetSnapshot: 'moderate',
      tdsAmountSnapshot: '10.00',
      confirmedAt: new Date(),
    }

    // 3 bookings on the FIRST experience (Paragliding in Manali).
    for (let i = 0; i < 3; i++) {
      await db.insert(bookings).values({
        ...baseBooking,
        experienceId,
        slotId: futureSlotId,
        participantCount: 1,
        state: 'confirmed',
        grossTotalSnapshot: '5000.00',
      })
    }
    // 1 booking on the SECOND experience.
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId: exp2Id,
      slotId: exp2Slot!.id,
      participantCount: 1,
      state: 'confirmed',
      grossTotalSnapshot: '2000.00',
    })

    const result = await loadVendorDashboard(db, 'u_v')

    const top = result.insights.find((i) => i.type === 'top_performer')
    expect(top).toBeDefined()
    expect(top!.expTitle).toBe('Paragliding in Manali')
    expect(top!.bookingCount).toBe(3)
  })

  it('likely_to_sell_out insight surfaces upcoming slots near capacity', async () => {
    // A future slot at 7/8 capacity (1 spot left) — near sell-out.
    const nearFull = new Date(Date.now() + 14 * 86_400_000)
    const [nearFullSlot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId,
        startAt: nearFull,
        endAt: new Date(nearFull.getTime() + 7_200_000),
        capacity: 8,
        capacityTaken: 7,
      })
      .returning({ id: availabilitySlots.id })

    const result = await loadVendorDashboard(db, 'u_v')

    const sellOut = result.insights.find((i) => i.type === 'likely_to_sell_out')
    expect(sellOut).toBeDefined()
    expect(sellOut!.slotId).toBe(nearFullSlot!.id)
    expect(sellOut!.spotsLeft).toBe(1)
    expect(sellOut!.expTitle).toBe('Paragliding in Manali')
  })

  it('off_peak_gap insight surfaces upcoming zero-booked slots', async () => {
    // futureSlotId (seeded in beforeEach) has capacityTaken=0 → an off-peak gap.
    const result = await loadVendorDashboard(db, 'u_v')

    const gap = result.insights.find((i) => i.type === 'off_peak_gap')
    expect(gap).toBeDefined()
    expect(gap!.slotId).toBe(futureSlotId)
    expect(gap!.expTitle).toBe('Paragliding in Manali')
  })

  it('omits insights that cannot be computed (vendor with no bookings/slots)', async () => {
    // A vendor with a profile but NO experiences, slots, or bookings: every
    // insight is non-derivable, so the rail must be empty (no fabrication).
    await db.insert(users).values({ id: 'u_empty', email: 'empty@test.com', name: 'Empty' })
    await db.insert(vendorProfiles).values({
      userId: 'u_empty',
      businessName: 'Empty Co',
      slug: 'empty-co',
      kycTier: 'business',
      responseTimeSlaScore: '100.00',
      commissionRate: '20.00',
    })

    const result = await loadVendorDashboard(db, 'u_empty')
    expect(result.insights).toHaveLength(0)
  })
})

describe('shapeDashboardStats', () => {
  it('applies safe defaults when every aggregate row is missing', () => {
    // A brand-new vendor whose queries return no rows: the shaper must not
    // produce undefined/NaN — it falls back to phone tier, 100 SLA, zeros.
    const stats = shapeDashboardStats({})

    expect(stats.businessName).toBeNull()
    expect(stats.kycTier).toBe('phone')
    expect(stats.listingsCount).toBe(0)
    expect(stats.totalBookings).toBe(0)
    expect(stats.totalRevenue).toBe(0)
    expect(stats.todayBookings).toBe(0)
    expect(stats.monthRevenue).toBe(0)
    expect(stats.slaScore).toBe(100)
  })

  it('coerces null aggregate fields to 0 and floors revenue', () => {
    const stats = shapeDashboardStats({
      vendor: { businessName: 'Acme', kycTier: 'business', responseTimeSlaScore: '88.50' },
      expCount: { count: 3 },
      allTimeStats: { total: 4, revenue: '12345.99' },
      todayStats: { count: null },
      monthRevenueResult: { revenue: null },
    })

    expect(stats.businessName).toBe('Acme')
    expect(stats.kycTier).toBe('business')
    expect(stats.listingsCount).toBe(3)
    expect(stats.totalBookings).toBe(4)
    expect(stats.totalRevenue).toBe(12345) // floored
    expect(stats.todayBookings).toBe(0) // null -> 0
    expect(stats.monthRevenue).toBe(0) // null -> 0
    expect(stats.slaScore).toBe(88.5)
  })
})

describe('mapUpcomingBooking', () => {
  it('floors gross to integer rupees', () => {
    const row = mapUpcomingBooking({
      bookingId: 'b1',
      participantCount: 2,
      state: 'confirmed',
      gross: '9999.99',
      slotStart: new Date('2026-04-01T00:00:00Z'),
      expTitle: 'Trek',
    })
    expect(row.gross).toBe(9999)
    expect(row.bookingId).toBe('b1')
  })

  it('defaults a null gross to 0 (defensive fallback)', () => {
    const row = mapUpcomingBooking({
      bookingId: 'b2',
      participantCount: 1,
      state: 'confirmed',
      gross: null,
      slotStart: null,
      expTitle: 'Climb',
    })
    expect(row.gross).toBe(0)
    expect(row.slotStart).toBeNull()
  })
})

describe('fillDays', () => {
  it('materialises every day in the range, inserting 0 for missing days', () => {
    const from = new Date('2026-01-01T00:00:00Z')
    const to = new Date('2026-01-03T00:00:00Z')
    const result = fillDays(from, to, [{ date: '2026-01-02', count: 5 }], 'count')

    expect(result).toHaveLength(3)
    expect(result.map((d) => d.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03'])
    expect(result.find((d) => d.date === '2026-01-02')?.value).toBe(5)
    // Days with no row default to 0.
    expect(result.find((d) => d.date === '2026-01-01')?.value).toBe(0)
  })

  it('coerces a null/undefined aggregate value to 0 (defensive sum() path)', () => {
    const day = new Date('2026-02-10T00:00:00Z')
    // A SUM() over an empty group can surface as null from the driver;
    // the `?? 0` fallback must not produce NaN.
    const result = fillDays(day, day, [{ date: '2026-02-10', total: null }], 'total')

    expect(result).toHaveLength(1)
    expect(result[0]!.value).toBe(0)
  })
})

describe('formatDate', () => {
  it('returns an em dash for a null date', () => {
    expect(formatDate(null)).toBe('—')
  })

  it('formats a real date in en-IN day/month form', () => {
    const formatted = formatDate(new Date('2026-03-15T00:00:00Z'))
    expect(formatted).toMatch(/Mar/)
  })
})

describe('slaColor', () => {
  it('returns green for score >= 90', () => {
    expect(slaColor(90)).toBe('green')
    expect(slaColor(95)).toBe('green')
    expect(slaColor(100)).toBe('green')
  })

  it('returns yellow for score >= 70 and < 90', () => {
    expect(slaColor(70)).toBe('yellow')
    expect(slaColor(80)).toBe('yellow')
    expect(slaColor(89.99)).toBe('yellow')
  })

  it('returns red for score < 70', () => {
    expect(slaColor(0)).toBe('red')
    expect(slaColor(50)).toBe('red')
    expect(slaColor(69.99)).toBe('red')
  })
})

describe('rankInsights', () => {
  const sellOut: Insight = {
    id: 's1',
    type: 'likely_to_sell_out',
    title: 'Likely to sell out',
    subtitle: '1 spot left',
    expTitle: 'Scuba',
    slotId: 'slot1',
    spotsLeft: 1,
    bookingCount: 0,
  }
  const topPerformer: Insight = {
    id: 't1',
    type: 'top_performer',
    title: 'Top performer',
    subtitle: '5 bookings',
    expTitle: 'Paragliding',
    slotId: null,
    spotsLeft: 0,
    bookingCount: 5,
  }
  const offPeak: Insight = {
    id: 'g1',
    type: 'off_peak_gap',
    title: 'Off-peak gap',
    subtitle: 'no bookings',
    expTitle: 'Camping',
    slotId: 'slot2',
    spotsLeft: 8,
    bookingCount: 0,
  }

  it('ranks likely_to_sell_out first, then top_performer, then off_peak_gap', () => {
    // Pass in deliberately shuffled order; ranking must be deterministic.
    const ranked = rankInsights([offPeak, topPerformer, sellOut])
    expect(ranked.map((i) => i.type)).toEqual([
      'likely_to_sell_out',
      'top_performer',
      'off_peak_gap',
    ])
  })

  it('preserves only the insights it is given (no fabrication)', () => {
    expect(rankInsights([])).toEqual([])
    expect(rankInsights([topPerformer]).map((i) => i.type)).toEqual(['top_performer'])
  })
})

describe('verifiedVendorBadgeLabel', () => {
  // ADR-0007 defines DISTINCT trust badges per tier; rendering "Business
  // verified" for an identity-tier Vendor OVERSTATES its verification level.
  // The verbatim domain strings come from CONTEXT.md / DESIGN.md §line-18.
  it('labels a business-tier Vendor "Business verified Vendor"', () => {
    expect(verifiedVendorBadgeLabel('business')).toBe('Business verified Vendor')
  })

  it('labels an identity-tier Vendor "Identity verified Vendor" (NOT Business)', () => {
    expect(verifiedVendorBadgeLabel('identity')).toBe('Identity verified Vendor')
  })

  it('returns null for phone tier (no verified badge)', () => {
    expect(verifiedVendorBadgeLabel('phone')).toBeNull()
  })

  it('returns null for an unknown/missing tier (no verified badge)', () => {
    expect(verifiedVendorBadgeLabel('')).toBeNull()
    expect(verifiedVendorBadgeLabel('something_else')).toBeNull()
  })
})
