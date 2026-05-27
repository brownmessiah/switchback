import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  loadBookingsForCsv,
  loadExperiencesForCsv,
  loadReportSummary,
  loadUsersForCsv,
  loadVendorsForCsv,
  toCsv,
} from './loaders'

// ── Seed helpers ───────────────────────────────────────────────────

async function seedCustomer(db: TestDB, id = 'cust_rpt_1'): Promise<string> {
  await db.insert(users).values({ id, email: `${id}@test.com`, name: 'Alice' })
  return id
}

async function seedVendor(db: TestDB, id = 'vendor_rpt_1'): Promise<string> {
  await db.insert(users).values({ id, email: `${id}@test.com`, name: 'Bob Vendor' })
  await db.insert(vendorProfiles).values({
    userId: id,
    businessName: 'Mountain Co',
    slug: `mountain-co-${id}`,
    kycTier: 'identity',
    commissionRate: '20.00',
  })
  return id
}

async function seedExperience(db: TestDB, vendorId: string, slug?: string): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(experiences).values({
    id,
    vendorUserId: vendorId,
    slug: slug ?? `exp-${id.slice(0, 8)}`,
    title: 'Paragliding',
    status: 'published',
    cancellationPreset: 'flexible',
    paymentModesAllowed: ['full_upfront'],
    pricePerPerson_1_2: '3000.00',
    pricePerPerson_3_5: '2500.00',
    pricePerPerson_6_plus: '2000.00',
    regionSlug: 'manali',
    activitySlug: 'paragliding',
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
  overrides: { grossTotal?: string } = {},
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
    grossTotalSnapshot: overrides.grossTotal ?? '6000.00',
    pricePerParticipantSnapshot: '3000.00',
    pricingBasisSnapshot: '1_2',
    commissionRateSnapshot: '20.00',
    commissionBasisSnapshot: 'vendor_base_rate',
    cancellationPresetSnapshot: 'flexible',
    tdsAmountSnapshot: '6.00',
    gstRateOnCommissionSnapshot: '18.00',
    vendorIsResidentSnapshot: true,
  })
  return id
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Admin reports loaders', () => {
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

  // ── loadReportSummary ───────────────────────────────────────────

  describe('loadReportSummary', () => {
    it('returns zero counts when no data exists', async () => {
      const summary = await loadReportSummary(db)
      expect(summary).toEqual({
        totalUsers: 0,
        totalVendors: 0,
        totalExperiences: 0,
        totalBookings: 0,
        totalRevenue: 0,
      })
    })

    it('returns correct counts and revenue with seeded data', async () => {
      const custId = await seedCustomer(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId)
      const slotId = await seedSlot(db, expId)
      await seedBooking(db, custId, expId, slotId, { grossTotal: '10000.00' })
      await seedBooking(db, custId, expId, slotId, { grossTotal: '5000.00' })

      const summary = await loadReportSummary(db)
      // 2 users: customer + vendor
      expect(summary.totalUsers).toBe(2)
      expect(summary.totalVendors).toBe(1)
      expect(summary.totalExperiences).toBe(1)
      expect(summary.totalBookings).toBe(2)
      expect(summary.totalRevenue).toBe(15000)
    })
  })

  // ── CSV export queries ──────────────────────────────────────────

  describe('loadUsersForCsv', () => {
    it('returns correct data shape', async () => {
      await seedCustomer(db, 'csv_user_1')

      const rows = await loadUsersForCsv(db)
      expect(rows).toHaveLength(1)
      const row = rows[0]!
      expect(row).toHaveProperty('id', 'csv_user_1')
      expect(row).toHaveProperty('email', 'csv_user_1@test.com')
      expect(row).toHaveProperty('name', 'Alice')
      expect(row).toHaveProperty('emailVerified')
      expect(row).toHaveProperty('phoneNumber')
      expect(row).toHaveProperty('createdAt')
      expect(row.createdAt).toBeInstanceOf(Date)
    })
  })

  describe('loadBookingsForCsv', () => {
    it('returns correct data shape with joined fields', async () => {
      const custId = await seedCustomer(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId)
      const slotId = await seedSlot(db, expId)
      await seedBooking(db, custId, expId, slotId)

      const rows = await loadBookingsForCsv(db)
      expect(rows).toHaveLength(1)
      const row = rows[0]!
      expect(row).toHaveProperty('id')
      expect(row).toHaveProperty('state', 'confirmed')
      expect(row).toHaveProperty('participantCount', 2)
      expect(row).toHaveProperty('grossTotalSnapshot', '6000.00')
      expect(row).toHaveProperty('paymentMode', 'full_upfront')
      expect(row).toHaveProperty('commissionRateSnapshot', '20.00')
      expect(row).toHaveProperty('customerEmail', `${custId}@test.com`)
      expect(row).toHaveProperty('experienceTitle', 'Paragliding')
      expect(row).toHaveProperty('vendorBusinessName', 'Mountain Co')
      expect(row).toHaveProperty('confirmedAt')
      expect(row.confirmedAt).toBeInstanceOf(Date)
    })

    it('returns empty array when no bookings exist', async () => {
      const rows = await loadBookingsForCsv(db)
      expect(rows).toEqual([])
    })
  })

  // ── toCsv ───────────────────────────────────────────────────────

  describe('toCsv', () => {
    it('generates valid CSV with headers and data', () => {
      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]
      const csv = toCsv(data, ['name', 'age'])
      expect(csv).toBe('name,age\nAlice,30\nBob,25')
    })

    it('escapes commas and quotes per RFC 4180', () => {
      const data = [{ name: 'Smith, "Jr."', city: 'New York' }]
      const csv = toCsv(data, ['name', 'city'])
      expect(csv).toBe('name,city\n"Smith, ""Jr.""",New York')
    })

    it('handles null and undefined values', () => {
      const data = [{ name: null, email: undefined }]
      const csv = toCsv(data as unknown as Record<string, unknown>[], ['name', 'email'])
      expect(csv).toBe('name,email\n,')
    })

    it('formats Date objects as ISO strings', () => {
      const d = new Date('2026-01-15T10:00:00Z')
      const data = [{ date: d }]
      const csv = toCsv(data, ['date'])
      expect(csv).toContain('2026-01-15')
    })
  })
})
