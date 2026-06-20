import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  computeAverage,
  computePercentChange,
  computeRate,
  fillMonths,
  MONTHS_WINDOW,
  loadVendorAnalytics,
  shapeAnalytics,
  shapeDailyBreakdown,
  shapeExperienceRevenue,
  shapeKeyMetrics,
  shapeStatusBreakdown,
} from './analytics-loader'

describe('computePercentChange', () => {
  // The single load-bearing honesty rule: NEVER fabricate a "+100%" when the
  // prior period had no data to compare against.

  it('returns no comparison (null, hasPrior=false) when the prior period is empty', () => {
    const { percentChange, hasPrior } = computePercentChange(500, 0)

    expect(hasPrior).toBe(false)
    expect(percentChange).toBeNull() // NOT +100% — there is nothing to compare
  })

  it('computes a positive delta when current exceeds prior', () => {
    const { percentChange, hasPrior } = computePercentChange(150, 100)

    expect(hasPrior).toBe(true)
    expect(percentChange).toBe(50) // (150-100)/100 * 100
  })

  it('computes a negative delta when current is below prior', () => {
    const { percentChange, hasPrior } = computePercentChange(80, 100)

    expect(hasPrior).toBe(true)
    expect(percentChange).toBe(-20) // (80-100)/100 * 100
  })

  it('reports exactly 0% when current equals prior', () => {
    const { percentChange, hasPrior } = computePercentChange(100, 100)

    expect(hasPrior).toBe(true)
    expect(percentChange).toBe(0)
  })
})

describe('computeAverage', () => {
  it('returns 0 when the count is zero (no divide-by-zero, no NaN)', () => {
    expect(computeAverage(0, 0)).toBe(0)
    expect(computeAverage(5000, 0)).toBe(0)
  })

  it('floors the average to integer rupees', () => {
    expect(computeAverage(10000, 3)).toBe(3333) // 3333.33 → 3333
  })

  it('computes an exact average when it divides evenly', () => {
    expect(computeAverage(15000, 2)).toBe(7500)
  })
})

describe('computeRate', () => {
  it('returns 0 when the denominator is zero (no divide-by-zero, no NaN)', () => {
    expect(computeRate(0, 0)).toBe(0)
    expect(computeRate(3, 0)).toBe(0)
  })

  it('computes the ratio as a percentage', () => {
    expect(computeRate(1, 4)).toBe(25) // 1/4 * 100
  })

  it('returns 0 when the numerator is zero', () => {
    expect(computeRate(0, 10)).toBe(0)
  })
})

describe('fillMonths', () => {
  // Pure month-fill for the Monthly Revenue series: every month in the window
  // must appear as a `YYYY-MM-01` DayDataPoint, with 0 for months that have no
  // backing rows, ordered chronologically. Mirrors fillDays for days.

  it('emits one point per month across the window with first-of-month dates', () => {
    const result = fillMonths(
      new Date('2026-01-15T00:00:00Z'),
      new Date('2026-03-10T00:00:00Z'),
      [{ month: '2026-02', total: '5000.00' }],
      'total',
    )

    expect(result).toEqual([
      { date: '2026-01-01', value: 0 },
      { date: '2026-02-01', value: 5000 },
      { date: '2026-03-01', value: 0 },
    ])
  })

  it('coerces a null aggregate value to 0 (never NaN)', () => {
    const result = fillMonths(
      new Date('2026-05-20T00:00:00Z'),
      new Date('2026-05-20T00:00:00Z'),
      [{ month: '2026-05', total: null }],
      'total',
    )

    expect(result).toEqual([{ date: '2026-05-01', value: 0 }])
  })

  it('returns one zero-valued point per month for an empty window of rows', () => {
    const result = fillMonths(
      new Date('2025-12-01T00:00:00Z'),
      new Date('2026-01-01T00:00:00Z'),
      [],
      'total',
    )

    expect(result).toEqual([
      { date: '2025-12-01', value: 0 },
      { date: '2026-01-01', value: 0 },
    ])
  })
})

describe('shapeStatusBreakdown', () => {
  // Pure shaping for the status breakdown: coerce the grouped count and drop any
  // zero/empty bucket so the page never renders a fabricated "0" state row.

  it('coerces string counts to integers', () => {
    const result = shapeStatusBreakdown([
      { state: 'confirmed', count: '3' },
      { state: 'completed', count: 1 },
    ])

    expect(result).toEqual([
      { state: 'confirmed', count: 3 },
      { state: 'completed', count: 1 },
    ])
  })

  it('drops zero/null buckets (honest — no fabricated state rows)', () => {
    const result = shapeStatusBreakdown([
      { state: 'confirmed', count: 2 },
      { state: 'disputed', count: 0 },
      { state: 'no_show', count: null },
    ])

    expect(result).toEqual([{ state: 'confirmed', count: 2 }])
  })

  it('returns an empty array for no rows', () => {
    expect(shapeStatusBreakdown([])).toEqual([])
  })
})

describe('shapeExperienceRevenue', () => {
  // Pure shaping for the revenue-by-Experience list: floor gross to integer
  // rupees and coerce a null SUM()/COUNT() to 0 (never NaN/undefined).

  it('floors gross revenue and coerces string aggregates', () => {
    const result = shapeExperienceRevenue([
      { experienceId: 'e1', title: 'Paragliding', bookings: '2', revenue: '12345.99' },
    ])

    expect(result).toEqual([
      { experienceId: 'e1', title: 'Paragliding', bookings: 2, revenue: 12345 },
    ])
  })

  it('coerces null aggregates to 0 (defensive)', () => {
    const result = shapeExperienceRevenue([
      { experienceId: 'e2', title: 'Rafting', bookings: null, revenue: null },
    ])

    expect(result).toEqual([
      { experienceId: 'e2', title: 'Rafting', bookings: 0, revenue: 0 },
    ])
  })

  it('returns an empty array for no rows', () => {
    expect(shapeExperienceRevenue([])).toEqual([])
  })
})

describe('shapeDailyBreakdown', () => {
  // Pure shaping for the daily-breakdown table (Date | Bookings | Revenue):
  // coerce string/null aggregates, floor gross revenue to integer rupees,
  // drop empty days, and order newest-first (date desc).

  it('floors gross revenue and coerces string aggregates', () => {
    const result = shapeDailyBreakdown([
      { date: '2026-06-15', bookings: '16', total: '120000.99' },
    ])

    expect(result).toEqual([
      { date: '2026-06-15', bookings: 16, revenue: 120000 },
    ])
  })

  it('orders rows newest day first', () => {
    const result = shapeDailyBreakdown([
      { date: '2026-06-11', bookings: 3, total: '22500.00' },
      { date: '2026-06-15', bookings: 16, total: '120000.00' },
      { date: '2026-06-14', bookings: 9, total: '67500.00' },
    ])

    expect(result.map((r) => r.date)).toEqual([
      '2026-06-15',
      '2026-06-14',
      '2026-06-11',
    ])
  })

  it('drops days with zero Bookings (defensive — no 0/₹0 rows)', () => {
    const result = shapeDailyBreakdown([
      { date: '2026-06-15', bookings: 2, total: '10000.00' },
      { date: '2026-06-14', bookings: 0, total: null },
    ])

    expect(result).toEqual([
      { date: '2026-06-15', bookings: 2, revenue: 10000 },
    ])
  })

  it('coerces null aggregates to 0 (defensive)', () => {
    const result = shapeDailyBreakdown([
      { date: '2026-06-15', bookings: 1, total: null },
    ])

    expect(result).toEqual([{ date: '2026-06-15', bookings: 1, revenue: 0 }])
  })

  it('returns an empty array for no rows', () => {
    expect(shapeDailyBreakdown([])).toEqual([])
  })
})

describe('shapeKeyMetrics', () => {
  // Pure shaping for the Key Metrics grid: every zero-base path must be
  // testable without a DB, and must NEVER fabricate a comparison.

  it('derives all metrics from raw aggregate rows', () => {
    const shaped = shapeKeyMetrics({
      current30: { total: 6, revenue: '60000.00' },
      prior30: { total: 4, revenue: '40000.00' },
      totalRevenue: 100000,
      totalBookings: 10,
      upcoming7: { total: 3 },
      new7: { total: 5 },
      cancelled: { total: 2 },
      repeatCustomers: 1,
    })

    expect(shaped.last30Revenue).toBe(60000)
    expect(shaped.last30Bookings).toBe(6)
    // Revenue delta: (60000-40000)/40000 * 100 = 50; bookings: (6-4)/4 = 50
    expect(shaped.last30RevenueChange).toBe(50)
    expect(shaped.last30BookingsChange).toBe(50)
    expect(shaped.hasPriorPeriod).toBe(true)
    // Average booking value uses the all-time totals (consistent with headline).
    expect(shaped.avgBookingValue).toBe(10000) // 100000 / 10
    expect(shaped.upcoming7Confirmed).toBe(3)
    expect(shaped.newBookings7).toBe(5)
    // Cancellation rate: 2 / 10 = 20%
    expect(shaped.cancellationRate).toBe(20)
    expect(shaped.repeatCustomers).toBe(1)
  })

  it('shows an honest no-comparison state when the prior window is empty', () => {
    const shaped = shapeKeyMetrics({
      current30: { total: 3, revenue: '30000.00' },
      prior30: { total: 0, revenue: null },
      totalRevenue: 30000,
      totalBookings: 3,
      upcoming7: { total: 1 },
      new7: { total: 3 },
      cancelled: { total: 0 },
      repeatCustomers: 0,
    })

    // Prior period empty → NO fabricated "+100%".
    expect(shaped.hasPriorPeriod).toBe(false)
    expect(shaped.last30RevenueChange).toBeNull()
    expect(shaped.last30BookingsChange).toBeNull()
    // The current-window figures are still real and shown.
    expect(shaped.last30Revenue).toBe(30000)
    expect(shaped.last30Bookings).toBe(3)
  })

  it('applies safe zero-base defaults when every aggregate row is missing', () => {
    const shaped = shapeKeyMetrics({
      totalRevenue: 0,
      totalBookings: 0,
    })

    expect(shaped.last30Revenue).toBe(0)
    expect(shaped.last30Bookings).toBe(0)
    expect(shaped.last30RevenueChange).toBeNull()
    expect(shaped.last30BookingsChange).toBeNull()
    expect(shaped.hasPriorPeriod).toBe(false)
    expect(shaped.avgBookingValue).toBe(0) // no divide-by-zero
    expect(shaped.upcoming7Confirmed).toBe(0)
    expect(shaped.newBookings7).toBe(0)
    expect(shaped.cancellationRate).toBe(0) // no NaN
    expect(shaped.repeatCustomers).toBe(0)
  })
})

describe('shapeAnalytics', () => {
  // Pure shaping: the zero/empty path must be testable without a DB.

  it('reports no data when there are zero Bookings (no fabricated values)', () => {
    const shaped = shapeAnalytics({ allTimeStats: { total: 0, revenue: null } })

    expect(shaped.totalBookings).toBe(0)
    expect(shaped.totalRevenue).toBe(0) // null SUM() → 0, never NaN
    expect(shaped.hasData).toBe(false)
  })

  it('applies safe defaults when the aggregate row is missing entirely', () => {
    // A brand-new Vendor whose join returns no row: no undefined/NaN.
    const shaped = shapeAnalytics({})

    expect(shaped.totalBookings).toBe(0)
    expect(shaped.totalRevenue).toBe(0)
    expect(shaped.hasData).toBe(false)
  })

  it('floors gross revenue and flags hasData when Bookings exist', () => {
    const shaped = shapeAnalytics({
      allTimeStats: { total: 4, revenue: '12345.99' },
    })

    expect(shaped.totalBookings).toBe(4)
    expect(shaped.totalRevenue).toBe(12345) // floored, gross
    expect(shaped.hasData).toBe(true)
  })

  it('coerces a null Booking count to 0 (defensive)', () => {
    const shaped = shapeAnalytics({ allTimeStats: { total: null, revenue: null } })

    expect(shaped.totalBookings).toBe(0)
    expect(shaped.hasData).toBe(false)
  })
})

describe('loadVendorAnalytics', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string
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
    // Clean tables in correct dependency order.
    await db.execute(sql`DELETE FROM payments`)
    await db.execute(sql`DELETE FROM refund_requests`)
    await db.execute(sql`DELETE FROM bookings`)
    await db.execute(sql`DELETE FROM availability_slots`)
    await db.execute(sql`DELETE FROM experiences`)
    await db.execute(sql`DELETE FROM vendor_profiles`)
    await db.execute(sql`DELETE FROM users`)

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
    state: 'confirmed' as const,
  }

  it('returns the empty signal for a Vendor with zero Bookings', async () => {
    const result = await loadVendorAnalytics(db, 'u_v')

    expect(result.totalBookings).toBe(0)
    expect(result.totalRevenue).toBe(0)
    expect(result.hasData).toBe(false)
  })

  it('computes Total Revenue (gross) and Total Bookings from seeded Bookings', async () => {
    // Two confirmed Bookings: gross 10000 + 5000 = 15000.
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId: futureSlotId,
      participantCount: 2,
      grossTotalSnapshot: '10000.00',
    })
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId: futureSlotId,
      participantCount: 1,
      grossTotalSnapshot: '5000.00',
    })

    const result = await loadVendorAnalytics(db, 'u_v')

    expect(result.totalBookings).toBe(2)
    expect(result.totalRevenue).toBe(15000)
    expect(result.hasData).toBe(true)
  })

  it('Total Revenue matches the dashboard loader headline (gross, same join)', async () => {
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId: futureSlotId,
      participantCount: 2,
      grossTotalSnapshot: '7500.50',
    })

    const { loadVendorDashboard } = await import('./dashboard-loader')
    const analytics = await loadVendorAnalytics(db, 'u_v')
    const dashboard = await loadVendorDashboard(db, 'u_v')

    // The two surfaces MUST never disagree on the headline gross number.
    expect(analytics.totalRevenue).toBe(dashboard.totalRevenue)
    expect(analytics.totalBookings).toBe(dashboard.totalBookings)
  })

  it('excludes other Vendors’ Bookings (scoped by vendorUserId join)', async () => {
    // A second Vendor with its own Experience + Booking must not bleed in.
    await db.insert(users).values({ id: 'u_v2', email: 'v2@test.com', name: 'Other Vendor' })
    await db.insert(vendorProfiles).values({
      userId: 'u_v2',
      businessName: 'Other Co',
      slug: 'other-co',
      kycTier: 'business',
      responseTimeSlaScore: '100.00',
      commissionRate: '20.00',
    })
    const [exp2] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v2',
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
    const [exp2Slot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: exp2!.id,
        startAt: new Date(Date.now() + 12 * 86_400_000),
        endAt: new Date(Date.now() + 12 * 86_400_000 + 7_200_000),
        capacity: 8,
        capacityTaken: 0,
      })
      .returning({ id: availabilitySlots.id })

    // One Booking for OUR Vendor, one for the OTHER Vendor.
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId: futureSlotId,
      participantCount: 2,
      grossTotalSnapshot: '10000.00',
    })
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId: exp2!.id,
      slotId: exp2Slot!.id,
      participantCount: 1,
      grossTotalSnapshot: '2000.00',
    })

    const result = await loadVendorAnalytics(db, 'u_v')

    // Only our Vendor's single 10000 Booking counts.
    expect(result.totalBookings).toBe(1)
    expect(result.totalRevenue).toBe(10000)
  })

  it('returns the empty signal for a non-existent Vendor', async () => {
    const result = await loadVendorAnalytics(db, 'u_nonexistent')

    expect(result.totalBookings).toBe(0)
    expect(result.totalRevenue).toBe(0)
    expect(result.hasData).toBe(false)
  })

  // ── Trended Key Metrics (issue 02) — windowed against real seeded data ──

  /** Insert a confirmed Booking confirmed `daysAgo` days ago for our Vendor. */
  async function seedConfirmedBooking(opts: {
    daysAgo: number
    gross: string
    customerUserId?: string
  }) {
    const confirmedAt = new Date()
    confirmedAt.setDate(confirmedAt.getDate() - opts.daysAgo)
    await db.insert(bookings).values({
      ...baseBooking,
      customerUserId: opts.customerUserId ?? 'u_c',
      experienceId,
      slotId: futureSlotId,
      participantCount: 1,
      grossTotalSnapshot: opts.gross,
      confirmedAt,
      state: 'confirmed',
    })
  }

  it('computes Last-30-day revenue/bookings and the prior-30-day delta', async () => {
    // Prior window (31–60 days ago): 1 booking, gross 10000.
    await seedConfirmedBooking({ daysAgo: 45, gross: '10000.00' })
    // Current window (0–30 days ago): 2 bookings, gross 10000 + 5000 = 15000.
    await seedConfirmedBooking({ daysAgo: 5, gross: '10000.00' })
    await seedConfirmedBooking({ daysAgo: 20, gross: '5000.00' })

    const { keyMetrics } = await loadVendorAnalytics(db, 'u_v')

    expect(keyMetrics.last30Bookings).toBe(2)
    expect(keyMetrics.last30Revenue).toBe(15000)
    expect(keyMetrics.hasPriorPeriod).toBe(true)
    // Revenue: (15000-10000)/10000 = +50%. Bookings: (2-1)/1 = +100%.
    expect(keyMetrics.last30RevenueChange).toBe(50)
    expect(keyMetrics.last30BookingsChange).toBe(100)
  })

  it('reports no prior-period comparison when there were no prior Bookings', async () => {
    // Only current-window data — the prior window is empty.
    await seedConfirmedBooking({ daysAgo: 3, gross: '5000.00' })

    const { keyMetrics } = await loadVendorAnalytics(db, 'u_v')

    expect(keyMetrics.last30Bookings).toBe(1)
    expect(keyMetrics.hasPriorPeriod).toBe(false)
    // No fabricated "+100%" — honest null when there is nothing to compare.
    expect(keyMetrics.last30RevenueChange).toBeNull()
    expect(keyMetrics.last30BookingsChange).toBeNull()
  })

  it('computes the all-time Average Booking Value (consistent with the headline)', async () => {
    await seedConfirmedBooking({ daysAgo: 2, gross: '10000.00' })
    await seedConfirmedBooking({ daysAgo: 40, gross: '5000.00' })

    const result = await loadVendorAnalytics(db, 'u_v')

    // Average uses the all-time totals: (10000 + 5000) / 2 = 7500.
    expect(result.keyMetrics.avgBookingValue).toBe(7500)
    expect(result.keyMetrics.avgBookingValue).toBe(
      Math.floor(result.totalRevenue / result.totalBookings),
    )
  })

  it('counts Upcoming-7-day confirmed Bookings by slot start', async () => {
    // Future slot at +10 days is OUT of the 7-day window; add a +3-day slot.
    const soon = new Date()
    soon.setDate(soon.getDate() + 3)
    const soonEnd = new Date(soon)
    soonEnd.setHours(soonEnd.getHours() + 2)
    const [soonSlot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId,
        startAt: soon,
        endAt: soonEnd,
        capacity: 8,
        capacityTaken: 0,
      })
      .returning({ id: availabilitySlots.id })

    // Confirmed booking on the +3-day slot (in window).
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId: soonSlot!.id,
      participantCount: 1,
      grossTotalSnapshot: '5000.00',
      state: 'confirmed',
    })
    // Confirmed booking on the +10-day slot (out of the 7-day window).
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId: futureSlotId,
      participantCount: 1,
      grossTotalSnapshot: '5000.00',
      state: 'confirmed',
    })

    const { keyMetrics } = await loadVendorAnalytics(db, 'u_v')

    expect(keyMetrics.upcoming7Confirmed).toBe(1)
  })

  it('counts only confirmed Bookings for Upcoming-7-day (excludes cancelled)', async () => {
    const soon = new Date()
    soon.setDate(soon.getDate() + 2)
    const soonEnd = new Date(soon)
    soonEnd.setHours(soonEnd.getHours() + 2)
    const [soonSlot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId,
        startAt: soon,
        endAt: soonEnd,
        capacity: 8,
        capacityTaken: 0,
      })
      .returning({ id: availabilitySlots.id })

    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId: soonSlot!.id,
      participantCount: 1,
      grossTotalSnapshot: '5000.00',
      state: 'cancelled_by_customer',
    })

    const { keyMetrics } = await loadVendorAnalytics(db, 'u_v')

    expect(keyMetrics.upcoming7Confirmed).toBe(0)
  })

  it('counts New Bookings confirmed in the last 7 days', async () => {
    await seedConfirmedBooking({ daysAgo: 1, gross: '5000.00' }) // in 7-day window
    await seedConfirmedBooking({ daysAgo: 6, gross: '5000.00' }) // in 7-day window
    await seedConfirmedBooking({ daysAgo: 20, gross: '5000.00' }) // outside

    const { keyMetrics } = await loadVendorAnalytics(db, 'u_v')

    expect(keyMetrics.newBookings7).toBe(2)
  })

  it('computes the Cancellation Rate from the three cancelled_* states (not no_show)', async () => {
    // 2 confirmed + 1 cancelled + 1 no_show → total 4 bookings, 1 cancellation.
    await seedConfirmedBooking({ daysAgo: 3, gross: '5000.00' })
    await seedConfirmedBooking({ daysAgo: 4, gross: '5000.00' })
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId: futureSlotId,
      participantCount: 1,
      grossTotalSnapshot: '5000.00',
      state: 'cancelled_by_vendor',
    })
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId: futureSlotId,
      participantCount: 1,
      grossTotalSnapshot: '5000.00',
      state: 'no_show',
    })

    const { keyMetrics } = await loadVendorAnalytics(db, 'u_v')

    // 1 cancellation / 4 total = 25% — no_show is NOT a cancellation.
    expect(keyMetrics.cancellationRate).toBe(25)
  })

  it('reports a 0 Cancellation Rate (not NaN) for a Vendor with no Bookings', async () => {
    const { keyMetrics } = await loadVendorAnalytics(db, 'u_v')

    expect(keyMetrics.cancellationRate).toBe(0)
    expect(Number.isNaN(keyMetrics.cancellationRate)).toBe(false)
  })

  it('counts Repeat Customers (Customers with more than one Booking)', async () => {
    await db.insert(users).values([
      { id: 'u_c2', email: 'c2@test.com', name: 'Repeat Customer' },
      { id: 'u_c3', email: 'c3@test.com', name: 'One-time Customer' },
    ])
    // u_c2 books twice; u_c3 books once. Only u_c2 is a repeat customer.
    await seedConfirmedBooking({ daysAgo: 2, gross: '5000.00', customerUserId: 'u_c2' })
    await seedConfirmedBooking({ daysAgo: 3, gross: '5000.00', customerUserId: 'u_c2' })
    await seedConfirmedBooking({ daysAgo: 4, gross: '5000.00', customerUserId: 'u_c3' })

    const { keyMetrics } = await loadVendorAnalytics(db, 'u_v')

    expect(keyMetrics.repeatCustomers).toBe(1)
  })

  it('returns zero-base Key Metrics for a Vendor with no Bookings', async () => {
    const { keyMetrics } = await loadVendorAnalytics(db, 'u_v')

    expect(keyMetrics.last30Revenue).toBe(0)
    expect(keyMetrics.last30Bookings).toBe(0)
    expect(keyMetrics.last30RevenueChange).toBeNull()
    expect(keyMetrics.last30BookingsChange).toBeNull()
    expect(keyMetrics.hasPriorPeriod).toBe(false)
    expect(keyMetrics.avgBookingValue).toBe(0)
    expect(keyMetrics.upcoming7Confirmed).toBe(0)
    expect(keyMetrics.newBookings7).toBe(0)
    expect(keyMetrics.cancellationRate).toBe(0)
    expect(keyMetrics.repeatCustomers).toBe(0)
  })

  // ── Charts + breakdowns (issue 03) — windowed against real seeded data ──

  it('builds the last-30-day revenue series filled to one point per day', async () => {
    // Two Bookings 5 and 20 days ago; gross 10000 + 5000 = 15000.
    await seedConfirmedBooking({ daysAgo: 5, gross: '10000.00' })
    await seedConfirmedBooking({ daysAgo: 20, gross: '5000.00' })

    const { revenueByDay } = await loadVendorAnalytics(db, 'u_v')

    // 31 points (30 days back + today), like the dashboard trend.
    expect(revenueByDay).toHaveLength(31)
    // The two seeded days carry the gross; every other day is a filled 0.
    const nonZero = revenueByDay.filter((d) => d.value > 0)
    expect(nonZero).toHaveLength(2)
    const total = revenueByDay.reduce((sum, d) => sum + d.value, 0)
    expect(total).toBe(15000)
  })

  it('keeps the daily revenue series consistent with the last-30-day metric', async () => {
    // Internal consistency (PART B): the daily series must sum to the same gross
    // as #02's last30Revenue — both windowed by confirmedAt.
    await seedConfirmedBooking({ daysAgo: 2, gross: '7000.00' })
    await seedConfirmedBooking({ daysAgo: 25, gross: '3000.00' })

    const { revenueByDay, keyMetrics } = await loadVendorAnalytics(db, 'u_v')

    const dailyTotal = revenueByDay.reduce((sum, d) => sum + d.value, 0)
    expect(dailyTotal).toBe(keyMetrics.last30Revenue)
  })

  it('builds the monthly revenue series filled to one point per month', async () => {
    // This month + ~2 months ago. Both fall inside the rolling 12-month window.
    await seedConfirmedBooking({ daysAgo: 1, gross: '8000.00' })
    await seedConfirmedBooking({ daysAgo: 65, gross: '4000.00' })

    const { revenueByMonth } = await loadVendorAnalytics(db, 'u_v')

    // Rolling 12-month window → 12 chronological first-of-month points.
    expect(revenueByMonth).toHaveLength(MONTHS_WINDOW)
    // Each point is a first-of-month date, ordered ascending.
    for (const point of revenueByMonth) {
      expect(point.date).toMatch(/^\d{4}-\d{2}-01$/)
    }
    const dates = revenueByMonth.map((p) => p.date)
    expect([...dates].sort()).toEqual(dates)
    // The two seeded months carry gross; the window sums to 12000.
    const nonZero = revenueByMonth.filter((p) => p.value > 0)
    expect(nonZero.length).toBeGreaterThanOrEqual(1)
    const total = revenueByMonth.reduce((sum, p) => sum + p.value, 0)
    expect(total).toBe(12000)
  })

  it('breaks Bookings down by state for the Vendor', async () => {
    // 2 confirmed + 1 completed + 1 cancelled_by_customer.
    await seedConfirmedBooking({ daysAgo: 3, gross: '5000.00' })
    await seedConfirmedBooking({ daysAgo: 4, gross: '5000.00' })
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId: futureSlotId,
      participantCount: 1,
      grossTotalSnapshot: '5000.00',
      state: 'completed',
    })
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId: futureSlotId,
      participantCount: 1,
      grossTotalSnapshot: '5000.00',
      state: 'cancelled_by_customer',
    })

    const { bookingStatusBreakdown } = await loadVendorAnalytics(db, 'u_v')

    const byState = Object.fromEntries(
      bookingStatusBreakdown.map((r) => [r.state, r.count]),
    )
    expect(byState.confirmed).toBe(2)
    expect(byState.completed).toBe(1)
    expect(byState.cancelled_by_customer).toBe(1)
    // Only states that actually occur are emitted (honest — no fabricated rows).
    const totalCounted = bookingStatusBreakdown.reduce((s, r) => s + r.count, 0)
    expect(totalCounted).toBe(4)
    expect(bookingStatusBreakdown.every((r) => r.count > 0)).toBe(true)
  })

  it('lists revenue by Experience ordered by revenue desc', async () => {
    // A second Experience for the SAME Vendor, with a future slot.
    const [exp2] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'rafting-rishikesh',
        title: 'Rafting in Rishikesh',
        cancellationPreset: 'moderate',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '3000.00',
        pricePerPerson_3_5: '2800.00',
        pricePerPerson_6_plus: '2600.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'published',
      })
      .returning({ id: experiences.id })
    const [exp2Slot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: exp2!.id,
        startAt: new Date(Date.now() + 9 * 86_400_000),
        endAt: new Date(Date.now() + 9 * 86_400_000 + 7_200_000),
        capacity: 8,
        capacityTaken: 0,
      })
      .returning({ id: availabilitySlots.id })

    // exp1 (Paragliding): 2 bookings, gross 10000 + 5000 = 15000.
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId: futureSlotId,
      participantCount: 2,
      grossTotalSnapshot: '10000.00',
    })
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId: futureSlotId,
      participantCount: 1,
      grossTotalSnapshot: '5000.00',
    })
    // exp2 (Rafting): 1 booking, gross 6000.
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId: exp2!.id,
      slotId: exp2Slot!.id,
      participantCount: 2,
      grossTotalSnapshot: '6000.00',
    })

    const { revenueByExperience } = await loadVendorAnalytics(db, 'u_v')

    expect(revenueByExperience).toHaveLength(2)
    // Ordered by revenue desc: Paragliding (15000) before Rafting (6000).
    expect(revenueByExperience[0]!.title).toBe('Paragliding in Manali')
    expect(revenueByExperience[0]!.revenue).toBe(15000)
    expect(revenueByExperience[0]!.bookings).toBe(2)
    expect(revenueByExperience[1]!.title).toBe('Rafting in Rishikesh')
    expect(revenueByExperience[1]!.revenue).toBe(6000)
    expect(revenueByExperience[1]!.bookings).toBe(1)
  })

  it('excludes other Vendors’ Experiences from the revenue-by-Experience list', async () => {
    await db.insert(users).values({ id: 'u_v3', email: 'v3@test.com', name: 'Third Vendor' })
    await db.insert(vendorProfiles).values({
      userId: 'u_v3',
      businessName: 'Third Co',
      slug: 'third-co',
      kycTier: 'business',
      responseTimeSlaScore: '100.00',
      commissionRate: '20.00',
    })
    const [otherExp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v3',
        slug: 'trek-spiti',
        title: 'Trek in Spiti',
        cancellationPreset: 'moderate',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '9000.00',
        pricePerPerson_3_5: '8000.00',
        pricePerPerson_6_plus: '7000.00',
        regionSlug: 'spiti',
        activitySlug: 'trekking',
        status: 'published',
      })
      .returning({ id: experiences.id })
    const [otherSlot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: otherExp!.id,
        startAt: new Date(Date.now() + 11 * 86_400_000),
        endAt: new Date(Date.now() + 11 * 86_400_000 + 7_200_000),
        capacity: 8,
        capacityTaken: 0,
      })
      .returning({ id: availabilitySlots.id })

    // Our Vendor: 1 booking. Other Vendor: 1 booking that must NOT bleed in.
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId,
      slotId: futureSlotId,
      participantCount: 1,
      grossTotalSnapshot: '5000.00',
    })
    await db.insert(bookings).values({
      ...baseBooking,
      experienceId: otherExp!.id,
      slotId: otherSlot!.id,
      participantCount: 1,
      grossTotalSnapshot: '9000.00',
    })

    const { revenueByExperience } = await loadVendorAnalytics(db, 'u_v')

    expect(revenueByExperience).toHaveLength(1)
    expect(revenueByExperience[0]!.title).toBe('Paragliding in Manali')
    expect(revenueByExperience.some((e) => e.title === 'Trek in Spiti')).toBe(false)
  })

  it('returns honest empty breakdowns for a Vendor with no Bookings', async () => {
    const result = await loadVendorAnalytics(db, 'u_v')

    // The day/month series are still FILLED windows (one point per period), but
    // every value is 0 — the page keys its empty state off the all-zero sum.
    expect(result.revenueByDay).toHaveLength(31)
    expect(result.revenueByDay.every((d) => d.value === 0)).toBe(true)
    expect(result.revenueByMonth).toHaveLength(MONTHS_WINDOW)
    expect(result.revenueByMonth.every((m) => m.value === 0)).toBe(true)
    // The breakdown + by-Experience lists are empty (no fabricated rows).
    expect(result.bookingStatusBreakdown).toEqual([])
    expect(result.revenueByExperience).toEqual([])
    // The daily-breakdown table omits empty days entirely (no 0/₹0 rows).
    expect(result.dailyBreakdown).toEqual([])
  })

  it('builds the daily breakdown (non-empty days, newest first, gross) consistent with the chart', async () => {
    // Two Bookings on the SAME day (5 days ago → one aggregated row) + one 20
    // days ago. The empty days between them must NOT appear as rows. Interior
    // days are used (not today) so the chart's fill is stable for the
    // consistency assertion — the today edge has a separate fill quirk.
    await seedConfirmedBooking({ daysAgo: 5, gross: '10000.00' })
    await seedConfirmedBooking({ daysAgo: 5, gross: '5000.00' })
    await seedConfirmedBooking({ daysAgo: 20, gross: '7000.00' })

    const { dailyBreakdown, revenueByDay } = await loadVendorAnalytics(db, 'u_v')

    // Exactly two distinct days had Bookings — no filled 0-day rows.
    expect(dailyBreakdown).toHaveLength(2)
    expect(dailyBreakdown.every((r) => r.bookings > 0)).toBe(true)

    // Newest day first (5-days-ago before 20-days-ago).
    const dates = dailyBreakdown.map((r) => r.date)
    expect([...dates].sort().reverse()).toEqual(dates)

    // The newest row aggregates BOTH same-day Bookings: 2 bookings, gross 15000.
    const newest = dailyBreakdown[0]!
    expect(newest.bookings).toBe(2)
    expect(newest.revenue).toBe(15000)

    // Consistency: the table's rows match the chart's non-zero points 1:1 and
    // sum to the same gross (both derive from the same confirmedAt-windowed
    // daily aggregate).
    const chartNonZero = revenueByDay.filter((d) => d.value > 0)
    expect(dailyBreakdown).toHaveLength(chartNonZero.length)
    const tableRevenueTotal = dailyBreakdown.reduce((s, r) => s + r.revenue, 0)
    const chartRevenueTotal = chartNonZero.reduce((s, d) => s + d.value, 0)
    expect(tableRevenueTotal).toBe(chartRevenueTotal)
  })

  // ── Regression guard (issue 03 AC): the existing dashboard-home charts must
  //    remain present and UNCHANGED. The two dashboard charts are fed by
  //    `bookingsTrend` + `revenueTrend`; the analytics page only IMPORTS the
  //    shared `TrendChart` and never touches the dashboard loader. Assert the
  //    dashboard loader still returns BOTH trend series (robust loader-contract
  //    assertion — not a brittle DOM/string check). ──
  it('leaves the dashboard-home chart data sources (bookingsTrend + revenueTrend) intact', async () => {
    await seedConfirmedBooking({ daysAgo: 2, gross: '5000.00' })

    const { loadVendorDashboard } = await import('./dashboard-loader')
    const dashboard = await loadVendorDashboard(db, 'u_v')

    // Both dashboard-chart data sources still present, still 31-day filled.
    expect(Array.isArray(dashboard.bookingsTrend)).toBe(true)
    expect(Array.isArray(dashboard.revenueTrend)).toBe(true)
    expect(dashboard.bookingsTrend).toHaveLength(31)
    expect(dashboard.revenueTrend).toHaveLength(31)
  })
})
