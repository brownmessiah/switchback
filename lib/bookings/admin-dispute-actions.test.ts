import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { refundRequests } from '@/db/schema/refund-requests'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { walletBalances } from '@/db/schema/wallet-balances'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeResolveAsCompleted,
  executeResolveAsCancelledPostExperience,
  DisputeActionError,
} from './admin-dispute-actions'

/**
 * Admin dispute resolution per ADR-0003 state machine.
 *
 * Two resolution paths for disputed Bookings:
 *   A. disputed → completed (optional partial refund + commission adjustment)
 *   B. disputed → cancelled_post_experience (full refund, no commission)
 *
 * Both require mandatory admin notes. Tested against PGlite.
 */
describe('admin dispute resolution (ADR-0003)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_admin', email: 'admin@switchback.com', name: 'Admin User' },
      { id: 'u_vendor', email: 'vendor@test.com', name: 'Test Vendor' },
      { id: 'u_customer', email: 'customer@test.com', name: 'Test Customer' },
    ])
    await db.insert(vendorProfiles).values({
      userId: 'u_vendor',
      businessName: 'Test Adventures',
      slug: 'test-adventures',
      pan: 'ABCDE1234F',
      commissionRate: '20.00',
      responseTimeSlaScore: '100.00',
      payoutMethod: 'upi',
      payoutDestination: { vpa: 'vendor@upi' },
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, payments, refund_requests, bookings, availability_slots, experiences, wallet_balances CASCADE`,
    )

    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_vendor',
        slug: 'rafting-day',
        title: 'Rafting Day',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500.00',
        pricePerPerson_3_5: '1300.00',
        pricePerPerson_6_plus: '1100.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'published',
      })
      .returning({ id: experiences.id })
    experienceId = exp!.id
  })

  /**
   * Seed a booking in a given state.
   */
  async function seedBooking(args: {
    state: 'disputed' | 'confirmed' | 'completed' | 'awaiting_completion'
    grossRupees?: number
    commissionRate?: string
  }): Promise<{ bookingId: string; slotId: string }> {
    const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })

    const gross = args.grossRupees ?? 3000
    const commRate = args.commissionRate ?? '20.00'
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_customer',
        experienceId,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'full_upfront',
        state: args.state,
        grossTotalSnapshot: gross.toFixed(2),
        pricePerParticipantSnapshot: (gross / 2).toFixed(2),
        pricingBasisSnapshot: 'experience_bracket:1_2',
        commissionRateSnapshot: commRate,
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: 'flexible',
        tdsAmountSnapshot: (gross * 0.01).toFixed(2),
        gstRateOnCommissionSnapshot: '18.00',
        vendorPanSnapshot: 'ABCDE1234F',
        vendorIsResidentSnapshot: true,
        payoutMethodSnapshot: 'upi',
        payoutDestinationSnapshot: { vpa: 'vendor@upi' },
        payoutState: 'held',
      })
      .returning({ id: bookings.id })

    return { bookingId: booking!.id, slotId: slot!.id }
  }

  async function readRefundBalance(userId: string): Promise<number> {
    const [row] = await db
      .select()
      .from(walletBalances)
      .where(
        and(
          eq(walletBalances.userId, userId),
          eq(walletBalances.balanceType, 'refund_balance'),
        ),
      )
    return row ? Math.floor(Number(row.amount)) : 0
  }

  // ═══════════════════════════════════════════════════════════════════
  // Resolution A: disputed → completed
  // ═══════════════════════════════════════════════════════════════════

  describe('executeResolveAsCompleted', () => {
    it('transitions disputed → completed and sets completedAt', async () => {
      const { bookingId } = await seedBooking({ state: 'disputed' })

      const result = await executeResolveAsCompleted(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'Vendor fulfilled the experience as promised.',
      })

      expect(result.ok).toBe(true)

      const [row] = await db
        .select({
          state: bookings.state,
          completedAt: bookings.completedAt,
        })
        .from(bookings)
        .where(eq(bookings.id, bookingId))

      expect(row?.state).toBe('completed')
      expect(row?.completedAt).toBeInstanceOf(Date)
    })

    it('resumes payout by setting payoutState to pending', async () => {
      const { bookingId } = await seedBooking({ state: 'disputed' })

      await executeResolveAsCompleted(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'Dispute resolved in Vendor favour.',
      })

      const [row] = await db
        .select({ payoutState: bookings.payoutState })
        .from(bookings)
        .where(eq(bookings.id, bookingId))

      expect(row?.payoutState).toBe('pending')
    })

    it('writes a booking.dispute_resolved_complete audit log', async () => {
      const { bookingId } = await seedBooking({ state: 'disputed' })

      await executeResolveAsCompleted(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'Audit test notes',
      })

      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.dispute_resolved_complete'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.actorUserId).toBe('u_admin')
      const payload = rows[0]?.payload as Record<string, unknown>
      expect(payload.previousState).toBe('disputed')
      expect(payload.newState).toBe('completed')
      expect(payload.notes).toBe('Audit test notes')
    })

    // ── Partial refund + commission adjustment ───────────────────────

    it('credits partial refund to Customer Refund balance when partialRefundRupees provided', async () => {
      const { bookingId } = await seedBooking({ state: 'disputed', grossRupees: 5000 })

      const result = await executeResolveAsCompleted(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'Partial refund for subpar experience quality.',
        partialRefundRupees: 1500,
      })

      expect(result.ok).toBe(true)
      expect(await readRefundBalance('u_customer')).toBe(1500)

      // Verify refund_requests row was created
      const refundRows = await db
        .select()
        .from(refundRequests)
        .where(eq(refundRequests.bookingId, bookingId))
      expect(refundRows).toHaveLength(1)
      expect(refundRows[0]?.amount).toBe('1500.00')
      expect(refundRows[0]?.reason).toBe('outside_policy_dispute_resolved')
      expect(refundRows[0]?.state).toBe('credited')
      expect(refundRows[0]?.policyWindowBasisSnapshot).toBe('admin_override')
    })

    it('records adjusted commission rate in audit log (snapshots immutable per ADR-0008)', async () => {
      const { bookingId } = await seedBooking({
        state: 'disputed',
        grossRupees: 5000,
        commissionRate: '20.00',
      })

      await executeResolveAsCompleted(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'Reduced commission due to partial service.',
        adjustedCommissionRate: '10.00',
      })

      // Snapshot columns remain immutable
      const [row] = await db
        .select({
          commissionRateSnapshot: bookings.commissionRateSnapshot,
          commissionBasisSnapshot: bookings.commissionBasisSnapshot,
        })
        .from(bookings)
        .where(eq(bookings.id, bookingId))

      expect(row?.commissionRateSnapshot).toBe('20.00')
      expect(row?.commissionBasisSnapshot).toBe('vendor_default')

      // Adjustment recorded in audit log
      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.dispute_resolved_complete'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      const payload = auditRows[0]?.payload as Record<string, unknown>
      expect(payload.adjustedCommissionRate).toBe('10.00')
      expect(payload.originalCommissionRate).toBe('20.00')
    })

    it('includes partial refund and commission adjustment in audit payload', async () => {
      const { bookingId } = await seedBooking({
        state: 'disputed',
        grossRupees: 5000,
        commissionRate: '20.00',
      })

      await executeResolveAsCompleted(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'Both adjustments.',
        partialRefundRupees: 1000,
        adjustedCommissionRate: '15.00',
      })

      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.dispute_resolved_complete'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      const payload = rows[0]?.payload as Record<string, unknown>
      expect(payload.partialRefundRupees).toBe(1000)
      expect(payload.adjustedCommissionRate).toBe('15.00')
      expect(payload.originalCommissionRate).toBe('20.00')

      // Snapshot columns remain immutable
      const [row] = await db
        .select({
          commissionRateSnapshot: bookings.commissionRateSnapshot,
        })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(row?.commissionRateSnapshot).toBe('20.00')
    })

    it('rejects partial refund exceeding gross total', async () => {
      const { bookingId } = await seedBooking({ state: 'disputed', grossRupees: 3000 })

      const result = await executeResolveAsCompleted(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'Trying too-large refund.',
        partialRefundRupees: 5000,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/exceeds/i)
      }
    })

    // ── Guard: notes required ────────────────────────────────────────

    it('rejects empty notes', async () => {
      const { bookingId } = await seedBooking({ state: 'disputed' })

      const result = await executeResolveAsCompleted(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: '',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/notes.*required/i)
      }
    })

    it('rejects whitespace-only notes', async () => {
      const { bookingId } = await seedBooking({ state: 'disputed' })

      const result = await executeResolveAsCompleted(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: '   \n\t  ',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/notes.*required/i)
      }
    })

    // ── Guard: non-notes validation failures surface the raw message ──

    it('surfaces a non-notes validation error verbatim (invalid bookingId)', async () => {
      const result = await executeResolveAsCompleted(db, {
        adminUserId: 'u_admin',
        bookingId: 'not-a-uuid',
        notes: 'Valid notes here.',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        // Hits the `errorMsg.includes('notes')` false arm and the generic
        // `return { ok: false, error: errorMsg }` path — distinct from the
        // notes-required guard above.
        expect(result.error).toMatch(/UUID/i)
        expect(result.error).not.toMatch(/Admin notes are required/i)
      }
    })

    it('surfaces the negative partial-refund validation error', async () => {
      const result = await executeResolveAsCompleted(db, {
        adminUserId: 'u_admin',
        bookingId: crypto.randomUUID(),
        notes: 'Valid notes here.',
        partialRefundRupees: -100,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/non-negative/i)
      }
    })

    // ── Guard: only disputed bookings ────────────────────────────────

    it('rejects if booking is not in disputed state (confirmed)', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed' })

      const result = await executeResolveAsCompleted(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'Should fail.',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/disputed/i)
      }

      // State unchanged
      const [row] = await db
        .select({ state: bookings.state })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(row?.state).toBe('confirmed')
    })

    it('rejects if booking is already completed', async () => {
      const { bookingId } = await seedBooking({ state: 'completed' })

      const result = await executeResolveAsCompleted(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'Should fail.',
      })

      expect(result.ok).toBe(false)
    })

    it('rejects non-existent booking', async () => {
      const result = await executeResolveAsCompleted(db, {
        adminUserId: 'u_admin',
        bookingId: crypto.randomUUID(),
        notes: 'Ghost booking.',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/not found/i)
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // Resolution B: disputed → cancelled_post_experience
  // ═══════════════════════════════════════════════════════════════════

  describe('executeResolveAsCancelledPostExperience', () => {
    it('transitions disputed → cancelled_post_experience and sets cancelledAt', async () => {
      const { bookingId } = await seedBooking({ state: 'disputed' })

      const result = await executeResolveAsCancelledPostExperience(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'Customer complaint validated, full refund.',
      })

      expect(result.ok).toBe(true)

      const [row] = await db
        .select({
          state: bookings.state,
          cancelledAt: bookings.cancelledAt,
          cancellationReason: bookings.cancellationReason,
        })
        .from(bookings)
        .where(eq(bookings.id, bookingId))

      expect(row?.state).toBe('cancelled_post_experience')
      expect(row?.cancelledAt).toBeInstanceOf(Date)
      expect(row?.cancellationReason).toBe('Customer complaint validated, full refund.')
    })

    it('creates full refund to Customer Refund balance', async () => {
      const { bookingId } = await seedBooking({ state: 'disputed', grossRupees: 5000 })

      await executeResolveAsCancelledPostExperience(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'Full refund — Customer wins.',
      })

      expect(await readRefundBalance('u_customer')).toBe(5000)

      // Verify refund_requests row
      const refundRows = await db
        .select()
        .from(refundRequests)
        .where(eq(refundRequests.bookingId, bookingId))
      expect(refundRows).toHaveLength(1)
      expect(refundRows[0]?.amount).toBe('5000.00')
      expect(refundRows[0]?.reason).toBe('outside_policy_dispute_resolved')
      expect(refundRows[0]?.state).toBe('credited')
      expect(refundRows[0]?.policyWindowBasisSnapshot).toBe('admin_override')
    })

    it('commission is effectively zero (full refund + no payout; snapshots immutable per ADR-0008)', async () => {
      const { bookingId } = await seedBooking({
        state: 'disputed',
        grossRupees: 5000,
        commissionRate: '20.00',
      })

      await executeResolveAsCancelledPostExperience(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'No commission — Customer wins.',
      })

      // Snapshot columns remain immutable
      const [row] = await db
        .select({
          commissionRateSnapshot: bookings.commissionRateSnapshot,
          commissionBasisSnapshot: bookings.commissionBasisSnapshot,
        })
        .from(bookings)
        .where(eq(bookings.id, bookingId))

      expect(row?.commissionRateSnapshot).toBe('20.00')
      expect(row?.commissionBasisSnapshot).toBe('vendor_default')

      // Audit log records that commission is effectively zero
      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.dispute_resolved_cancel'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      const payload = auditRows[0]?.payload as Record<string, unknown>
      expect(payload.commissionEffectivelyZero).toBe(true)
      expect(payload.refundAmountRupees).toBe(5000)
    })

    it('sets payoutState to rejected (no payout)', async () => {
      const { bookingId } = await seedBooking({ state: 'disputed' })

      await executeResolveAsCancelledPostExperience(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'No payout — Customer wins.',
      })

      const [row] = await db
        .select({ payoutState: bookings.payoutState })
        .from(bookings)
        .where(eq(bookings.id, bookingId))

      expect(row?.payoutState).toBe('rejected')
    })

    it('writes a booking.dispute_resolved_cancel audit log', async () => {
      const { bookingId } = await seedBooking({ state: 'disputed', grossRupees: 4000 })

      await executeResolveAsCancelledPostExperience(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'Audit test for cancel resolution.',
      })

      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.dispute_resolved_cancel'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.actorUserId).toBe('u_admin')
      const payload = rows[0]?.payload as Record<string, unknown>
      expect(payload.previousState).toBe('disputed')
      expect(payload.newState).toBe('cancelled_post_experience')
      expect(payload.notes).toBe('Audit test for cancel resolution.')
      expect(payload.refundAmountRupees).toBe(4000)
    })

    // ── Guard: notes required ────────────────────────────────────────

    it('rejects empty notes', async () => {
      const { bookingId } = await seedBooking({ state: 'disputed' })

      const result = await executeResolveAsCancelledPostExperience(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: '',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/notes.*required/i)
      }
    })

    it('surfaces a non-notes validation error verbatim (invalid bookingId)', async () => {
      const result = await executeResolveAsCancelledPostExperience(db, {
        adminUserId: 'u_admin',
        bookingId: 'not-a-uuid',
        notes: 'Valid notes here.',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/UUID/i)
        expect(result.error).not.toMatch(/Admin notes are required/i)
      }
    })

    // ── Guard: only disputed bookings ────────────────────────────────

    it('rejects non-disputed bookings (confirmed)', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed' })

      const result = await executeResolveAsCancelledPostExperience(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'Should fail.',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/disputed/i)
      }

      const [row] = await db
        .select({ state: bookings.state })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(row?.state).toBe('confirmed')
    })

    it('rejects non-existent booking', async () => {
      const result = await executeResolveAsCancelledPostExperience(db, {
        adminUserId: 'u_admin',
        bookingId: crypto.randomUUID(),
        notes: 'Ghost booking.',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/not found/i)
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // Dispute pause / resume lifecycle (ADR-0016)
  // ═══════════════════════════════════════════════════════════════════
  //
  // "Dispute open at T+7 → Payout held, timer pauses, resumes T+7 after
  //  Dispute resolves for Vendor, or cancelled if Customer wins."
  //
  // The seedBooking helper above creates disputed Bookings already in
  // payoutState='held' (the pause). These tests assert the two resume
  // branches end-to-end on the payout state itself.

  describe('dispute pause/resume on Payout (ADR-0016)', () => {
    it('resolved for Vendor: payout RESUMES (held → pending) so the T+7 timer restarts', async () => {
      const { bookingId } = await seedBooking({ state: 'disputed' })

      // Precondition: the Dispute paused the payout (held).
      const [before] = await db
        .select({ payoutState: bookings.payoutState })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(before?.payoutState).toBe('held')

      const result = await executeResolveAsCompleted(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'Vendor delivered; dispute closed in Vendor favour.',
      })
      expect(result.ok).toBe(true)

      // Resume: held → pending; booking is completed so the payout countdown runs again.
      const [after] = await db
        .select({ payoutState: bookings.payoutState, state: bookings.state })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(after?.payoutState).toBe('pending')
      expect(after?.state).toBe('completed')

      // Audit row documents the held → pending resume for reconciliation.
      const [auditRow] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.dispute_resolved_complete'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      const payload = auditRow?.payload as Record<string, unknown>
      expect(payload.payoutStateChange).toBe('held → pending')
    })

    it('resolved for Customer: payout is CANCELLED (held → rejected), no Vendor disbursement', async () => {
      const { bookingId } = await seedBooking({ state: 'disputed', grossRupees: 5000 })

      const [before] = await db
        .select({ payoutState: bookings.payoutState })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(before?.payoutState).toBe('held')

      const result = await executeResolveAsCancelledPostExperience(db, {
        adminUserId: 'u_admin',
        bookingId,
        notes: 'Experience not delivered; Customer wins, full refund.',
      })
      expect(result.ok).toBe(true)

      // Cancelled: held → rejected; booking moves to cancelled_post_experience.
      const [after] = await db
        .select({
          payoutState: bookings.payoutState,
          state: bookings.state,
          payoutRejectionReason: bookings.payoutRejectionReason,
        })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(after?.payoutState).toBe('rejected')
      expect(after?.state).toBe('cancelled_post_experience')
      expect(after?.payoutRejectionReason).toContain('Dispute resolved')

      // Customer received the full refund (no Vendor payout occurs).
      expect(await readRefundBalance('u_customer')).toBe(5000)

      const [auditRow] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.dispute_resolved_cancel'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      const payload = auditRow?.payload as Record<string, unknown>
      expect(payload.payoutStateChange).toBe('held → rejected')
      expect(payload.commissionEffectivelyZero).toBe(true)
    })
  })
})
