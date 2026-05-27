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

import { loadVendorDashboard, slaColor } from './dashboard-loader'

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
