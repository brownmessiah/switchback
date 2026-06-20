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
  executeMarkComplete,
  executeMarkNoShow,
  executeVendorCancel,
  VendorActionError,
} from './vendor-actions'

/**
 * Vendor booking actions per ADR-0003. Two pure-function entry points:
 *
 *  - executeMarkComplete: awaiting_completion → completed
 *  - executeVendorCancel: confirmed|awaiting_completion → cancelled_by_vendor
 *
 * Each function accepts a DBOrTx so tests run against PGlite without
 * mocking Next.js request infrastructure.
 */
describe('vendor booking actions (ADR-0003)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_v', email: 'vendor@test.com', name: 'Test Vendor' },
      { id: 'u_c', email: 'customer@test.com', name: 'Test Customer' },
      { id: 'u_other_v', email: 'other-vendor@test.com', name: 'Other Vendor' },
    ])
    await db.insert(vendorProfiles).values([
      {
        userId: 'u_v',
        businessName: 'Test Adventures',
        slug: 'test-adventures',
        pan: 'ABCDE1234F',
        commissionRate: '20.00',
        responseTimeSlaScore: '100.00',
        payoutMethod: 'upi',
        payoutDestination: { vpa: 'vendor@upi' },
      },
      {
        userId: 'u_other_v',
        businessName: 'Other Adventures',
        slug: 'other-adventures',
        responseTimeSlaScore: '100.00',
      },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, payments, refund_requests, bookings, availability_slots, experiences, wallet_balances CASCADE`,
    )
    // Reset SLA score before each test
    await db
      .update(vendorProfiles)
      .set({ responseTimeSlaScore: '100.00' })
      .where(eq(vendorProfiles.userId, 'u_v'))

    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
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
   * Seed a booking in a given state. Returns booking ID and slot ID.
   */
  async function seedBooking(args: {
    state:
      | 'confirmed'
      | 'awaiting_completion'
      | 'completed'
      | 'disputed'
      | 'cancelled_by_customer'
    grossRupees?: number
    /** When true, the slot has already ended (4h ago) — used by no-show tests. */
    past?: boolean
  }): Promise<{ bookingId: string; slotId: string }> {
    const startAt = args.past
      ? new Date(Date.now() - 8 * 60 * 60 * 1000)
      : new Date(Date.now() + 24 * 60 * 60 * 1000)
    const endAt = args.past
      ? new Date(Date.now() - 4 * 60 * 60 * 1000)
      : new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })

    const gross = args.grossRupees ?? 3000
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_c',
        experienceId,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'full_upfront',
        state: args.state,
        grossTotalSnapshot: gross.toFixed(2),
        pricePerParticipantSnapshot: (gross / 2).toFixed(2),
        pricingBasisSnapshot: 'experience_bracket:1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: 'flexible',
        tdsAmountSnapshot: (gross * 0.01).toFixed(2),
        gstRateOnCommissionSnapshot: '18.00',
        vendorPanSnapshot: 'ABCDE1234F',
        vendorIsResidentSnapshot: true,
        payoutMethodSnapshot: 'upi',
        payoutDestinationSnapshot: { vpa: 'vendor@upi' },
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

  async function readSlaScore(userId: string): Promise<string> {
    const [row] = await db
      .select({ score: vendorProfiles.responseTimeSlaScore })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, userId))
    return row?.score ?? '0.00'
  }

  // ═══════════════════════════════════════════════════════════════════
  // Mark-complete
  // ═══════════════════════════════════════════════════════════════════

  describe('executeMarkComplete', () => {
    it('transitions awaiting_completion → completed and sets completedAt', async () => {
      const { bookingId } = await seedBooking({ state: 'awaiting_completion' })

      const result = await executeMarkComplete(db, bookingId, 'u_v')

      expect(result.bookingId).toBe(bookingId)
      expect(result.completedAt).toBeInstanceOf(Date)

      const [row] = await db
        .select({ state: bookings.state, completedAt: bookings.completedAt })
        .from(bookings)
        .where(eq(bookings.id, bookingId))

      expect(row?.state).toBe('completed')
      expect(row?.completedAt).toBeInstanceOf(Date)
    })

    it('writes a booking.mark_complete audit log entry', async () => {
      const { bookingId } = await seedBooking({ state: 'awaiting_completion' })

      await executeMarkComplete(db, bookingId, 'u_v')

      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.mark_complete'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.actorUserId).toBe('u_v')
      const payload = rows[0]?.payload as Record<string, unknown>
      expect(payload.previousState).toBe('awaiting_completion')
      expect(payload.newState).toBe('completed')
      expect(payload.autoCompleted).toBe(false)
    })

    it('rejects if booking is not in awaiting_completion state (confirmed)', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed' })

      await expect(
        executeMarkComplete(db, bookingId, 'u_v'),
      ).rejects.toThrow(VendorActionError)

      await expect(
        executeMarkComplete(db, bookingId, 'u_v'),
      ).rejects.toThrow(/only awaiting_completion/i)

      // Booking state unchanged
      const [row] = await db
        .select({ state: bookings.state })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(row?.state).toBe('confirmed')
    })

    it('rejects if booking is already completed', async () => {
      const { bookingId } = await seedBooking({ state: 'completed' })

      await expect(
        executeMarkComplete(db, bookingId, 'u_v'),
      ).rejects.toThrow(VendorActionError)
    })

    it('rejects if wrong vendor', async () => {
      const { bookingId } = await seedBooking({ state: 'awaiting_completion' })

      await expect(
        executeMarkComplete(db, bookingId, 'u_other_v'),
      ).rejects.toThrow(/does not own/i)

      // Booking state unchanged
      const [row] = await db
        .select({ state: bookings.state })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(row?.state).toBe('awaiting_completion')
    })

    it('rejects if booking does not exist', async () => {
      await expect(
        executeMarkComplete(db, crypto.randomUUID(), 'u_v'),
      ).rejects.toThrow(VendorActionError)
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // Completion state machine (ADR-0003) — explicit transition assertions
  // ═══════════════════════════════════════════════════════════════════
  //
  // confirmed → awaiting_completion → completed
  //                                 \→ disputed  (BLOCKS completion)
  //
  // mark_complete only fires from awaiting_completion; the disputed branch
  // must be resolved by support before completion can occur (ADR-0003: "An
  // open Dispute BLOCKS completion until resolved.").

  describe('completion state machine (ADR-0003)', () => {
    it('asserts the confirmed → awaiting_completion → completed chain', async () => {
      // 1. Booking starts confirmed; mark_complete is NOT yet allowed
      //    (the experience hasn't reached end_at, so it is not awaiting_completion).
      const { bookingId } = await seedBooking({ state: 'confirmed' })
      const [s0] = await db
        .select({ state: bookings.state })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(s0?.state).toBe('confirmed')
      await expect(executeMarkComplete(db, bookingId, 'u_v')).rejects.toThrow(
        /only awaiting_completion/i,
      )

      // 2. End-of-experience advances confirmed → awaiting_completion
      //    (this is the at-end_at transition the M3 cron performs; here we
      //    apply it directly to assert the next legal hop).
      await db
        .update(bookings)
        .set({ state: 'awaiting_completion', updatedAt: sql`now()` })
        .where(eq(bookings.id, bookingId))

      // 3. Vendor mark_complete now succeeds: awaiting_completion → completed.
      const result = await executeMarkComplete(db, bookingId, 'u_v')
      expect(result.completedAt).toBeInstanceOf(Date)
      const [s2] = await db
        .select({ state: bookings.state, completedAt: bookings.completedAt })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(s2?.state).toBe('completed')
      expect(s2?.completedAt).toBeInstanceOf(Date)
    })

    it('BLOCKS completion while a Dispute is open (disputed cannot be marked complete)', async () => {
      const { bookingId } = await seedBooking({ state: 'disputed' })

      await expect(executeMarkComplete(db, bookingId, 'u_v')).rejects.toThrow(
        VendorActionError,
      )
      await expect(executeMarkComplete(db, bookingId, 'u_v')).rejects.toThrow(
        /only awaiting_completion/i,
      )

      // State is unchanged — the Dispute still blocks completion.
      const [row] = await db
        .select({ state: bookings.state })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(row?.state).toBe('disputed')
    })

    it('records autoCompleted=false on a Vendor-initiated mark_complete audit row', async () => {
      // The end_at+24h auto-completion path (M3 cron) stamps autoCompleted=true
      // per ADR-0003; the Vendor-driven path here stamps false. This asserts
      // the audit row carries the distinguishing flag the SLA tracker reads.
      const { bookingId } = await seedBooking({ state: 'awaiting_completion' })
      await executeMarkComplete(db, bookingId, 'u_v')

      const [auditRow] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.mark_complete'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      const payload = auditRow?.payload as Record<string, unknown>
      expect(payload.autoCompleted).toBe(false)

      // And the booking row was NOT auto-completed.
      const [row] = await db
        .select({ autoCompleted: bookings.autoCompleted })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(row?.autoCompleted).toBe(false)
    })

    // AC#1 auto-completion path (end_at+24h → completed, autoCompleted=true) is
    // M3-DEFERRED, not a coverage gap: no completion cron exists (the only cron
    // is app/api/cron/partial-pay-autocapture/route.ts), and the production code
    // explicitly defers it — see lib/payments/partial-pay-autocapture.ts:
    // "M3's completion auto-trigger ... M3 will introduce a dedicated ... state".
    // The autoCompleted column and the false-stamping mark_complete path are built
    // and tested above; the auto-trigger itself is outside this program's
    // built-surface scope (ADR-0003 defines it; M3 wires the cron).
    it.todo(
      'auto-completes at end_at+24h with autoCompleted=true (M3 completion cron — not yet built)',
    )
  })

  // ═══════════════════════════════════════════════════════════════════
  // Vendor-cancel
  // ═══════════════════════════════════════════════════════════════════

  describe('executeVendorCancel', () => {
    it('transitions confirmed → cancelled_by_vendor', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed' })

      const result = await executeVendorCancel(
        db,
        bookingId,
        'u_v',
        'Customer requested date change',
      )

      expect(result.bookingId).toBe(bookingId)

      const [row] = await db
        .select({
          state: bookings.state,
          cancelledAt: bookings.cancelledAt,
          cancellationReason: bookings.cancellationReason,
        })
        .from(bookings)
        .where(eq(bookings.id, bookingId))

      expect(row?.state).toBe('cancelled_by_vendor')
      expect(row?.cancelledAt).toBeInstanceOf(Date)
      expect(row?.cancellationReason).toBe('Customer requested date change')
    })

    it('transitions awaiting_completion → cancelled_by_vendor', async () => {
      const { bookingId } = await seedBooking({ state: 'awaiting_completion' })

      const result = await executeVendorCancel(
        db,
        bookingId,
        'u_v',
        'Weather emergency',
      )

      const [row] = await db
        .select({ state: bookings.state })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(row?.state).toBe('cancelled_by_vendor')
    })

    it('creates full refund to Customer Refund balance', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed', grossRupees: 5000 })

      const result = await executeVendorCancel(
        db,
        bookingId,
        'u_v',
        'Equipment failure',
      )

      expect(result.refundAmountRupees).toBe(5000)
      expect(await readRefundBalance('u_c')).toBe(5000)

      // Verify the refund_requests row
      const [reqRow] = await db
        .select()
        .from(refundRequests)
        .where(eq(refundRequests.id, result.refundRequestId))
      expect(reqRow?.reason).toBe('vendor_cancelled')
      expect(reqRow?.state).toBe('credited')
      expect(reqRow?.amount).toBe('5000.00')
      expect(reqRow?.destination).toBe('refund_balance')
      expect(reqRow?.policyWindowBasisSnapshot).toBe('vendor_cancelled')
    })

    it('decrements SLA score by 5.00', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed' })

      const scoreBefore = await readSlaScore('u_v')
      expect(scoreBefore).toBe('100.00')

      const result = await executeVendorCancel(
        db,
        bookingId,
        'u_v',
        'Cannot accommodate',
      )

      expect(result.slaScoreAfter).toBe('95.00')
      expect(await readSlaScore('u_v')).toBe('95.00')
    })

    it('floors SLA score at 0 (never goes negative)', async () => {
      // Set score to 3.00 before cancel
      await db
        .update(vendorProfiles)
        .set({ responseTimeSlaScore: '3.00' })
        .where(eq(vendorProfiles.userId, 'u_v'))

      const { bookingId } = await seedBooking({ state: 'confirmed' })

      const result = await executeVendorCancel(
        db,
        bookingId,
        'u_v',
        'Force majeure',
      )

      expect(result.slaScoreAfter).toBe('0.00')
      expect(await readSlaScore('u_v')).toBe('0.00')
    })

    it('requires reason text (rejects empty string)', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed' })

      await expect(
        executeVendorCancel(db, bookingId, 'u_v', ''),
      ).rejects.toThrow(/reason.*required/i)

      // State unchanged
      const [row] = await db
        .select({ state: bookings.state })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(row?.state).toBe('confirmed')
    })

    it('requires reason text (rejects whitespace-only)', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed' })

      await expect(
        executeVendorCancel(db, bookingId, 'u_v', '   \n\t  '),
      ).rejects.toThrow(/reason.*required/i)
    })

    it('rejects if booking is already completed', async () => {
      const { bookingId } = await seedBooking({ state: 'completed' })

      await expect(
        executeVendorCancel(db, bookingId, 'u_v', 'Too late'),
      ).rejects.toThrow(VendorActionError)
    })

    it('rejects if booking is already cancelled', async () => {
      const { bookingId } = await seedBooking({ state: 'cancelled_by_customer' })

      await expect(
        executeVendorCancel(db, bookingId, 'u_v', 'Double cancel'),
      ).rejects.toThrow(VendorActionError)
    })

    it('rejects if wrong vendor', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed' })

      await expect(
        executeVendorCancel(db, bookingId, 'u_other_v', 'Not my booking'),
      ).rejects.toThrow(/does not own/i)
    })

    it('rejects if booking does not exist', async () => {
      await expect(
        executeVendorCancel(db, crypto.randomUUID(), 'u_v', 'Ghost booking'),
      ).rejects.toThrow(VendorActionError)
    })

    it('writes a booking.vendor_cancel audit log entry', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed', grossRupees: 3000 })

      await executeVendorCancel(db, bookingId, 'u_v', 'Audit test reason')

      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.vendor_cancel'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.actorUserId).toBe('u_v')
      const payload = rows[0]?.payload as Record<string, unknown>
      expect(payload.reason).toBe('Audit test reason')
      expect(payload.refundAmountRupees).toBe(3000)
      expect(payload.slaPenalty).toBe('5.00')
      expect(payload.newState).toBe('cancelled_by_vendor')
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // Mark-no-show (ADR-0003 revision 2026-06-01)
  // ═══════════════════════════════════════════════════════════════════

  describe('executeMarkNoShow', () => {
    it('transitions a confirmed booking whose slot has ended → no_show', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed', past: true })

      const result = await executeMarkNoShow(db, bookingId, 'u_v')
      expect(result.bookingId).toBe(bookingId)

      const [row] = await db
        .select({ state: bookings.state })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(row?.state).toBe('no_show')
    })

    it('transitions an awaiting_completion booking whose slot has ended → no_show', async () => {
      const { bookingId } = await seedBooking({ state: 'awaiting_completion', past: true })
      await executeMarkNoShow(db, bookingId, 'u_v')
      const [row] = await db
        .select({ state: bookings.state })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(row?.state).toBe('no_show')
    })

    it('issues NO customer refund and leaves the vendor SLA score untouched', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed', past: true, grossRupees: 4000 })
      const slaBefore = await readSlaScore('u_v')

      await executeMarkNoShow(db, bookingId, 'u_v')

      // No refund_requests row, no refund-balance credit (vendor retains).
      const refunds = await db
        .select({ id: refundRequests.id })
        .from(refundRequests)
        .where(eq(refundRequests.bookingId, bookingId))
      expect(refunds).toHaveLength(0)
      expect(await readRefundBalance('u_c')).toBe(0)
      // No completion ⇒ no payout countdown.
      const [row] = await db
        .select({ completedAt: bookings.completedAt })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(row?.completedAt).toBeNull()
      // Customer at fault — vendor is NOT penalised.
      expect(await readSlaScore('u_v')).toBe(slaBefore)
    })

    it('rejects when the slot has NOT yet ended (SLOT_NOT_ENDED), leaving state unchanged', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed', past: false })
      await expect(executeMarkNoShow(db, bookingId, 'u_v')).rejects.toMatchObject({
        code: 'SLOT_NOT_ENDED',
      })
      const [row] = await db
        .select({ state: bookings.state })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(row?.state).toBe('confirmed')
    })

    it('rejects a completed booking (INVALID_STATE)', async () => {
      const { bookingId } = await seedBooking({ state: 'completed', past: true })
      await expect(executeMarkNoShow(db, bookingId, 'u_v')).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })

    it('rejects when the caller does not own the booking (NOT_VENDOR_BOOKING)', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed', past: true })
      await expect(executeMarkNoShow(db, bookingId, 'u_other_v')).rejects.toMatchObject({
        code: 'NOT_VENDOR_BOOKING',
      })
    })

    it('rejects an unknown booking (BOOKING_NOT_FOUND)', async () => {
      await expect(
        executeMarkNoShow(db, '00000000-0000-0000-0000-000000000000', 'u_v'),
      ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' })
    })

    it('writes a booking.mark_no_show audit row with the previous state', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed', past: true })
      await executeMarkNoShow(db, bookingId, 'u_v')
      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, bookingId),
            eq(auditLogs.action, 'booking.mark_no_show'),
          ),
        )
      expect(rows).toHaveLength(1)
      const payload = rows[0]?.payload as Record<string, unknown>
      expect(payload.previousState).toBe('confirmed')
      expect(payload.newState).toBe('no_show')
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // Two-id audit split (issue #11 §5) — ownership/SLA = SHOP, audit actor =
  // the ACTING member. A member acts ON the shop's booking; the audit row +
  // refund requestedByUserId must record the human, the SLA penalty + booking
  // ownership the shop.
  // ═══════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════
  // Defensive guards — data-integrity gaps that should never occur but are
  // guarded anyway (a booking referencing a missing slot; a cancel whose
  // vendor profile row has vanished). We force the gap with the FK triggers
  // disabled (session_replication_role=replica) so the guard arm is exercised
  // by REAL behaviour, not a mock.
  // ═══════════════════════════════════════════════════════════════════

  describe('defensive guards (data-integrity gaps)', () => {
    it('mark-no-show throws BOOKING_NOT_FOUND when the slot row is missing', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed', past: true })

      // Re-point the booking at a slot that does not exist, bypassing the
      // ON DELETE RESTRICT FK so the missing-slot guard (not the FK) is what
      // rejects the action.
      const ghostSlotId = '00000000-0000-0000-0000-0000000000ff'
      await db.execute(sql`SET session_replication_role = replica`)
      try {
        await db
          .update(bookings)
          .set({ slotId: ghostSlotId })
          .where(eq(bookings.id, bookingId))
      } finally {
        await db.execute(sql`SET session_replication_role = origin`)
      }

      await expect(executeMarkNoShow(db, bookingId, 'u_v')).rejects.toMatchObject({
        code: 'BOOKING_NOT_FOUND',
      })

      // State unchanged — no transition past the missing-slot guard.
      const [row] = await db
        .select({ state: bookings.state })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(row?.state).toBe('confirmed')
    })

    it('vendor-cancel falls back to "0.00" SLA score when the vendor profile row is gone', async () => {
      // A confirmed booking owned by u_v. Delete the vendor profile AFTER the
      // ownership read would pass but the SLA read-back finds no row → the
      // `vendorRow?.slaScore ?? '0.00'` nullish fallback fires.
      const { bookingId } = await seedBooking({ state: 'confirmed', grossRupees: 2000 })

      await db.execute(sql`SET session_replication_role = replica`)
      try {
        await db.delete(vendorProfiles).where(eq(vendorProfiles.userId, 'u_v'))
      } finally {
        await db.execute(sql`SET session_replication_role = origin`)
      }

      const result = await executeVendorCancel(db, bookingId, 'u_v', 'profile vanished')

      // The action still completes; the missing profile yields the floor value.
      expect(result.slaScoreAfter).toBe('0.00')
      // And the refund still credits the customer (money path unaffected).
      expect(result.refundAmountRupees).toBe(2000)
      expect(await readRefundBalance('u_c')).toBe(2000)

      // Re-seed the profile so later tests (which reset it) find a row.
      await db.execute(sql`SET session_replication_role = replica`)
      try {
        await db.insert(vendorProfiles).values({
          userId: 'u_v',
          businessName: 'Test Adventures',
          slug: 'test-adventures',
          pan: 'ABCDE1234F',
          commissionRate: '20.00',
          responseTimeSlaScore: '100.00',
          payoutMethod: 'upi',
          payoutDestination: { vpa: 'vendor@upi' },
        })
      } finally {
        await db.execute(sql`SET session_replication_role = origin`)
      }
    })

    it('vendor-cancel on a zero-gross booking skips the wallet credit but still records the refund request', async () => {
      // grossRupees=0 ⇒ the `grossRupees > 0` guard around creditRefundBalance
      // is false; the refund_requests row is still written (audit completeness)
      // but no wallet credit occurs.
      const { bookingId } = await seedBooking({ state: 'confirmed', grossRupees: 0 })

      const result = await executeVendorCancel(db, bookingId, 'u_v', 'free booking')
      expect(result.refundAmountRupees).toBe(0)
      // No wallet credit for the customer.
      expect(await readRefundBalance('u_c')).toBe(0)
      // But the refund_requests row exists for the audit trail.
      const [reqRow] = await db
        .select({ amount: refundRequests.amount })
        .from(refundRequests)
        .where(eq(refundRequests.id, result.refundRequestId))
      expect(reqRow?.amount).toBe('0.00')
    })
  })

  describe('two-id audit split (issue #11 §5)', () => {
    it('mark-complete: actorUserId records the acting member, ownership keys on the shop', async () => {
      const { bookingId } = await seedBooking({ state: 'awaiting_completion' })

      // shop = 'u_v', acting member = 'u_other_v' standing in for a member.
      await executeMarkComplete(db, bookingId, 'u_v', 'u_other_v')

      const [row] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.mark_complete'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      // Audit actor is the ACTING human, not the shop.
      expect(row?.actorUserId).toBe('u_other_v')
      const payload = row?.payload as Record<string, unknown>
      // The shop (scope) is still recorded in the payload.
      expect(payload.vendorUserId).toBe('u_v')

      // Booking actually transitioned (ownership check passed against the shop).
      const [b] = await db
        .select({ state: bookings.state })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(b?.state).toBe('completed')
    })

    it('mark-complete: defaults the audit actor to the shop when actingUserId is omitted (back-compat)', async () => {
      const { bookingId } = await seedBooking({ state: 'awaiting_completion' })
      await executeMarkComplete(db, bookingId, 'u_v')
      const [row] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.mark_complete'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      expect(row?.actorUserId).toBe('u_v')
    })

    it('vendor-cancel: audit actor + refund requestedByUserId = acting member; SLA penalty hits the shop', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed', grossRupees: 4000 })

      await executeVendorCancel(db, bookingId, 'u_v', 'weather', 'u_other_v')

      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.vendor_cancel'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      expect(audit?.actorUserId).toBe('u_other_v')

      const [refund] = await db
        .select({ requestedByUserId: refundRequests.requestedByUserId })
        .from(refundRequests)
        .where(eq(refundRequests.bookingId, bookingId))
      // The refund is attributed to the acting human.
      expect(refund?.requestedByUserId).toBe('u_other_v')

      // SLA penalty applied to the SHOP's profile (u_v), not the acting member.
      const shopScore = await readSlaScore('u_v')
      expect(Number(shopScore)).toBeLessThan(100)
    })

    it('mark-no-show: audit actor records the acting member, ownership keys on the shop', async () => {
      const { bookingId } = await seedBooking({ state: 'confirmed', past: true })
      await executeMarkNoShow(db, bookingId, 'u_v', {}, 'u_other_v')
      const [row] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.mark_no_show'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      expect(row?.actorUserId).toBe('u_other_v')
    })
  })
})
