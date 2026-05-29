import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeApprovePayout,
  executeHoldPayout,
  executeRejectPayout,
} from './actions'

// ── Test helpers ────────────────────────────────────────────────────

async function seedAdmin(db: TestDB): Promise<string> {
  const adminId = 'admin_payout_1'
  await db.insert(users).values({ id: adminId, email: 'admin-payout@test.com' })
  return adminId
}

async function seedVendorWithProfile(
  db: TestDB,
  overrides: { manualPayoutsRemaining?: number } = {},
): Promise<string> {
  const vendorId = 'vendor_payout_1'
  await db.insert(users).values({ id: vendorId, email: 'vendor-payout@test.com' })
  await db.insert(vendorProfiles).values({
    userId: vendorId,
    businessName: 'Payout Test Co',
    slug: 'payout-test-co',
    kycTier: 'identity',
    commissionRate: '20.00',
    manualPayoutsRemaining: overrides.manualPayoutsRemaining ?? 3,
  })
  return vendorId
}

async function seedCompletedBooking(
  db: TestDB,
  vendorId: string,
  overrides: {
    bookingId?: string
    payoutState?: 'pending' | 'approved' | 'rejected' | 'held'
  } = {},
): Promise<string> {
  const customerId = `customer_${crypto.randomUUID().slice(0, 8)}`
  await db
    .insert(users)
    .values({ id: customerId, email: `${customerId}@test.com` })

  const expId = crypto.randomUUID()
  await db.insert(experiences).values({
    id: expId,
    vendorUserId: vendorId,
    slug: `exp-${expId.slice(0, 8)}`,
    title: 'Test Experience',
    status: 'published',
    cancellationPreset: 'moderate',
    paymentModesAllowed: ['full_upfront'],
    pricePerPerson_1_2: '2500.00',
    pricePerPerson_3_5: '2000.00',
    pricePerPerson_6_plus: '1800.00',
    regionSlug: 'rishikesh',
    activitySlug: 'rafting',
  })

  const slotId = crypto.randomUUID()
  const startAt = new Date('2026-07-01T03:30:00Z') // 09:00 IST
  const endAt = new Date('2026-07-01T05:30:00Z') // 11:00 IST
  await db.insert(availabilitySlots).values({
    id: slotId,
    experienceId: expId,
    startAt,
    endAt,
    capacity: 10,
    capacityTaken: 2,
  })

  const bookingId = overrides.bookingId ?? crypto.randomUUID()
  await db.insert(bookings).values({
    id: bookingId,
    customerUserId: customerId,
    experienceId: expId,
    slotId,
    participantCount: 2,
    state: 'completed',
    paymentMode: 'full_upfront',
    grossTotalSnapshot: '5000.00',
    pricePerParticipantSnapshot: '2500.00',
    pricingBasisSnapshot: 'experience_bracket:1_2',
    commissionRateSnapshot: '20.00',
    commissionBasisSnapshot: 'vendor_default',
    cancellationPresetSnapshot: 'moderate',
    tdsAmountSnapshot: '50.00',
    gstRateOnCommissionSnapshot: '18.00',
    completedAt: new Date(),
    payoutState: overrides.payoutState ?? 'pending',
  })

  return bookingId
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Admin payout processing actions', () => {
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
      sql`TRUNCATE TABLE audit_logs, bookings, availability_slots, experiences, vendor_profiles, users CASCADE`,
    )
  })

  // ── Approve Payout ──────────────────────────────────────────────

  describe('executeApprovePayout', () => {
    it('transitions pending → approved and creates audit log', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendorWithProfile(db, { manualPayoutsRemaining: 2 })
      const bookingId = await seedCompletedBooking(db, vendorId)

      const result = await executeApprovePayout(db, adminId, { bookingId })

      expect(result).toEqual({ ok: true })

      // Verify payout state updated
      const [booking] = await db
        .select({ payoutState: bookings.payoutState })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(booking?.payoutState).toBe('approved')

      // Verify audit log
      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]?.action).toBe('admin.payout.approve')
      expect(logs[0]?.entityType).toBe('booking')
      expect(logs[0]?.entityId).toBe(bookingId)
      expect(logs[0]?.actorUserId).toBe(adminId)
      expect(logs[0]?.payload).toMatchObject({
        previousPayoutState: 'pending',
        newPayoutState: 'approved',
      })
    })

    it('decrements manualPayoutsRemaining when > 0', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendorWithProfile(db, { manualPayoutsRemaining: 2 })
      const bookingId = await seedCompletedBooking(db, vendorId)

      const result = await executeApprovePayout(db, adminId, { bookingId })
      expect(result).toEqual({ ok: true })

      // Verify manualPayoutsRemaining decremented
      const [vendor] = await db
        .select({ manualPayoutsRemaining: vendorProfiles.manualPayoutsRemaining })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, vendorId))
      expect(vendor?.manualPayoutsRemaining).toBe(1)

      // Verify audit log includes decrement info
      const [log] = await db.select().from(auditLogs)
      expect(log?.payload).toMatchObject({
        manualPayoutsRemainingBefore: 2,
        manualPayoutsRemainingAfter: 1,
      })
    })

    it('does NOT decrement manualPayoutsRemaining when already 0', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendorWithProfile(db, { manualPayoutsRemaining: 0 })
      const bookingId = await seedCompletedBooking(db, vendorId)

      const result = await executeApprovePayout(db, adminId, { bookingId })
      expect(result).toEqual({ ok: true })

      // Verify manualPayoutsRemaining stays at 0
      const [vendor] = await db
        .select({ manualPayoutsRemaining: vendorProfiles.manualPayoutsRemaining })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, vendorId))
      expect(vendor?.manualPayoutsRemaining).toBe(0)

      // Verify audit log reflects no decrement
      const [log] = await db.select().from(auditLogs)
      expect(log?.payload).toMatchObject({
        manualPayoutsRemainingBefore: 0,
        manualPayoutsRemainingAfter: 0,
      })
    })

    it('rejects approval of already-approved payout', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendorWithProfile(db)
      const bookingId = await seedCompletedBooking(db, vendorId, {
        payoutState: 'approved',
      })

      const result = await executeApprovePayout(db, adminId, { bookingId })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('pending')
      }
    })

    it('allows approval of held payout (un-hold → approve)', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendorWithProfile(db, { manualPayoutsRemaining: 1 })
      const bookingId = await seedCompletedBooking(db, vendorId, {
        payoutState: 'held',
      })

      const result = await executeApprovePayout(db, adminId, { bookingId })
      expect(result).toEqual({ ok: true })

      const [booking] = await db
        .select({ payoutState: bookings.payoutState })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(booking?.payoutState).toBe('approved')
    })

    it('returns error for non-existent booking', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeApprovePayout(db, adminId, {
        bookingId: '00000000-0000-0000-0000-000000000000',
      })

      expect(result).toEqual({ ok: false, error: 'Booking not found.' })
    })

    it('rejects approval of non-completed booking state', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendorWithProfile(db)

      // Seed a confirmed (non-completed) booking
      const customerId = 'customer_confirm_test'
      await db.insert(users).values({ id: customerId, email: 'cust-confirm@test.com' })

      const expId = crypto.randomUUID()
      await db.insert(experiences).values({
        id: expId,
        vendorUserId: vendorId,
        slug: `exp-confirm-${expId.slice(0, 8)}`,
        title: 'Confirmed Exp',
        status: 'published',
        cancellationPreset: 'moderate',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '2500.00',
        pricePerPerson_3_5: '2000.00',
        pricePerPerson_6_plus: '1800.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })

      const slotId = crypto.randomUUID()
      const startAt = new Date('2026-07-01T03:30:00Z')
      const endAt = new Date('2026-07-01T05:30:00Z')
      await db.insert(availabilitySlots).values({
        id: slotId,
        experienceId: expId,
        startAt,
        endAt,
        capacity: 10,
        capacityTaken: 2,
      })

      const bookingId = crypto.randomUUID()
      await db.insert(bookings).values({
        id: bookingId,
        customerUserId: customerId,
        experienceId: expId,
        slotId,
        participantCount: 2,
        state: 'confirmed',
        paymentMode: 'full_upfront',
        grossTotalSnapshot: '5000.00',
        pricePerParticipantSnapshot: '2500.00',
        pricingBasisSnapshot: 'experience_bracket:1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: 'moderate',
        tdsAmountSnapshot: '50.00',
        gstRateOnCommissionSnapshot: '18.00',
      })

      const result = await executeApprovePayout(db, adminId, { bookingId })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('completed')
      }
    })
  })

  // ── Hold Payout ─────────────────────────────────────────────────

  describe('executeHoldPayout', () => {
    it('transitions pending → held and creates audit log', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendorWithProfile(db)
      const bookingId = await seedCompletedBooking(db, vendorId)

      const result = await executeHoldPayout(db, adminId, {
        bookingId,
        reason: 'Dispute under investigation',
      })

      expect(result).toEqual({ ok: true })

      // Verify payout state
      const [booking] = await db
        .select({ payoutState: bookings.payoutState })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(booking?.payoutState).toBe('held')

      // Verify audit log
      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]?.action).toBe('admin.payout.hold')
      expect(logs[0]?.entityType).toBe('booking')
      expect(logs[0]?.entityId).toBe(bookingId)
      expect(logs[0]?.payload).toMatchObject({
        previousPayoutState: 'pending',
        newPayoutState: 'held',
        reason: 'Dispute under investigation',
      })
    })

    it('prevents processing of held payout (cannot approve a held payout without explicit un-hold)', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendorWithProfile(db)
      const bookingId = await seedCompletedBooking(db, vendorId, {
        payoutState: 'held',
      })

      // Trying to hold an already-held payout should fail
      const result = await executeHoldPayout(db, adminId, {
        bookingId,
        reason: 'Already held',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('pending')
      }
    })

    it('rejects hold on already-approved payout', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendorWithProfile(db)
      const bookingId = await seedCompletedBooking(db, vendorId, {
        payoutState: 'approved',
      })

      const result = await executeHoldPayout(db, adminId, {
        bookingId,
        reason: 'Too late',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('pending')
      }
    })
  })

  // ── Reject Payout ────────────────────────────────────────────────

  describe('executeRejectPayout', () => {
    it('transitions pending → rejected with reason and creates audit log', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendorWithProfile(db)
      const bookingId = await seedCompletedBooking(db, vendorId)

      const result = await executeRejectPayout(db, adminId, {
        bookingId,
        reason: 'Fraudulent activity suspected',
      })

      expect(result).toEqual({ ok: true })

      // Verify payout state + reason
      const [booking] = await db
        .select({
          payoutState: bookings.payoutState,
          payoutRejectionReason: bookings.payoutRejectionReason,
        })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(booking?.payoutState).toBe('rejected')
      expect(booking?.payoutRejectionReason).toBe('Fraudulent activity suspected')

      // Verify audit log
      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]?.action).toBe('admin.payout.reject')
      expect(logs[0]?.payload).toMatchObject({
        previousPayoutState: 'pending',
        newPayoutState: 'rejected',
        reason: 'Fraudulent activity suspected',
      })
    })

    it('requires reason text (rejects empty string)', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendorWithProfile(db)
      const bookingId = await seedCompletedBooking(db, vendorId)

      const result = await executeRejectPayout(db, adminId, {
        bookingId,
        reason: '',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Reason is required')
      }

      // Payout state unchanged
      const [booking] = await db
        .select({ payoutState: bookings.payoutState })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(booking?.payoutState).toBe('pending')
    })

    it('allows rejecting a held payout', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendorWithProfile(db)
      const bookingId = await seedCompletedBooking(db, vendorId, {
        payoutState: 'held',
      })

      const result = await executeRejectPayout(db, adminId, {
        bookingId,
        reason: 'Customer won dispute',
      })

      expect(result).toEqual({ ok: true })

      const [booking] = await db
        .select({ payoutState: bookings.payoutState })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(booking?.payoutState).toBe('rejected')
    })

    it('rejects rejection of already-approved payout', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendorWithProfile(db)
      const bookingId = await seedCompletedBooking(db, vendorId, {
        payoutState: 'approved',
      })

      const result = await executeRejectPayout(db, adminId, {
        bookingId,
        reason: 'Some reason',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('pending')
      }
    })
  })

  // ── First-3 manual approval, auto thereafter (ADR-0007 / ADR-0016) ──
  //
  // "First 3 Payouts for an Identity-verified Vendor → manual admin
  //  approval, auto thereafter." manualPayoutsRemaining starts at 3 and
  //  decrements on each approval until it reaches 0; from then the gate
  //  is open (the M3 batch auto-disburses). These tests assert the full
  //  3-then-auto sequence and the audit trail on each hop.

  describe('first-3 manual approval gate (ADR-0007/0016)', () => {
    it('decrements 3 → 0 across the first three Payouts, then stays at 0 (auto thereafter)', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendorWithProfile(db, { manualPayoutsRemaining: 3 })

      const expectedRemaining = [2, 1, 0]
      for (const remainingAfter of expectedRemaining) {
        const bookingId = await seedCompletedBooking(db, vendorId)
        const result = await executeApprovePayout(db, adminId, { bookingId })
        expect(result).toEqual({ ok: true })

        const [vendor] = await db
          .select({ manualPayoutsRemaining: vendorProfiles.manualPayoutsRemaining })
          .from(vendorProfiles)
          .where(eq(vendorProfiles.userId, vendorId))
        expect(vendor?.manualPayoutsRemaining).toBe(remainingAfter)
      }

      // 4th Payout: gate is now open (remaining already 0) → no further decrement.
      const fourth = await seedCompletedBooking(db, vendorId)
      const result = await executeApprovePayout(db, adminId, { bookingId: fourth })
      expect(result).toEqual({ ok: true })

      const [vendor] = await db
        .select({ manualPayoutsRemaining: vendorProfiles.manualPayoutsRemaining })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, vendorId))
      expect(vendor?.manualPayoutsRemaining).toBe(0)

      // The 4th approval's audit row shows the gate was already open.
      const [log] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, fourth))
      expect(log?.payload).toMatchObject({
        manualPayoutsRemainingBefore: 0,
        manualPayoutsRemainingAfter: 0,
      })
    })

    it('audit trail records the before/after manual count on the first manual approval', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendorWithProfile(db, { manualPayoutsRemaining: 3 })
      const bookingId = await seedCompletedBooking(db, vendorId)

      await executeApprovePayout(db, adminId, { bookingId })

      const [log] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, bookingId))
      expect(log?.payload).toMatchObject({
        manualPayoutsRemainingBefore: 3,
        manualPayoutsRemainingAfter: 2,
        newPayoutState: 'approved',
      })
    })
  })
})
