import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { commissionTiers } from '@/db/schema/commission-tiers'
import { experiencePricingVariations } from '@/db/schema/experience-pricing-variations'
import { experiences } from '@/db/schema/experiences'
import { pricingTiers } from '@/db/schema/pricing-tiers'
import { tripGroups } from '@/db/schema/trip-groups'
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

    // T+7d but PINNED to 06:00 UTC so the +4h slot never crosses UTC
    // midnight (which would trip the Tier-2 single-day cap). Anchoring on
    // Date.now()'s wall-clock hour made the fixture flaky after ~20:00 UTC.
    const { startAt, endAt } = futureSingleDaySlot(7)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })
    slotId = slot!.id
  })

  /**
   * Build a single-day slot `daysAhead` days from now, pinned to 06:00-10:00
   * UTC. Pinning the hour keeps the slot inside one UTC calendar day
   * regardless of the wall-clock time the suite runs at, so the Tier-2
   * single-day cap never spuriously fires on the happy-path fixture.
   */
  function futureSingleDaySlot(daysAhead: number): { startAt: Date; endAt: Date } {
    const base = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000)
    const startAt = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 6, 0, 0),
    )
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    return { startAt, endAt }
  }

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
      // The bookings.trip_group_id FK (ADR-0009) requires a real group.
      const [group] = await db
        .insert(tripGroups)
        .values({ hostUserId: 'u_c', name: 'Test Group', maxMembers: 6 })
        .returning({ id: tripGroups.id })
      const tripGroupId = group!.id
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

    it('keeps partial_pay (25% Advance route) for the default case: ≥48h out AND ≤Rs.25,000 (ADR-0001, #35)', async () => {
      // Default partial-pay: the seeded slot is T+7d (≥48h) and gross is
      // 3000 (≤Rs.25,000), so the Booking stays partial_pay with the
      // booking_create capture trigger — the 25% Advance is taken now and
      // the 75% balance is auto-captured at T-24h by the cron. Advance basis
      // = floor(3000*0.25) = 750; balance = 3000-750 = 2250.
      const r = await createBooking(db, { ...defaultInput(), paymentMode: 'partial_pay' })
      expect(r.effectivePaymentMode).toBe('partial_pay')

      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.paymentMode).toBe('partial_pay')
      expect(row?.grossTotalSnapshot).toBe('3000.00')

      const [auditRow] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, r.bookingId))
      const payload = auditRow?.payload as Record<string, unknown>
      // booking_create (NOT escrow_full_capture) ⇒ the 25% Advance route,
      // distinguishing the default from the >Rs.25,000 escrow carve-out.
      expect(payload.captureTrigger).toBe('booking_create')
      expect(payload.effectivePaymentMode).toBe('partial_pay')
      expect(payload.coercedUnder48h).toBe(false)
      // Advance + balance reconstitute the gross with the worker's rounding.
      const gross = Number(payload.grossRupees)
      const advance = Math.floor(gross * 0.25)
      expect(advance).toBe(750)
      expect(gross - advance).toBe(2250)
    })

    it('coerces partial_pay to full_upfront when booking is <48h before slot (ADR-0001)', async () => {
      // Tomorrow 06:00-10:00 UTC: always in the future and strictly <48h
      // out, and single-day regardless of the wall-clock run time.
      const { startAt, endAt } = futureSingleDaySlot(1)
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

  describe('vendor suspension (admin-controlled)', () => {
    // ADR-0007 + vendor_profiles.suspended: an admin-suspended Vendor cannot
    // accept new Bookings. The flag is re-checked at booking-create time (the
    // Experience may have been published before the suspension), and the whole
    // transaction rolls back atomically on refusal.
    afterEach(async () => {
      // The vendor row lives in beforeAll (not beforeEach), so un-suspend it
      // here to keep the rest of the suite's happy-path fixtures intact.
      await db
        .update(vendorProfiles)
        .set({ suspended: false })
        .where(eq(vendorProfiles.userId, 'u_v'))
    })

    it('rejects a booking when the Vendor is suspended', async () => {
      await db
        .update(vendorProfiles)
        .set({ suspended: true })
        .where(eq(vendorProfiles.userId, 'u_v'))

      const err = await expectBookingCreateError(createBooking(db, defaultInput()))
      expect(err.code).toBe('VENDOR_SUSPENDED')
    })

    it('rolls back atomically — no booking, no audit row, capacity unchanged', async () => {
      await db
        .update(vendorProfiles)
        .set({ suspended: true })
        .where(eq(vendorProfiles.userId, 'u_v'))

      await expectBookingCreateError(createBooking(db, defaultInput()))

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
      expect(slot?.capacityTaken).toBe(0)
    })

    it('allows the booking again once the Vendor is reactivated', async () => {
      // Suspend, fail, reactivate, succeed — proves the toggle is read live.
      await db
        .update(vendorProfiles)
        .set({ suspended: true })
        .where(eq(vendorProfiles.userId, 'u_v'))
      await expectBookingCreateError(createBooking(db, defaultInput()))

      await db
        .update(vendorProfiles)
        .set({ suspended: false })
        .where(eq(vendorProfiles.userId, 'u_v'))

      const r = await createBooking(db, defaultInput())
      expect(r.bookingId).toMatch(/^[0-9a-f-]{36}$/)
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

  // ── Pricing precedence snapshotted at booking-create (ADR-0011) ───
  //
  // The resolver-level precedence is unit-tested in pricing-resolver.test.ts.
  // These assert the INTEGRATION fact: at booking-create the resolved arm is
  // locked onto bookings.price_per_participant_snapshot + pricing_basis_snapshot
  // and never recomputed — pricing_tier override beats the group-size bracket,
  // and the bracket itself is chosen by participant_count.
  describe('pricing precedence snapshot (ADR-0011)', () => {
    // Reset the shared Vendor to a clean identity tier — sibling suites mutate
    // kyc_tier / taxpayer_type and vendor_profiles is not truncated in the
    // top-level beforeEach.
    beforeEach(async () => {
      await db
        .update(vendorProfiles)
        .set({ kycTier: 'identity', pan: 'ABCDE1234F', taxpayerType: null })
        .where(eq(vendorProfiles.userId, 'u_v'))
    })

    /**
     * A fresh capacity-8 single-day slot `daysAhead` out so each booking has
     * its own seats AND a distinct start_at (the unique index is on
     * (experience_id, start_at)).
     */
    async function freshSlot(daysAhead: number): Promise<string> {
      const { startAt, endAt } = futureSingleDaySlot(daysAhead)
      const [slot] = await db
        .insert(availabilitySlots)
        .values({ experienceId, startAt, endAt, capacity: 8 })
        .returning({ id: availabilitySlots.id })
      return slot!.id
    }

    it('locks the group-size bracket chosen by participant_count (1-2 / 3-5 / 6+)', async () => {
      // 2 → 1_2 (1500), 4 → 3_5 (1300), 7 → 6_plus (1100). Distinct values
      // make the fired bracket observable on the snapshot. Each booking
      // takes its own capacity-8 slot on a distinct day.
      const r2 = await createBooking(db, {
        ...defaultInput(),
        slotId: await freshSlot(8),
        participantCount: 2,
      })
      const [b2] = await db.select().from(bookings).where(eq(bookings.id, r2.bookingId))
      expect(b2?.pricePerParticipantSnapshot).toBe('1500.00')
      expect(b2?.pricingBasisSnapshot).toBe('experience_bracket:1_2')

      const r4 = await createBooking(db, {
        ...defaultInput(),
        slotId: await freshSlot(9),
        participantCount: 4,
      })
      const [b4] = await db.select().from(bookings).where(eq(bookings.id, r4.bookingId))
      expect(b4?.pricePerParticipantSnapshot).toBe('1300.00')
      expect(b4?.pricingBasisSnapshot).toBe('experience_bracket:3_5')

      const r7 = await createBooking(db, {
        ...defaultInput(),
        slotId: await freshSlot(10),
        participantCount: 7,
      })
      const [b7] = await db.select().from(bookings).where(eq(bookings.id, r7.bookingId))
      expect(b7?.pricePerParticipantSnapshot).toBe('1100.00')
      expect(b7?.pricingBasisSnapshot).toBe('experience_bracket:6_plus')
    })

    it('an active pricing_tier override beats the bracket and is snapshotted', async () => {
      // Pricing resolves as-of slot.start_at (T+7d). A tier window that spans
      // now → far future fires over the 1_2 bracket (which would be 1500).
      const start = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const end = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      await db.insert(pricingTiers).values({
        name: 'monsoon_2026',
        startAt: start,
        endAt: end,
        pricePerPersonOverride: '999.00',
        reason: 'Monsoon promo',
        createdByAdminUserId: 'u_v',
      })

      const r = await createBooking(db, { ...defaultInput(), participantCount: 2 })
      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      // Override wins over the 1_2 bracket (1500): snapshot is the tier price.
      expect(row?.pricePerParticipantSnapshot).toBe('999.00')
      expect(row?.pricingBasisSnapshot).toBe('pricing_tier:monsoon_2026')
      // gross = 999 × 2 = 1998 (floored).
      expect(row?.grossTotalSnapshot).toBe('1998.00')
    })

    it('does not re-resolve pricing when the tier price changes after booking (snapshot rule)', async () => {
      const start = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const end = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      const [tier] = await db
        .insert(pricingTiers)
        .values({
          name: 'monsoon_2026',
          startAt: start,
          endAt: end,
          pricePerPersonOverride: '999.00',
          reason: 'Monsoon promo',
          createdByAdminUserId: 'u_v',
        })
        .returning({ id: pricingTiers.id })

      const r = await createBooking(db, { ...defaultInput(), participantCount: 2 })
      // Mutate the tier price AFTER the booking.
      await db
        .update(pricingTiers)
        .set({ pricePerPersonOverride: '111.00' })
        .where(eq(pricingTiers.id, tier!.id))

      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      // Snapshot is frozen at the booking-time value.
      expect(row?.pricePerParticipantSnapshot).toBe('999.00')
      expect(row?.pricingBasisSnapshot).toBe('pricing_tier:monsoon_2026')
    })
  })

  // ── Selected pricing variation (ADR-0011 revision 2026-06-16, issue #07) ──
  //
  // A valid ACTIVE variation is arm 0 (top precedence) and its price flows into
  // the SAME snapshot columns as every other arm — so the existing
  // snapshot-immutability machinery protects it. An invalid (inactive /
  // foreign / unknown) variationId is REJECTED inside the transaction, which
  // rolls back: no booking, no capacity decrement.
  describe('pricing variation snapshot (ADR-0011 revision, issue #07)', () => {
    beforeEach(async () => {
      // Sibling suites mutate the shared Vendor; reset to a clean identity tier.
      await db
        .update(vendorProfiles)
        .set({ kycTier: 'identity', pan: 'ABCDE1234F', taxpayerType: null })
        .where(eq(vendorProfiles.userId, 'u_v'))
    })

    async function freshSlot(daysAhead: number): Promise<string> {
      const { startAt, endAt } = futureSingleDaySlot(daysAhead)
      const [slot] = await db
        .insert(availabilitySlots)
        .values({ experienceId, startAt, endAt, capacity: 8 })
        .returning({ id: availabilitySlots.id })
      return slot!.id
    }

    async function seedVariation(values: {
      name: string
      pricePerPerson: string
      isActive?: boolean
      experienceId?: string
    }): Promise<string> {
      const [v] = await db
        .insert(experiencePricingVariations)
        .values({
          experienceId: values.experienceId ?? experienceId,
          name: values.name,
          pricePerPerson: values.pricePerPerson,
          isActive: values.isActive ?? true,
        })
        .returning({ id: experiencePricingVariations.id })
      return v!.id
    }

    it('a valid active variation price WINS over an active pricing_tier and is snapshotted', async () => {
      // A tier window that would otherwise fire over the 1_2 bracket.
      const start = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const end = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      await db.insert(pricingTiers).values({
        name: 'monsoon_2026',
        startAt: start,
        endAt: end,
        pricePerPersonOverride: '999.00',
        reason: 'Monsoon promo',
        createdByAdminUserId: 'u_v',
      })
      const variationId = await seedVariation({
        name: 'Private session',
        pricePerPerson: '5000.00',
      })

      const r = await createBooking(db, {
        ...defaultInput(),
        participantCount: 2,
        variationId,
      })
      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      // Variation (5000) beats the tier (999) and the 1_2 bracket (1500).
      expect(row?.pricePerParticipantSnapshot).toBe('5000.00')
      expect(row?.pricingBasisSnapshot).toBe(`pricing_variation:${variationId}`)
      // gross = 5000 × 2 = 10000.
      expect(row?.grossTotalSnapshot).toBe('10000.00')
    })

    it('does NOT re-resolve when the variation price changes after booking (snapshot immutability)', async () => {
      const variationId = await seedVariation({
        name: 'Sunrise batch',
        pricePerPerson: '5000.00',
      })
      const r = await createBooking(db, {
        ...defaultInput(),
        participantCount: 2,
        variationId,
      })

      // Mutate the variation price AFTER the booking is created.
      await db
        .update(experiencePricingVariations)
        .set({ pricePerPerson: '111.00' })
        .where(eq(experiencePricingVariations.id, variationId))

      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      // Snapshot is frozen at the booking-time variation price — unchanged.
      expect(row?.pricePerParticipantSnapshot).toBe('5000.00')
      expect(row?.pricingBasisSnapshot).toBe(`pricing_variation:${variationId}`)
      expect(row?.grossTotalSnapshot).toBe('10000.00')
    })

    it('decrements slot capacity identically whether or not a variation is selected', async () => {
      // Without a variation.
      const slotNoVar = await freshSlot(8)
      await createBooking(db, {
        ...defaultInput(),
        slotId: slotNoVar,
        participantCount: 3,
      })
      const [a] = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.id, slotNoVar))
      expect(a?.capacityTaken).toBe(3)

      // With a variation — same participantCount, same decrement. Capacity is a
      // property of the slot, NOT the variation (ADR-0011).
      const variationId = await seedVariation({
        name: 'With gear',
        pricePerPerson: '5000.00',
      })
      const slotWithVar = await freshSlot(9)
      await createBooking(db, {
        ...defaultInput(),
        slotId: slotWithVar,
        participantCount: 3,
        variationId,
      })
      const [b] = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.id, slotWithVar))
      expect(b?.capacityTaken).toBe(3)
    })

    it('rejects an INACTIVE variation and leaves no booking / no capacity decrement', async () => {
      const inactiveId = await seedVariation({
        name: 'Retired option',
        pricePerPerson: '5000.00',
        isActive: false,
      })
      await expect(
        createBooking(db, {
          ...defaultInput(),
          participantCount: 2,
          variationId: inactiveId,
        }),
      ).rejects.toThrow(/not active/i)

      // Transaction rolled back: no booking row, slot untouched.
      const allBookings = await db.select().from(bookings)
      expect(allBookings).toHaveLength(0)
      const [slot] = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.id, slotId))
      expect(slot?.capacityTaken).toBe(0)
    })

    it('rejects a variation belonging to ANOTHER experience (rolls back)', async () => {
      const [otherExp] = await db
        .insert(experiences)
        .values({
          vendorUserId: 'u_v',
          slug: 'kayak-day',
          title: 'Kayak Day',
          cancellationPreset: 'flexible',
          paymentModesAllowed: ['full_upfront'],
          pricePerPerson_1_2: '3000.00',
          pricePerPerson_3_5: '2500.00',
          pricePerPerson_6_plus: '2000.00',
          regionSlug: 'rishikesh',
          activitySlug: 'kayaking',
        })
        .returning({ id: experiences.id })
      const foreignId = await seedVariation({
        name: 'Foreign',
        pricePerPerson: '4000.00',
        experienceId: otherExp!.id,
      })

      await expect(
        createBooking(db, {
          ...defaultInput(),
          participantCount: 2,
          variationId: foreignId,
        }),
      ).rejects.toThrow(/not valid for experience/i)

      const ourBookings = await db
        .select()
        .from(bookings)
        .where(eq(bookings.experienceId, experienceId))
      expect(ourBookings).toHaveLength(0)
      const [slot] = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.id, slotId))
      expect(slot?.capacityTaken).toBe(0)
    })
  })

  // ── Cancellation snapshot: preset + reschedule (ADR-0005 revision, issue #09) ──
  //
  // Both the cancellation preset (already snapshotted) and the new
  // reschedule_allowed flag are locked onto the Booking at create. A later
  // change to the Experience's preset / flag never alters an existing Booking —
  // the snapshot rule that protects the money path also protects the
  // cancellation rights the refund math reads from.
  describe('cancellation snapshot immutability (ADR-0005 revision, issue #09)', () => {
    beforeEach(async () => {
      // Sibling suites mutate the shared Vendor; reset to a clean identity tier.
      await db
        .update(vendorProfiles)
        .set({ kycTier: 'identity', pan: 'ABCDE1234F', taxpayerType: null })
        .where(eq(vendorProfiles.userId, 'u_v'))
    })

    it('snapshots non_cancellable preset + reschedule_allowed=false at create', async () => {
      // Re-create the seeded Experience as non_cancellable with reschedule OFF.
      await db
        .update(experiences)
        .set({ cancellationPreset: 'non_cancellable', rescheduleAllowed: false })
        .where(eq(experiences.id, experienceId))

      const r = await createBooking(db, defaultInput())
      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.cancellationPresetSnapshot).toBe('non_cancellable')
      expect(row?.rescheduleAllowedSnapshot).toBe(false)
    })

    it('defaults reschedule_allowed snapshot to true for the seeded (flexible) Experience', async () => {
      // The seeded Experience does not set rescheduleAllowed, so the column
      // default (true) holds and is snapshotted as true.
      const r = await createBooking(db, defaultInput())
      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.cancellationPresetSnapshot).toBe('flexible')
      expect(row?.rescheduleAllowedSnapshot).toBe(true)
    })

    it('does NOT re-resolve the preset / reschedule snapshot when the Experience changes after booking', async () => {
      // Book against non_cancellable + reschedule OFF.
      await db
        .update(experiences)
        .set({ cancellationPreset: 'non_cancellable', rescheduleAllowed: false })
        .where(eq(experiences.id, experienceId))
      const r = await createBooking(db, defaultInput())

      // Now FLIP the Experience's policy AFTER the booking is created.
      await db
        .update(experiences)
        .set({ cancellationPreset: 'flexible', rescheduleAllowed: true })
        .where(eq(experiences.id, experienceId))

      // Re-read the Booking: its snapshots are frozen at booking-time values.
      const [row] = await db.select().from(bookings).where(eq(bookings.id, r.bookingId))
      expect(row?.cancellationPresetSnapshot).toBe('non_cancellable')
      expect(row?.rescheduleAllowedSnapshot).toBe(false)
    })
  })

  // ── Tier-2 cap re-check at booking-create (ADR-0007) ──────────────
  //
  // The caps are double-checked at booking-create because the Vendor's
  // KYC tier may have been downgraded AFTER the Experience was published.
  // An over-cap Booking against a now-downgraded Vendor must be refused.
  describe('Tier-2 cap re-check (ADR-0007)', () => {
    // Restore a clean identity-tier Vendor before each case — sibling suites
    // mutate kyc_tier and vendor_profiles is not truncated in the top-level
    // beforeEach, so ordering would otherwise leak prior state in.
    beforeEach(async () => {
      await db
        .update(vendorProfiles)
        .set({ kycTier: 'identity', pan: 'ABCDE1234F', taxpayerType: null })
        .where(eq(vendorProfiles.userId, 'u_v'))
    })

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

    it('rejects a booking when the booked slot now spans multiple days for an identity Vendor (single-day cap)', async () => {
      // Vendor stays identity; the booked slot crosses a calendar-day
      // boundary (an Experience published while business-verified, then
      // downgraded). The single-day cap is re-checked at booking-create
      // against the actual booked slot — this is the multi-day arm that
      // the publish-time suite covers at publish but was untested here.
      const startAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      const endAt = new Date(startAt.getTime() + 26 * 60 * 60 * 1000) // +26h → next day
      const [multiDaySlot] = await db
        .insert(availabilitySlots)
        .values({ experienceId, startAt, endAt, capacity: 8 })
        .returning({ id: availabilitySlots.id })

      const err = await expectBookingCreateError(
        createBooking(db, { ...defaultInput(), slotId: multiDaySlot!.id }),
      )
      expect(err.code).toBe('TIER_CAP_EXCEEDED')
      expect(err.tierCapViolationCode).toBe('MULTI_DAY_NOT_ALLOWED')

      // No booking row; the multi-day slot's capacity is untouched.
      const rows = await db.select().from(bookings)
      expect(rows).toHaveLength(0)
      const [slot] = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.id, multiDaySlot!.id))
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
