import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { commissionTiers } from '@/db/schema/commission-tiers'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { _resetRedisCacheForTests } from '@/lib/redis'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { BookingCreateError, createBooking } from './booking-create'

/**
 * Booking-create transaction — the load-bearing primitive every other
 * M2 feature builds on. Ties together:
 *
 *   SELECT FOR UPDATE on the slot
 *   + commission resolution (ADR-0008)
 *   + pricing resolution (ADR-0011)
 *   + TDS u/s 194-O (ADR-0016)
 *   + GST 18% IGST snapshot (ADR-0016)
 *   + payout destination snapshot (ADR-0016)
 *   + capacity decrement
 *   + booking insert with 12 snapshot columns
 *   + booking.create audit_logs row
 *
 * All atomic in a single db.transaction(...).
 *
 * Carve-outs for partial-pay per ADR-0001:
 *   - Booking made <48h before slot.startAt → coerce to full_upfront
 *   - Booking with gross >Rs.25,000 → effectivePaymentMode='partial_pay'
 *     but captureTrigger='escrow_full_capture' (audit-trail signal)
 *
 * RNPL (ADR-0002) is rejected at the Server Action boundary with code
 * RNPL_DEFERRED_TO_V2 — the schema stores the value, the flow refuses.
 *
 * Idempotency via Redis key 'booking-create:<uuid>' with 24h TTL.
 * Returns the same Booking ID + effective mode without re-creating.
 */
describe('createBooking (ADRs 0001/0002/0003/0005/0008/0011/0016)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  let experienceId: string
  let slotId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_v', email: 'v@example.com' },
      { id: 'u_c', email: 'c@example.com' },
    ])
    await db.insert(vendorProfiles).values({
      userId: 'u_v',
      businessName: 'Test Adventures',
      slug: 'test-adventures',
      // Identity-verified (ADR-0007 Tier 2): the seeded Experience (single-day,
      // Rs.1,500/person, capacity 8, non-combo) sits within the Tier-2 caps,
      // so the booking-create tier re-check passes for the happy path.
      kycTier: 'identity',
      pan: 'ABCDE1234F',
      commissionRate: '20.00',
      payoutMethod: 'upi',
      payoutDestination: { vpa: 'vendor@upi' },
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    // Fresh state per test: clear bookings, payments, audit, tiers, then
    // re-create the experience + a far-future slot so the partial-pay
    // happy path (>48h) holds. Tests that need different scheduling
    // override the slot timing inline.
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, payments, refund_requests, bookings, commission_tiers, pricing_tiers, availability_slots, experiences CASCADE`,
    )
    _resetRedisCacheForTests()

    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'rafting-day',
        title: 'Rafting Day',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront', 'partial_pay'],
        pricePerPerson_1_2: '1500.00',
        pricePerPerson_3_5: '1300.00',
        pricePerPerson_6_plus: '1100.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    experienceId = exp!.id

    const startAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // T+7d
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })
    slotId = slot!.id
  })

  function uuid(): string {
    return crypto.randomUUID()
  }

  async function expectBookingCreateError(
    p: Promise<unknown>,
  ): Promise<BookingCreateError> {
    try {
      await p
    } catch (e) {
      return e as BookingCreateError
    }
    throw new Error('expected createBooking to reject')
  }

  function defaultInput() {
    return {
      customerUserId: 'u_c',
      experienceId,
      slotId,
      participantCount: 2,
      paymentMode: 'full_upfront' as const,
      idempotencyKey: uuid(),
    }
  }

  describe('happy path', () => {
    it('creates a confirmed booking with all 12 snapshot columns populated', async () => {
      const r = await createBooking(db, defaultInput())
      expect(r.bookingId).toMatch(/^[0-9a-f-]{36}$/)
      expect(r.effectivePaymentMode).toBe('full_upfront')

      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.state).toBe('confirmed')
      // 1-2 bracket at 2 participants × 1500 = 3000
      expect(row?.grossTotalSnapshot).toBe('3000.00')
      expect(row?.pricePerParticipantSnapshot).toBe('1500.00')
      expect(row?.pricingBasisSnapshot).toBe('experience_bracket:1_2')
      expect(row?.commissionRateSnapshot).toBe('20.00')
      expect(row?.commissionBasisSnapshot).toBe('vendor_default')
      expect(row?.cancellationPresetSnapshot).toBe('flexible')
      expect(row?.tdsAmountSnapshot).toBe('3.00') // 0.1% of 3000 = 3
      expect(row?.gstRateOnCommissionSnapshot).toBe('18.00')
      expect(row?.vendorPanSnapshot).toBe('ABCDE1234F')
      expect(row?.vendorIsResidentSnapshot).toBe(true)
      expect(row?.payoutMethodSnapshot).toBe('upi')
      expect(row?.payoutDestinationSnapshot).toEqual({ vpa: 'vendor@upi' })
      expect(row?.tripGroupId).toBeNull()
    })

    it('decrements slot.capacity_taken atomically', async () => {
      await createBooking(db, defaultInput())
      const [slot] = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.id, slotId))
      expect(slot?.capacityTaken).toBe(2)
      expect(slot?.status).toBe('open')
    })

    it('flips slot to sold_out when capacity_taken reaches capacity', async () => {
      await createBooking(db, { ...defaultInput(), participantCount: 8 })
      const [slot] = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.id, slotId))
      expect(slot?.capacityTaken).toBe(8)
      expect(slot?.status).toBe('sold_out')
    })

    it('writes a booking.create audit_logs row in the same transaction', async () => {
      const r = await createBooking(db, defaultInput())
      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, r.bookingId))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.action).toBe('booking.create')
      expect(rows[0]?.entityType).toBe('booking')
      expect(rows[0]?.actorUserId).toBe('u_c')
      const payload = rows[0]?.payload as Record<string, unknown>
      expect(payload.commissionRateSnapshot).toBe('20.00')
      expect(payload.commissionBasisSnapshot).toBe('vendor_default')
      expect(payload.pricingBasisSnapshot).toBe('experience_bracket:1_2')
      expect(payload.effectivePaymentMode).toBe('full_upfront')
      expect(payload.captureTrigger).toBe('booking_create')
    })

    it('passes through tripGroupId when provided', async () => {
      const tripGroupId = uuid()
      const r = await createBooking(db, { ...defaultInput(), tripGroupId })
      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.tripGroupId).toBe(tripGroupId)
    })
  })

  describe('snapshot rule', () => {
    it('uses an active festival commission tier over the vendor default', async () => {
      const start = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      await db.insert(commissionTiers).values({
        name: 'monsoon_2026',
        startAt: start,
        endAt: end,
        rateOverride: '12.00',
        reason: 'Monsoon',
        createdByAdminUserId: 'u_v',
      })

      const r = await createBooking(db, defaultInput())
      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.commissionRateSnapshot).toBe('12.00')
      expect(row?.commissionBasisSnapshot).toBe('festival:monsoon_2026')
    })

    it('does not re-resolve commission when the festival tier rate changes after booking', async () => {
      const r = await createBooking(db, defaultInput())
      // Snapshot at 20.00 vendor default; now change vendor base rate
      await db
        .update(vendorProfiles)
        .set({ commissionRate: '50.00' })
        .where(eq(vendorProfiles.userId, 'u_v'))
      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      // Snapshot unchanged
      expect(row?.commissionRateSnapshot).toBe('20.00')
    })

    it('snapshots gross = price_per_participant × participant_count', async () => {
      // 4 participants → 3-5 bracket at 1300 → gross 5200
      const r = await createBooking(db, { ...defaultInput(), participantCount: 4 })
      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.pricePerParticipantSnapshot).toBe('1300.00')
      expect(row?.grossTotalSnapshot).toBe('5200.00')
      expect(row?.tdsAmountSnapshot).toBe('5.00') // 0.1% of 5200 = 5.2, floored to 5
    })

    it('snapshots vendor PAN as resident at time of booking', async () => {
      const r = await createBooking(db, defaultInput())
      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.vendorPanSnapshot).toBe('ABCDE1234F')
    })

    it('snapshots payout destination JSON exactly', async () => {
      await db
        .update(vendorProfiles)
        .set({ payoutMethod: 'bank_account', payoutDestination: { ifsc: 'HDFC0000123', accountNumber: '1234' } })
        .where(eq(vendorProfiles.userId, 'u_v'))
      const r = await createBooking(db, defaultInput())
      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.payoutMethodSnapshot).toBe('bank_account')
      expect(row?.payoutDestinationSnapshot).toEqual({ ifsc: 'HDFC0000123', accountNumber: '1234' })
    })
  })

  describe('payment-mode gating', () => {
    it('rejects RNPL with code RNPL_DEFERRED_TO_V2 (ADR-0002)', async () => {
      const err = await expectBookingCreateError(
        createBooking(db, { ...defaultInput(), paymentMode: 'reserve_now_pay_later' }),
      )
      expect(err).toBeInstanceOf(BookingCreateError)
      expect(err.code).toBe('RNPL_DEFERRED_TO_V2')
    })

    it('rejects a payment_mode not in the Experience.payment_modes_allowed list', async () => {
      // Set the experience to only allow full_upfront
      await db
        .update(experiences)
        .set({ paymentModesAllowed: ['full_upfront'] })
        .where(eq(experiences.id, experienceId))
      const err = await expectBookingCreateError(
        createBooking(db, { ...defaultInput(), paymentMode: 'partial_pay' }),
      )
      expect(err.code).toBe('PAYMENT_MODE_NOT_ALLOWED')
    })

    it('coerces partial_pay to full_upfront when booking is <48h before slot (ADR-0001)', async () => {
      // Re-create slot at T+24h
      const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
      const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
      const [slot] = await db
        .insert(availabilitySlots)
        .values({ experienceId, startAt, endAt, capacity: 8 })
        .returning({ id: availabilitySlots.id })

      const r = await createBooking(db, {
        ...defaultInput(),
        slotId: slot!.id,
        paymentMode: 'partial_pay',
      })
      expect(r.effectivePaymentMode).toBe('full_upfront')

      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.paymentMode).toBe('full_upfront')
      const [auditRow] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, r.bookingId))
      const payload = auditRow?.payload as Record<string, unknown>
      expect(payload.captureTrigger).toBe('booking_create')
    })

    it('escrow-flavours partial_pay when gross > Rs.25,000 (ADR-0001)', async () => {
      // A >Rs.25,000 ticket exceeds the Tier-2 per-person cap, so this is a
      // Business-verified Vendor (ADR-0007 unrestricted listing).
      await db
        .update(vendorProfiles)
        .set({ kycTier: 'business' })
        .where(eq(vendorProfiles.userId, 'u_v'))
      // Push price up so 2 participants × X > 25000
      await db
        .update(experiences)
        .set({
          pricePerPerson_1_2: '15000.00',
          pricePerPerson_3_5: '15000.00',
          pricePerPerson_6_plus: '15000.00',
        })
        .where(eq(experiences.id, experienceId))

      const r = await createBooking(db, {
        ...defaultInput(),
        paymentMode: 'partial_pay',
      })
      expect(r.effectivePaymentMode).toBe('partial_pay')

      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.paymentMode).toBe('partial_pay')
      // gross_total_snapshot = 30000
      expect(row?.grossTotalSnapshot).toBe('30000.00')
      const [auditRow] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, r.bookingId))
      const payload = auditRow?.payload as Record<string, unknown>
      expect(payload.captureTrigger).toBe('escrow_full_capture')
    })
  })

  describe('permit gating', () => {
    it('rejects a booking on an Experience with required_permits when acknowledged=false', async () => {
      await db
        .update(experiences)
        .set({ requiredPermits: ['ilp_sikkim'] })
        .where(eq(experiences.id, experienceId))
      const err = await expectBookingCreateError(createBooking(db, defaultInput()))
      expect(err.code).toBe('PERMITS_NOT_ACKNOWLEDGED')
    })

    it('allows booking when acknowledgedPermits=true on a permit-required Experience', async () => {
      await db
        .update(experiences)
        .set({ requiredPermits: ['ilp_sikkim'] })
        .where(eq(experiences.id, experienceId))
      const r = await createBooking(db, { ...defaultInput(), acknowledgedPermits: true })
      expect(r.bookingId).toBeTruthy()
      const [auditRow] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, r.bookingId))
      const payload = auditRow?.payload as Record<string, unknown>
      expect(payload.acknowledgedPermits).toBe(true)
    })
  })

  describe('capacity + concurrency', () => {
    it('rejects a booking that would push capacity_taken past capacity', async () => {
      // capacity 8 ; book 5 then try 5 more
      await createBooking(db, { ...defaultInput(), participantCount: 5 })
      const err = await expectBookingCreateError(
        createBooking(db, { ...defaultInput(), participantCount: 5 }),
      )
      expect(err.code).toBe('INSUFFICIENT_CAPACITY')

      // capacity_taken should still be 5 (not 10) — second tx rolled back
      const [slot] = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.id, slotId))
      expect(slot?.capacityTaken).toBe(5)
    })

    it('rejects bookings on a closed slot', async () => {
      await db
        .update(availabilitySlots)
        .set({ status: 'closed' })
        .where(eq(availabilitySlots.id, slotId))
      let err: BookingCreateError | undefined
      try {
        await createBooking(db, defaultInput())
      } catch (e) {
        err = e as BookingCreateError
      }
      expect(err?.code).toBe('SLOT_CLOSED')
    })

    it('rejects bookings on a sold_out slot', async () => {
      await db
        .update(availabilitySlots)
        .set({ status: 'sold_out' })
        .where(eq(availabilitySlots.id, slotId))
      const err = await expectBookingCreateError(createBooking(db, defaultInput()))
      expect(err.code).toBe('SLOT_SOLD_OUT')
    })

    it('rolls back the booking row when the audit insert would fail (atomic tx)', async () => {
      // Force an audit failure mid-tx by passing an invalid customerUserId
      // — Zod parses on entry, but the FK violation on bookings.customer_user_id
      // fires inside the tx. Either way: no rows persist.
      const err = await createBooking(db, {
        ...defaultInput(),
        customerUserId: 'u_does_not_exist',
      }).catch((e) => e)
      expect(err).toBeDefined()

      const allBookings = await db.select().from(bookings)
      expect(allBookings).toHaveLength(0)
      const allAudit = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'booking.create'))
      expect(allAudit).toHaveLength(0)
      const [slot] = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.id, slotId))
      expect(slot?.capacityTaken).toBe(0) // slot unchanged on rollback
    })
  })

  describe('input validation', () => {
    it('rejects participantCount <= 0', async () => {
      await expect(
        createBooking(db, { ...defaultInput(), participantCount: 0 }),
      ).rejects.toThrow()
      await expect(
        createBooking(db, { ...defaultInput(), participantCount: -1 }),
      ).rejects.toThrow()
    })

    it('rejects malformed UUIDs', async () => {
      await expect(
        createBooking(db, { ...defaultInput(), experienceId: 'not-a-uuid' }),
      ).rejects.toThrow()
    })

    it('rejects missing idempotencyKey', async () => {
      const input = defaultInput()
      delete (input as { idempotencyKey?: string }).idempotencyKey
      await expect(createBooking(db, input as never)).rejects.toThrow()
    })
  })

  describe('idempotency', () => {
    it('returns the same bookingId for repeated calls with the same idempotencyKey', async () => {
      const idempotencyKey = uuid()
      const r1 = await createBooking(db, { ...defaultInput(), idempotencyKey })
      const r2 = await createBooking(db, { ...defaultInput(), idempotencyKey })
      expect(r2.bookingId).toBe(r1.bookingId)
      // and only one bookings row exists
      const rows = await db.select().from(bookings)
      expect(rows).toHaveLength(1)
      // and capacity decremented only once
      const [slot] = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.id, slotId))
      expect(slot?.capacityTaken).toBe(2)
    })

    it('different idempotencyKeys produce different bookings', async () => {
      const r1 = await createBooking(db, defaultInput())
      const r2 = await createBooking(db, defaultInput())
      expect(r2.bookingId).not.toBe(r1.bookingId)
    })
  })

  describe('non-resident vendor edge', () => {
    it('quotes 0 TDS for a vendor with NULL PAN and snapshots is_resident=false', async () => {
      // V1 proxy: PAN IS NULL → treat as non-resident for TDS purposes
      // (per ADR-0016 Section 194-O does not apply to foreign Vendors).
      // M3 KYC adds an explicit is_resident column.
      await db
        .update(vendorProfiles)
        .set({ pan: null })
        .where(eq(vendorProfiles.userId, 'u_v'))
      const r = await createBooking(db, defaultInput())
      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.tdsAmountSnapshot).toBe('0.00')
      expect(row?.vendorIsResidentSnapshot).toBe(false)
      expect(row?.vendorPanSnapshot).toBeNull()
    })
  })

  describe('GST TCS (Section 52) + 194-O threshold (ADR-0016)', () => {
    // The 'non-resident vendor edge' suite above nulls vendor.pan and the
    // top-level beforeEach does not reset vendor_profiles — restore a known
    // resident vendor with no taxpayer type so each test starts clean.
    beforeEach(async () => {
      await db
        .update(vendorProfiles)
        .set({ pan: 'ABCDE1234F', taxpayerType: null })
        .where(eq(vendorProfiles.userId, 'u_v'))
    })

    it('snapshots 0.5% TCS on the booking gross', async () => {
      const r = await createBooking(db, defaultInput())
      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.tcsAmountSnapshot).toBe('15.00') // 0.5% of 3000
      expect(row?.tcsRateSnapshot).toBe('0.50')
    })

    it('records TCS in the booking.create audit payload', async () => {
      const r = await createBooking(db, defaultInput())
      const [auditRow] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, r.bookingId))
      const payload = auditRow?.payload as Record<string, unknown>
      expect(payload.tcsRupees).toBe(15)
    })

    it('exempts an individual vendor under ₹5L FY gross from TDS (Section 194-O(2))', async () => {
      await db
        .update(vendorProfiles)
        .set({ taxpayerType: 'individual' })
        .where(eq(vendorProfiles.userId, 'u_v'))
      const r = await createBooking(db, defaultInput())
      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.tdsAmountSnapshot).toBe('0.00')
      const [auditRow] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, r.bookingId))
      const payload = auditRow?.payload as Record<string, unknown>
      expect(payload.tdsBasis).toBe('section_194o_below_threshold')
    })

    it('starts deducting TDS once the vendor crosses ₹5L cumulative FY gross', async () => {
      // Rs.150,000/person far exceeds the Tier-2 cap, so this is a
      // Business-verified Vendor (an individual taxpayer can still be Tier 3).
      await db
        .update(vendorProfiles)
        .set({ taxpayerType: 'individual', kycTier: 'business' })
        .where(eq(vendorProfiles.userId, 'u_v'))
      await db
        .update(experiences)
        .set({
          pricePerPerson_1_2: '150000.00',
          pricePerPerson_3_5: '150000.00',
          pricePerPerson_6_plus: '150000.00',
        })
        .where(eq(experiences.id, experienceId))

      // Booking 1: gross 300000, cumulative 300000 ≤ ₹5L → exempt.
      const r1 = await createBooking(db, defaultInput())
      const [row1] = await db.select().from(bookings).where(eq(bookings.id, r1.bookingId))
      expect(row1?.tdsAmountSnapshot).toBe('0.00')

      // Booking 2: gross 300000, cumulative 600000 > ₹5L → deduct 0.1% of 300000 = 300.
      const r2 = await createBooking(db, defaultInput())
      const [row2] = await db.select().from(bookings).where(eq(bookings.id, r2.bookingId))
      expect(row2?.tdsAmountSnapshot).toBe('300.00')
    })

    it('does not exempt a company vendor even under ₹5L', async () => {
      await db
        .update(vendorProfiles)
        .set({ taxpayerType: 'company' })
        .where(eq(vendorProfiles.userId, 'u_v'))
      const r = await createBooking(db, defaultInput())
      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.tdsAmountSnapshot).toBe('3.00') // 0.1% of 3000, not exempt
    })
  })

  // ── Tier-2 cap re-check at booking-create (ADR-0007) ──────────────
  //
  // The caps are double-checked at booking-create because the Vendor's
  // KYC tier may have been downgraded AFTER the Experience was published.
  // An over-cap Booking against a now-downgraded Vendor must be refused.
  describe('Tier-2 cap re-check (ADR-0007)', () => {
    it('rejects a booking when the Vendor has been downgraded to phone', async () => {
      await db
        .update(vendorProfiles)
        .set({ kycTier: 'phone' })
        .where(eq(vendorProfiles.userId, 'u_v'))

      const err = await expectBookingCreateError(createBooking(db, defaultInput()))
      expect(err.code).toBe('TIER_CAP_EXCEEDED')

      // No booking row created — the transaction rolled back.
      const rows = await db.select().from(bookings)
      expect(rows).toHaveLength(0)
      // Slot capacity untouched.
      const [slot] = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.id, slotId))
      expect(slot?.capacityTaken).toBe(0)
    })

    it('rejects a booking when the booked slot now exceeds the 8-participant cap for an identity Vendor', async () => {
      // Vendor stays identity, but the slot capacity is raised above the cap
      // (e.g. an Experience published while business-verified, then downgraded).
      await db
        .update(availabilitySlots)
        .set({ capacity: 20 })
        .where(eq(availabilitySlots.id, slotId))

      const err = await expectBookingCreateError(createBooking(db, defaultInput()))
      expect(err.code).toBe('TIER_CAP_EXCEEDED')

      const rows = await db.select().from(bookings)
      expect(rows).toHaveLength(0)
    })

    it('rejects a booking when the Experience is now over the per-person price cap for an identity Vendor', async () => {
      await db
        .update(experiences)
        .set({
          pricePerPerson_1_2: '9000.00',
          pricePerPerson_3_5: '9000.00',
          pricePerPerson_6_plus: '9000.00',
        })
        .where(eq(experiences.id, experienceId))

      const err = await expectBookingCreateError(createBooking(db, defaultInput()))
      expect(err.code).toBe('TIER_CAP_EXCEEDED')

      const rows = await db.select().from(bookings)
      expect(rows).toHaveLength(0)
    })

    it('writes a TIER_CAP_EXCEEDED audit row on rejection', async () => {
      await db
        .update(vendorProfiles)
        .set({ kycTier: 'phone' })
        .where(eq(vendorProfiles.userId, 'u_v'))

      await expectBookingCreateError(createBooking(db, defaultInput()))

      // The rejection audit row is written outside the rolled-back booking
      // transaction so it survives.
      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'booking.tier_cap_rejected'))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.entityType).toBe('experience')
      expect(rows[0]?.entityId).toBe(experienceId)
      const payload = rows[0]?.payload as Record<string, unknown>
      expect(payload.code).toBe('PHONE_CANNOT_PUBLISH')
      expect(payload.kycTier).toBe('phone')
    })

    it('allows a booking when the Vendor is business-verified regardless of caps', async () => {
      await db
        .update(vendorProfiles)
        .set({ kycTier: 'business' })
        .where(eq(vendorProfiles.userId, 'u_v'))
      await db
        .update(availabilitySlots)
        .set({ capacity: 30 })
        .where(eq(availabilitySlots.id, slotId))

      const r = await createBooking(db, defaultInput())
      expect(r.bookingId).toMatch(/^[0-9a-f-]{36}$/)
    })
  })
})
