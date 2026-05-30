import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { loadBookingDetail, loadBookingsList } from './loaders'

// ── Seed helpers ───────────────────────────────────────────────────

async function seedCustomer(db: TestDB): Promise<string> {
  const id = 'cust_bookings_1'
  await db.insert(users).values({ id, email: 'customer@test.com', name: 'Alice Customer' })
  return id
}

async function seedVendor(db: TestDB): Promise<string> {
  const vendorId = 'vendor_bookings_1'
  await db.insert(users).values({ id: vendorId, email: 'vendor@test.com', name: 'Bob Vendor' })
  await db.insert(vendorProfiles).values({
    userId: vendorId,
    businessName: 'River Adventures',
    slug: 'river-adventures',
    kycTier: 'identity',
    commissionRate: '20.00',
  })
  return vendorId
}

async function seedExperience(db: TestDB, vendorId: string): Promise<string> {
  const expId = crypto.randomUUID()
  await db.insert(experiences).values({
    id: expId,
    vendorUserId: vendorId,
    slug: `exp-${expId.slice(0, 8)}`,
    title: 'White Water Rafting',
    status: 'published',
    cancellationPreset: 'moderate',
    paymentModesAllowed: ['full_upfront'],
    pricePerPerson_1_2: '2500.00',
    pricePerPerson_3_5: '2000.00',
    pricePerPerson_6_plus: '1800.00',
    regionSlug: 'rishikesh',
    activitySlug: 'rafting',
  })
  return expId
}

async function seedSlot(db: TestDB, experienceId: string): Promise<string> {
  const slotId = crypto.randomUUID()
  const startAt = new Date('2026-06-15T09:00:00Z')
  const endAt = new Date('2026-06-15T12:00:00Z')
  await db.insert(availabilitySlots).values({
    id: slotId,
    experienceId,
    startAt,
    endAt,
    capacity: 10,
    capacityTaken: 2,
  })
  return slotId
}

async function seedBooking(
  db: TestDB,
  customerId: string,
  experienceId: string,
  slotId: string,
  overrides: {
    id?: string
    state?: 'confirmed' | 'completed' | 'cancelled_by_customer'
    grossTotal?: string
    paymentMode?: 'full_upfront' | 'partial_pay'
  } = {},
): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID()
  await db.insert(bookings).values({
    id,
    customerUserId: customerId,
    experienceId,
    slotId,
    participantCount: 2,
    state: overrides.state ?? 'confirmed',
    paymentMode: overrides.paymentMode ?? 'full_upfront',
    grossTotalSnapshot: overrides.grossTotal ?? '5000.00',
    pricePerParticipantSnapshot: '2500.00',
    pricingBasisSnapshot: '1_2',
    commissionRateSnapshot: '20.00',
    commissionBasisSnapshot: 'vendor_base_rate',
    cancellationPresetSnapshot: 'moderate',
    tdsAmountSnapshot: '5.00',
    tcsAmountSnapshot: '25.00',
    gstRateOnCommissionSnapshot: '18.00',
    vendorIsResidentSnapshot: true,
  })
  return id
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Admin bookings loaders', () => {
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

  // ── loadBookingsList ─────────────────────────────────────────────

  describe('loadBookingsList', () => {
    it('returns bookings with joined customer, vendor, experience fields', async () => {
      const customerId = await seedCustomer(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId)
      const slotId = await seedSlot(db, expId)
      await seedBooking(db, customerId, expId, slotId)

      const rows = await loadBookingsList(db)

      expect(rows).toHaveLength(1)
      const row = rows[0]!
      expect(row.customerName).toBe('Alice Customer')
      expect(row.vendorBusinessName).toBe('River Adventures')
      expect(row.experienceTitle).toBe('White Water Rafting')
      expect(row.state).toBe('confirmed')
      expect(row.participantCount).toBe(2)
      expect(row.grossTotalSnapshot).toBe('5000.00')
      expect(row.paymentMode).toBe('full_upfront')
      // Slot start is joined
      expect(row.slotStart).toBeInstanceOf(Date)
    })

    it('returns empty array when no bookings exist', async () => {
      const rows = await loadBookingsList(db)
      expect(rows).toEqual([])
    })

    it('filters by state', async () => {
      const customerId = await seedCustomer(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId)
      const slotId = await seedSlot(db, expId)
      await seedBooking(db, customerId, expId, slotId, { state: 'confirmed' })
      await seedBooking(db, customerId, expId, slotId, { state: 'completed' })

      const confirmed = await loadBookingsList(db, { state: 'confirmed' })
      expect(confirmed).toHaveLength(1)
      expect(confirmed[0]!.state).toBe('confirmed')

      const completed = await loadBookingsList(db, { state: 'completed' })
      expect(completed).toHaveLength(1)
      expect(completed[0]!.state).toBe('completed')
    })
  })

  // ── loadBookingDetail ────────────────────────────────────────────

  describe('loadBookingDetail', () => {
    it('returns booking with all snapshot fields, payments, and refunds', async () => {
      const customerId = await seedCustomer(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId)
      const slotId = await seedSlot(db, expId)
      const bookingId = await seedBooking(db, customerId, expId, slotId)

      const result = await loadBookingDetail(db, bookingId)

      expect(result).not.toBeNull()
      expect(result!.booking.id).toBe(bookingId)
      expect(result!.booking.customerName).toBe('Alice Customer')
      expect(result!.booking.vendorBusinessName).toBe('River Adventures')
      expect(result!.booking.experienceTitle).toBe('White Water Rafting')
      expect(result!.booking.commissionRateSnapshot).toBe('20.00')
      expect(result!.booking.cancellationPresetSnapshot).toBe('moderate')
      expect(result!.booking.tdsAmountSnapshot).toBe('5.00')
      // #102: the detail loader must surface the TCS (§52) snapshot so the
      // page can drive the COMPLETE ADR-0016 waterfall via computeVendorNetPayout.
      expect(result!.booking.tcsAmountSnapshot).toBe('25.00')
      expect(result!.payments).toEqual([])
      expect(result!.refunds).toEqual([])
    })

    it('returns null for non-existent booking', async () => {
      const result = await loadBookingDetail(db, '00000000-0000-0000-0000-000000000000')
      expect(result).toBeNull()
    })
  })
})
