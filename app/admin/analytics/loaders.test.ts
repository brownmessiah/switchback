import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { payments } from '@/db/schema/payments'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  loadAnalyticsKpi,
  loadBookingVolume,
  loadCategoryPerformance,
  loadRevenueTrend,
  loadVendorGrowth,
} from './loaders'

// ── Seed helpers ───────────────────────────────────────────────────

async function seedCustomer(db: TestDB, id = 'cust_ana_1'): Promise<string> {
  await db.insert(users).values({ id, email: `${id}@test.com`, name: 'Customer' })
  return id
}

async function seedVendor(db: TestDB, id = 'vendor_ana_1'): Promise<string> {
  await db.insert(users).values({ id, email: `${id}@test.com`, name: 'Vendor' })
  await db.insert(vendorProfiles).values({
    userId: id,
    businessName: 'Adventure Co',
    slug: `adventure-co-${id}`,
    kycTier: 'identity',
    commissionRate: '20.00',
  })
  return id
}

async function seedExperience(
  db: TestDB,
  vendorId: string,
  overrides: { activitySlug?: string; status?: 'draft' | 'published' } = {},
): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(experiences).values({
    id,
    vendorUserId: vendorId,
    slug: `exp-${id.slice(0, 8)}`,
    title: 'Kayaking',
    status: overrides.status ?? 'published',
    cancellationPreset: 'flexible',
    paymentModesAllowed: ['full_upfront'],
    pricePerPerson_1_2: '2000.00',
    pricePerPerson_3_5: '1500.00',
    pricePerPerson_6_plus: '1200.00',
    regionSlug: 'rishikesh',
    activitySlug: overrides.activitySlug ?? 'kayaking',
  })
  return id
}

async function seedSlot(db: TestDB, experienceId: string): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(availabilitySlots).values({
    id,
    experienceId,
    startAt: new Date('2026-07-01T09:00:00Z'),
    endAt: new Date('2026-07-01T12:00:00Z'),
    capacity: 10,
    capacityTaken: 2,
  })
  return id
}

async function seedBooking(
  db: TestDB,
  customerId: string,
  experienceId: string,
  slotId: string,
  overrides: { grossTotal?: string; confirmedAt?: Date } = {},
): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(bookings).values({
    id,
    customerUserId: customerId,
    experienceId,
    slotId,
    participantCount: 2,
    state: 'confirmed',
    paymentMode: 'full_upfront',
    grossTotalSnapshot: overrides.grossTotal ?? '4000.00',
    pricePerParticipantSnapshot: '2000.00',
    pricingBasisSnapshot: '1_2',
    commissionRateSnapshot: '20.00',
    commissionBasisSnapshot: 'vendor_base_rate',
    cancellationPresetSnapshot: 'flexible',
    tdsAmountSnapshot: '4.00',
    gstRateOnCommissionSnapshot: '18.00',
    vendorIsResidentSnapshot: true,
    ...(overrides.confirmedAt ? { confirmedAt: overrides.confirmedAt } : {}),
  })
  return id
}

async function seedPayment(
  db: TestDB,
  bookingId: string,
  overrides: { amount?: string; capturedAt?: Date } = {},
): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(payments).values({
    id,
    bookingId,
    razorpayPaymentId: `pay_${id.slice(0, 14)}`,
    amount: overrides.amount ?? '4000.00',
    captureTrigger: 'booking_create',
    ...(overrides.capturedAt ? { capturedAt: overrides.capturedAt } : {}),
  })
  return id
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Admin analytics loaders', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE payments, refund_requests, bookings, availability_slots, experiences, vendor_profiles, users CASCADE`,
    )
  })

  // ── loadAnalyticsKpi ────────────────────────────────────────────

  describe('loadAnalyticsKpi', () => {
    it('returns zero KPIs when no data exists', async () => {
      const kpi = await loadAnalyticsKpi(db)
      expect(kpi).toEqual({
        totalRevenue: 0,
        totalBookings: 0,
        totalUsers: 0,
        totalVendors: 0,
        averageBookingValue: 0,
        publishedExperiences: 0,
      })
    })

    it('computes correct KPIs with seeded data', async () => {
      const custId = await seedCustomer(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, { status: 'published' })
      await seedExperience(db, vendorId, { status: 'draft' })
      const slotId = await seedSlot(db, expId)
      await seedBooking(db, custId, expId, slotId, { grossTotal: '8000.00' })
      await seedBooking(db, custId, expId, slotId, { grossTotal: '4000.00' })

      const kpi = await loadAnalyticsKpi(db)
      expect(kpi.totalUsers).toBe(2) // customer + vendor
      expect(kpi.totalVendors).toBe(1)
      expect(kpi.totalBookings).toBe(2)
      expect(kpi.totalRevenue).toBe(12000)
      expect(kpi.averageBookingValue).toBe(6000)
      expect(kpi.publishedExperiences).toBe(1) // only published, not draft
    })
  })

  // ── loadRevenueTrend ────────────────────────────────────────────

  describe('loadRevenueTrend', () => {
    it('returns month data points (includes zero-fill)', async () => {
      const trend = await loadRevenueTrend(db)
      // Should have 13 months (12 months ago to current month)
      expect(trend.length).toBeGreaterThanOrEqual(12)
      for (const point of trend) {
        expect(point).toHaveProperty('month')
        expect(point).toHaveProperty('value')
        expect(point.month).toMatch(/^\d{4}-\d{2}$/)
        expect(typeof point.value).toBe('number')
      }
    })

    it('includes payment amounts in correct month', async () => {
      const custId = await seedCustomer(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId)
      const slotId = await seedSlot(db, expId)
      const bookingId = await seedBooking(db, custId, expId, slotId)

      const now = new Date()
      await seedPayment(db, bookingId, { amount: '5000.00', capturedAt: now })

      const trend = await loadRevenueTrend(db)
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const currentMonthPoint = trend.find((t) => t.month === currentMonth)
      expect(currentMonthPoint).toBeDefined()
      expect(currentMonthPoint!.value).toBe(5000)
    })
  })

  // ── loadBookingVolume ───────────────────────────────────────────

  describe('loadBookingVolume', () => {
    it('returns week-level data points', async () => {
      const custId = await seedCustomer(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId)
      const slotId = await seedSlot(db, expId)
      await seedBooking(db, custId, expId, slotId)

      const volume = await loadBookingVolume(db)
      // At least 1 week has data
      expect(volume.length).toBeGreaterThanOrEqual(1)
      const point = volume[0]!
      expect(point).toHaveProperty('week')
      expect(point).toHaveProperty('value')
      expect(point.week).toMatch(/^\d{4}-W\d{2}$/)
      expect(point.value).toBeGreaterThan(0)
    })

    it('returns empty array when no bookings in last 12 weeks', async () => {
      const volume = await loadBookingVolume(db)
      expect(volume).toEqual([])
    })
  })

  // ── loadVendorGrowth ────────────────────────────────────────────

  describe('loadVendorGrowth', () => {
    it('includes vendor created this month', async () => {
      await seedVendor(db)

      const growth = await loadVendorGrowth(db)
      const now = new Date()
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const currentMonthPoint = growth.find((g) => g.month === currentMonth)
      expect(currentMonthPoint).toBeDefined()
      expect(currentMonthPoint!.value).toBe(1)
    })
  })

  // ── loadCategoryPerformance ─────────────────────────────────────

  describe('loadCategoryPerformance', () => {
    it('groups bookings by activity slug', async () => {
      const custId = await seedCustomer(db)
      const vendorId = await seedVendor(db)
      const kayakExpId = await seedExperience(db, vendorId, { activitySlug: 'kayaking' })
      const raftExpId = await seedExperience(db, vendorId, { activitySlug: 'rafting' })
      const slotK = await seedSlot(db, kayakExpId)
      const slotR = await seedSlot(db, raftExpId)
      await seedBooking(db, custId, kayakExpId, slotK)
      await seedBooking(db, custId, kayakExpId, slotK)
      await seedBooking(db, custId, raftExpId, slotR)

      const cats = await loadCategoryPerformance(db)
      expect(cats).toHaveLength(2)
      // Sorted by count desc — kayaking first
      expect(cats[0]!.name).toBe('kayaking')
      expect(cats[0]!.value).toBe(2)
      expect(cats[1]!.name).toBe('rafting')
      expect(cats[1]!.value).toBe(1)
    })

    it('returns empty array when no bookings exist', async () => {
      const cats = await loadCategoryPerformance(db)
      expect(cats).toEqual([])
    })
  })
})
