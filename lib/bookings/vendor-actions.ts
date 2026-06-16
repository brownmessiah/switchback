import { eq, sql } from 'drizzle-orm'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { refundRequests } from '@/db/schema/refund-requests'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { writeAuditLog } from '@/lib/audit/write'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { creditRefundBalance } from '@/lib/payments/wallet'

import { isNoShowMarkableState } from './state-machine'

/**
 * Vendor booking actions per ADR-0003 (Booking Completion State Machine).
 *
 * Two exported pure functions accept a Drizzle `DBOrTx` so they are
 * testable with PGlite without mocking Next.js request machinery.
 *
 * Mark-complete:
 *   awaiting_completion → completed  (sets completedAt)
 *   Triggers: commission realisation, payout countdown (T+7), review window.
 *
 * Vendor-cancel:
 *   confirmed | awaiting_completion → cancelled_by_vendor
 *   Full refund to Customer's Refund balance regardless of cancellation
 *   policy. Vendor's Response-time SLA score takes a penalty hit.
 */

// ── Error types ─────────────────────────────────────────────────────

export type VendorActionErrorCode =
  | 'BOOKING_NOT_FOUND'
  | 'NOT_VENDOR_BOOKING'
  | 'INVALID_STATE'
  | 'REASON_REQUIRED'
  | 'SLOT_NOT_ENDED'

export class VendorActionError extends Error {
  constructor(
    public code: VendorActionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'VendorActionError'
  }
}

// ── Mark-complete ───────────────────────────────────────────────────

export interface MarkCompleteResult {
  bookingId: string
  completedAt: Date
}

/**
 * Transition a Booking from `awaiting_completion` to `completed`.
 *
 * Per ADR-0003, Completion triggers:
 *  - Commission realisation
 *  - Payout countdown (T+7)
 *  - Review window open
 *  - WhatsApp review prompt
 *
 * The function verifies:
 *  1. Booking exists
 *  2. Booking belongs to the calling Vendor (via experience.vendor_user_id)
 *  3. Booking state is `awaiting_completion`
 *
 * Caller must wrap in db.transaction(...) for atomicity.
 */
export async function executeMarkComplete(
  db: DBOrTx,
  bookingId: string,
  vendorUserId: string,
  // issue #11 §5 — the acting human (audit actor). Defaults to the shop owner
  // for the single-seat path (back-compat); a member passes their own id so the
  // audit row attributes the action to the human, not the account.
  actingUserId: string = vendorUserId,
): Promise<MarkCompleteResult> {
  // 1. Fetch booking + verify existence
  const [booking] = await db
    .select({
      id: bookings.id,
      state: bookings.state,
      experienceId: bookings.experienceId,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for('update')
    .limit(1)

  if (!booking) {
    throw new VendorActionError('BOOKING_NOT_FOUND', `booking ${bookingId} not found`)
  }

  // 2. Verify the Vendor owns the Experience this Booking is on
  const [experience] = await db
    .select({ vendorUserId: experiences.vendorUserId })
    .from(experiences)
    .where(eq(experiences.id, booking.experienceId))
    .limit(1)

  if (!experience || experience.vendorUserId !== vendorUserId) {
    throw new VendorActionError(
      'NOT_VENDOR_BOOKING',
      `vendor ${vendorUserId} does not own booking ${bookingId}`,
    )
  }

  // 3. State guard: only awaiting_completion can be marked complete
  if (booking.state !== 'awaiting_completion') {
    throw new VendorActionError(
      'INVALID_STATE',
      `booking ${bookingId} is in state ${booking.state}; only awaiting_completion bookings can be marked complete`,
    )
  }

  const now = new Date()

  // 4. Transition state + set completedAt
  await db
    .update(bookings)
    .set({
      state: 'completed',
      completedAt: now,
      updatedAt: sql`now()`,
    })
    .where(eq(bookings.id, bookingId))

  // 5. Audit log. Actor = the acting human (§5); the shop is in the payload.
  await writeAuditLog(db, {
    actorUserId: actingUserId,
    action: 'booking.mark_complete',
    entityType: 'booking',
    entityId: bookingId,
    payload: {
      bookingId,
      vendorUserId,
      actingUserId,
      previousState: 'awaiting_completion',
      newState: 'completed',
      completedAt: now.toISOString(),
      autoCompleted: false,
    },
  })

  return { bookingId, completedAt: now }
}

// ── Vendor-cancel ───────────────────────────────────────────────────

/** SLA score penalty per vendor cancellation (floor at 0). */
const VENDOR_CANCEL_SLA_PENALTY = '5.00'

export interface VendorCancelResult {
  bookingId: string
  refundAmountRupees: number
  refundRequestId: string
  slaScoreAfter: string
}

/**
 * Vendor-initiated cancellation. Per CONTEXT.md:
 *   "Vendor-cancelled Booking: Always full-refund regardless of
 *    Cancellation policy; Vendor's Response-time SLA score takes a hit."
 *
 * The function:
 *  1. Verifies booking exists and belongs to Vendor
 *  2. Verifies state is `confirmed` or `awaiting_completion`
 *  3. Requires a reason string (mandatory per task spec)
 *  4. Transitions to `cancelled_by_vendor`
 *  5. Full refund to Customer's Refund balance
 *  6. Decrements Vendor's responseTimeSlaScore by 5.00 (floor 0)
 *  7. Audit log
 *
 * Caller must wrap in db.transaction(...) for atomicity.
 */
export async function executeVendorCancel(
  db: DBOrTx,
  bookingId: string,
  vendorUserId: string,
  reason: string,
  // issue #11 §5 — the acting human (audit actor + refund requestedByUserId).
  // Defaults to the shop owner (single-seat back-compat); a member passes their
  // own id so the action is attributed to them, while ownership + the SLA
  // penalty stay on the shop.
  actingUserId: string = vendorUserId,
): Promise<VendorCancelResult> {
  // 0. Reason is mandatory
  const trimmedReason = reason.trim()
  if (!trimmedReason) {
    throw new VendorActionError('REASON_REQUIRED', 'cancellation reason is required')
  }

  // 1. Fetch booking + lock
  const [booking] = await db
    .select({
      id: bookings.id,
      state: bookings.state,
      experienceId: bookings.experienceId,
      customerUserId: bookings.customerUserId,
      grossTotalSnapshot: bookings.grossTotalSnapshot,
      cancellationPresetSnapshot: bookings.cancellationPresetSnapshot,
      commissionRateSnapshot: bookings.commissionRateSnapshot,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for('update')
    .limit(1)

  if (!booking) {
    throw new VendorActionError('BOOKING_NOT_FOUND', `booking ${bookingId} not found`)
  }

  // 2. Verify ownership
  const [experience] = await db
    .select({ vendorUserId: experiences.vendorUserId })
    .from(experiences)
    .where(eq(experiences.id, booking.experienceId))
    .limit(1)

  if (!experience || experience.vendorUserId !== vendorUserId) {
    throw new VendorActionError(
      'NOT_VENDOR_BOOKING',
      `vendor ${vendorUserId} does not own booking ${bookingId}`,
    )
  }

  // 3. State guard: confirmed or awaiting_completion
  const VENDOR_CANCELLABLE_STATES = new Set(['confirmed', 'awaiting_completion'])
  if (!VENDOR_CANCELLABLE_STATES.has(booking.state)) {
    throw new VendorActionError(
      'INVALID_STATE',
      `booking ${bookingId} is in state ${booking.state}; only confirmed or awaiting_completion bookings can be vendor-cancelled`,
    )
  }

  const grossRupees = Math.floor(Number(booking.grossTotalSnapshot))
  const now = new Date()

  // 4. Transition booking state
  await db
    .update(bookings)
    .set({
      state: 'cancelled_by_vendor',
      cancelledAt: now,
      cancellationReason: trimmedReason,
      updatedAt: sql`now()`,
    })
    .where(eq(bookings.id, bookingId))

  // 5. Full refund → Customer's Refund balance via refund_requests + wallet credit
  const [refundReq] = await db
    .insert(refundRequests)
    .values({
      bookingId: booking.id,
      // §5 — the refund is attributed to the acting human, not the shop.
      requestedByUserId: actingUserId,
      reason: 'vendor_cancelled',
      destination: 'refund_balance',
      state: 'credited',
      amount: grossRupees.toFixed(2),
      cancellationPresetSnapshot: booking.cancellationPresetSnapshot,
      policyWindowBasisSnapshot: 'vendor_cancelled',
      notes: trimmedReason,
      resolvedAt: sql`now()`,
    })
    .returning({ id: refundRequests.id })

  if (!refundReq) {
    throw new Error('refund_requests insert returned no row (unreachable)')
  }

  if (grossRupees > 0) {
    await creditRefundBalance(db, {
      userId: booking.customerUserId,
      amountRupees: grossRupees,
      refundRequestId: refundReq.id,
      bookingId: booking.id,
    })
  }

  // 6. Decrement Vendor SLA score (floor at 0)
  await db
    .update(vendorProfiles)
    .set({
      responseTimeSlaScore: sql`GREATEST(${vendorProfiles.responseTimeSlaScore}::numeric - ${VENDOR_CANCEL_SLA_PENALTY}::numeric, 0)`,
      updatedAt: sql`now()`,
    })
    .where(eq(vendorProfiles.userId, vendorUserId))

  // Read back the new SLA score for the result
  const [vendorRow] = await db
    .select({ slaScore: vendorProfiles.responseTimeSlaScore })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  const slaScoreAfter = vendorRow?.slaScore ?? '0.00'

  // 7. Audit log. Actor = the acting human (§5); the shop is in the payload.
  await writeAuditLog(db, {
    actorUserId: actingUserId,
    action: 'booking.vendor_cancel',
    entityType: 'booking',
    entityId: bookingId,
    payload: {
      bookingId,
      vendorUserId,
      actingUserId,
      previousState: booking.state,
      newState: 'cancelled_by_vendor',
      reason: trimmedReason,
      refundAmountRupees: grossRupees,
      refundRequestId: refundReq.id,
      slaPenalty: VENDOR_CANCEL_SLA_PENALTY,
      slaScoreAfter,
      cancellationPresetSnapshot: booking.cancellationPresetSnapshot,
      commissionRateSnapshot: booking.commissionRateSnapshot,
    },
  })

  return {
    bookingId,
    refundAmountRupees: grossRupees,
    refundRequestId: refundReq.id,
    slaScoreAfter,
  }
}

// ── Mark-no-show (ADR-0003 revision 2026-06-01) ─────────────────────

export interface MarkNoShowResult {
  bookingId: string
  noShowAt: Date
}

/**
 * Vendor attests a customer NO-SHOW after the slot has ended (ADR-0003
 * revision 2026-06-01). Terminal transition:
 *   confirmed | awaiting_completion → no_show
 *
 * Money treatment (per the ADR): the customer is at fault, so there is NO
 * refund (the Vendor retains the payment via reconciliation — NOT the
 * completion-gated payout countdown, which `no_show` never enters because it
 * sets no `completedAt`). The Vendor's SLA score is NOT penalised. Unlike a
 * Vendor cancellation, no `refund_requests` row and no wallet credit are
 * written.
 *
 * Guards: booking exists, belongs to the calling Vendor, is in a
 * no-show-markable state (`isNoShowMarkableState`), and its slot's `end_at`
 * has already passed (you cannot mark a no-show before the experience window
 * closes). Caller wraps in db.transaction(...) for atomicity.
 */
export async function executeMarkNoShow(
  db: DBOrTx,
  bookingId: string,
  vendorUserId: string,
  opts: { now?: Date } = {},
  // issue #11 §5 — the acting human (audit actor). Defaults to the shop owner
  // (single-seat back-compat); a member passes their own id.
  actingUserId: string = vendorUserId,
): Promise<MarkNoShowResult> {
  const now = opts.now ?? new Date()

  // 1. Fetch booking + lock
  const [booking] = await db
    .select({
      id: bookings.id,
      state: bookings.state,
      experienceId: bookings.experienceId,
      slotId: bookings.slotId,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for('update')
    .limit(1)

  if (!booking) {
    throw new VendorActionError('BOOKING_NOT_FOUND', `booking ${bookingId} not found`)
  }

  // 2. Verify the Vendor owns the Experience this Booking is on
  const [experience] = await db
    .select({ vendorUserId: experiences.vendorUserId })
    .from(experiences)
    .where(eq(experiences.id, booking.experienceId))
    .limit(1)

  if (!experience || experience.vendorUserId !== vendorUserId) {
    throw new VendorActionError(
      'NOT_VENDOR_BOOKING',
      `vendor ${vendorUserId} does not own booking ${bookingId}`,
    )
  }

  // 3. State guard: confirmed or awaiting_completion
  if (!isNoShowMarkableState(booking.state)) {
    throw new VendorActionError(
      'INVALID_STATE',
      `booking ${bookingId} is in state ${booking.state}; only confirmed or awaiting_completion bookings can be marked no-show`,
    )
  }

  // 4. The experience window must have closed — you cannot attest a no-show
  //    before the slot ends.
  const [slot] = await db
    .select({ endAt: availabilitySlots.endAt })
    .from(availabilitySlots)
    .where(eq(availabilitySlots.id, booking.slotId))
    .limit(1)

  if (!slot) {
    throw new VendorActionError('BOOKING_NOT_FOUND', `slot for booking ${bookingId} not found`)
  }
  if (slot.endAt.getTime() > now.getTime()) {
    throw new VendorActionError(
      'SLOT_NOT_ENDED',
      `booking ${bookingId} slot has not ended yet; a no-show can only be marked after the experience window closes`,
    )
  }

  const previousState = booking.state

  // 5. Terminal transition → no_show. No completedAt (excludes payout), no
  //    refund, no SLA penalty.
  await db
    .update(bookings)
    .set({ state: 'no_show', updatedAt: sql`now()` })
    .where(eq(bookings.id, bookingId))

  // 6. Audit log. Actor = the acting human (§5); the shop is in the payload.
  await writeAuditLog(db, {
    actorUserId: actingUserId,
    action: 'booking.mark_no_show',
    entityType: 'booking',
    entityId: bookingId,
    payload: {
      bookingId,
      vendorUserId,
      actingUserId,
      previousState,
      newState: 'no_show',
      noShowAt: now.toISOString(),
      customerRefunded: false,
    },
  })

  return { bookingId, noShowAt: now }
}
