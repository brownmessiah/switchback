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
  loadVendorAnalytics,
  shapeAnalytics,
  shapeKeyMetrics,
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
})
