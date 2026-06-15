import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { loadVendorAnalytics, shapeAnalytics } from './analytics-loader'

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
})
