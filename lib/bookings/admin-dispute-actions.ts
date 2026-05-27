import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { bookings } from '@/db/schema/bookings'
import { refundRequests } from '@/db/schema/refund-requests'
import { writeAuditLog } from '@/lib/audit/write'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { creditRefundBalance } from '@/lib/payments/wallet'

/**
 * Admin dispute resolution per ADR-0003 (Booking Completion State Machine).
 *
 * Two resolution paths for disputed Bookings:
 *
 *   A. disputed → completed  (Vendor's favour; optional partial refund +
 *      commission adjustment recorded in audit; payout countdown resumes)
 *
 *   B. disputed → cancelled_post_experience  (Customer wins; full refund,
 *      no payout)
 *
 * Both require mandatory admin notes for audit trail.
 *
 * NOTE: Booking snapshot columns are immutable (enforced by DB trigger
 * per ADRs 0008/0011/0016). Commission adjustments are recorded in the
 * audit log and refund_requests — they do NOT mutate the original
 * commission_rate_snapshot. The partial refund amount achieves the same
 * financial effect; the audit trail documents the adjusted rate for
 * downstream payout reconciliation.
 *
 * All functions accept a `DBOrTx` so they are testable with PGlite.
 * Caller must wrap in db.transaction(...) for atomicity.
 */

// ── Error types ─────────────────────────────────────────────────────

export type DisputeActionErrorCode =
  | 'BOOKING_NOT_FOUND'
  | 'INVALID_STATE'
  | 'NOTES_REQUIRED'
  | 'REFUND_EXCEEDS_GROSS'
  | 'VALIDATION_FAILED'

export class DisputeActionError extends Error {
  constructor(
    public code: DisputeActionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DisputeActionError'
  }
}

// ── Result type ─────────────────────────────────────────────────────

export type DisputeActionResult =
  | { ok: true }
  | { ok: false; error: string }

// ── Validation schemas ──────────────────────────────────────────────

const resolveAsCompletedSchema = z.object({
  adminUserId: z.string().min(1),
  bookingId: z.string().uuid('Booking ID must be a valid UUID.'),
  notes: z
    .string()
    .trim()
    .min(1, 'Admin notes are required for dispute resolution.'),
  partialRefundRupees: z
    .number()
    .int('Refund amount must be a whole number (rupee precision).')
    .nonnegative('Refund amount must be non-negative.')
    .optional(),
  adjustedCommissionRate: z
    .string()
    .regex(/^\d{1,3}\.\d{2}$/, 'Commission rate must be in format XX.XX')
    .optional(),
})

const resolveAsCancelledSchema = z.object({
  adminUserId: z.string().min(1),
  bookingId: z.string().uuid('Booking ID must be a valid UUID.'),
  notes: z
    .string()
    .trim()
    .min(1, 'Admin notes are required for dispute resolution.'),
})

// ── Resolution A: disputed → completed ──────────────────────────────

export interface ResolveAsCompletedInput {
  adminUserId: string
  bookingId: string
  notes: string
  /** Optional partial refund in integer rupees. */
  partialRefundRupees?: number
  /**
   * Optional adjusted commission rate as numeric(5,2) string e.g. '10.00'.
   * Recorded in the audit log only — snapshot columns are immutable per
   * ADRs 0008/0011/0016. The payout system uses the audit trail to
   * apply the adjustment at disbursement time.
   */
  adjustedCommissionRate?: string
}

/**
 * Resolve a disputed Booking as completed (Vendor's favour).
 *
 * Per ADR-0003:
 *   disputed → completed
 *
 * Optional adjustments:
 *   - Partial refund credited to Customer's Refund balance
 *   - Commission rate adjustment (recorded in audit; snapshots immutable)
 *
 * Payout state transitions from 'held' → 'pending' so the payout
 * countdown resumes.
 */
export async function executeResolveAsCompleted(
  db: DBOrTx,
  input: ResolveAsCompletedInput,
): Promise<DisputeActionResult> {
  const parsed = resolveAsCompletedSchema.safeParse(input)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    const errorMsg = firstIssue?.message ?? 'Validation failed.'
    if (errorMsg.includes('notes') || errorMsg.includes('Admin notes')) {
      return { ok: false, error: 'Admin notes are required for dispute resolution.' }
    }
    return { ok: false, error: errorMsg }
  }

  const { adminUserId, bookingId, notes, partialRefundRupees, adjustedCommissionRate } =
    parsed.data

  // 1. Fetch booking + lock
  const [booking] = await db
    .select({
      id: bookings.id,
      state: bookings.state,
      customerUserId: bookings.customerUserId,
      grossTotalSnapshot: bookings.grossTotalSnapshot,
      commissionRateSnapshot: bookings.commissionRateSnapshot,
      commissionBasisSnapshot: bookings.commissionBasisSnapshot,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for('update')
    .limit(1)

  if (!booking) {
    return { ok: false, error: `Booking ${bookingId} not found.` }
  }

  // 2. State guard: only disputed bookings
  if (booking.state !== 'disputed') {
    return {
      ok: false,
      error: `Booking ${bookingId} is in state '${booking.state}'; only disputed bookings can be resolved.`,
    }
  }

  // 3. Validate partial refund does not exceed gross total
  const grossRupees = Math.floor(Number(booking.grossTotalSnapshot))
  if (partialRefundRupees !== undefined && partialRefundRupees > grossRupees) {
    return {
      ok: false,
      error: `Partial refund (₹${partialRefundRupees}) exceeds gross total (₹${grossRupees}).`,
    }
  }

  const now = new Date()

  // 4. Transition state: disputed → completed + resume payout
  //    NOTE: snapshot columns are NOT modified (DB trigger prevents it)
  await db
    .update(bookings)
    .set({
      state: 'completed',
      completedAt: now,
      payoutState: 'pending',
      updatedAt: sql`now()`,
    })
    .where(eq(bookings.id, bookingId))

  // 5. Optional: partial refund
  let refundRequestId: string | null = null
  if (partialRefundRupees !== undefined && partialRefundRupees > 0) {
    const [refundReq] = await db
      .insert(refundRequests)
      .values({
        bookingId: booking.id,
        requestedByUserId: adminUserId,
        reason: 'outside_policy_dispute_resolved',
        destination: 'refund_balance',
        state: 'credited',
        amount: partialRefundRupees.toFixed(2),
        cancellationPresetSnapshot: 'custom',
        policyWindowBasisSnapshot: 'admin_override',
        notes,
        resolvedAt: sql`now()`,
      })
      .returning({ id: refundRequests.id })

    refundRequestId = refundReq!.id

    await creditRefundBalance(db, {
      userId: booking.customerUserId,
      amountRupees: partialRefundRupees,
      refundRequestId: refundReq!.id,
      bookingId: booking.id,
    })
  }

  // 6. Audit log — records the commission adjustment (immutable snapshots
  //    are not modified; the audit trail is the source-of-truth for
  //    dispute-adjusted commission during payout reconciliation)
  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'booking.dispute_resolved_complete',
    entityType: 'booking',
    entityId: bookingId,
    payload: {
      bookingId,
      adminUserId,
      previousState: 'disputed',
      newState: 'completed',
      notes,
      completedAt: now.toISOString(),
      partialRefundRupees: partialRefundRupees ?? null,
      refundRequestId,
      adjustedCommissionRate: adjustedCommissionRate ?? null,
      originalCommissionRate: booking.commissionRateSnapshot,
      payoutStateChange: 'held → pending',
    },
  })

  return { ok: true }
}

// ── Resolution B: disputed → cancelled_post_experience ──────────────

export interface ResolveAsCancelledInput {
  adminUserId: string
  bookingId: string
  notes: string
}

/**
 * Resolve a disputed Booking as cancelled post-experience (Customer wins).
 *
 * Per ADR-0003:
 *   disputed → cancelled_post_experience
 *
 * Effects:
 *   - Full refund to Customer's Refund balance
 *   - Payout state → rejected (no Vendor payout)
 *   - Commission effectively zero (full refund + no payout = no platform revenue)
 *
 * NOTE: snapshot columns are immutable (DB trigger). The commission is
 * effectively zero because the entire gross is refunded and no payout
 * is disbursed. The audit log documents this for reconciliation.
 */
export async function executeResolveAsCancelledPostExperience(
  db: DBOrTx,
  input: ResolveAsCancelledInput,
): Promise<DisputeActionResult> {
  const parsed = resolveAsCancelledSchema.safeParse(input)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    const errorMsg = firstIssue?.message ?? 'Validation failed.'
    if (errorMsg.includes('notes') || errorMsg.includes('Admin notes')) {
      return { ok: false, error: 'Admin notes are required for dispute resolution.' }
    }
    return { ok: false, error: errorMsg }
  }

  const { adminUserId, bookingId, notes } = parsed.data

  // 1. Fetch booking + lock
  const [booking] = await db
    .select({
      id: bookings.id,
      state: bookings.state,
      customerUserId: bookings.customerUserId,
      grossTotalSnapshot: bookings.grossTotalSnapshot,
      commissionRateSnapshot: bookings.commissionRateSnapshot,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for('update')
    .limit(1)

  if (!booking) {
    return { ok: false, error: `Booking ${bookingId} not found.` }
  }

  // 2. State guard: only disputed bookings
  if (booking.state !== 'disputed') {
    return {
      ok: false,
      error: `Booking ${bookingId} is in state '${booking.state}'; only disputed bookings can be resolved.`,
    }
  }

  const grossRupees = Math.floor(Number(booking.grossTotalSnapshot))
  const now = new Date()

  // 3. Transition state: disputed → cancelled_post_experience
  //    Reject payout (no Vendor disbursement). Snapshot columns left intact.
  await db
    .update(bookings)
    .set({
      state: 'cancelled_post_experience',
      cancelledAt: now,
      cancellationReason: notes,
      payoutState: 'rejected',
      payoutRejectionReason: `Dispute resolved: cancelled post-experience. ${notes}`,
      updatedAt: sql`now()`,
    })
    .where(eq(bookings.id, bookingId))

  // 4. Full refund to Customer's Refund balance
  let refundRequestId: string | null = null
  if (grossRupees > 0) {
    const [refundReq] = await db
      .insert(refundRequests)
      .values({
        bookingId: booking.id,
        requestedByUserId: adminUserId,
        reason: 'outside_policy_dispute_resolved',
        destination: 'refund_balance',
        state: 'credited',
        amount: grossRupees.toFixed(2),
        cancellationPresetSnapshot: 'custom',
        policyWindowBasisSnapshot: 'admin_override',
        notes,
        resolvedAt: sql`now()`,
      })
      .returning({ id: refundRequests.id })

    refundRequestId = refundReq!.id

    await creditRefundBalance(db, {
      userId: booking.customerUserId,
      amountRupees: grossRupees,
      refundRequestId: refundReq!.id,
      bookingId: booking.id,
    })
  }

  // 5. Audit log
  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'booking.dispute_resolved_cancel',
    entityType: 'booking',
    entityId: bookingId,
    payload: {
      bookingId,
      adminUserId,
      previousState: 'disputed',
      newState: 'cancelled_post_experience',
      notes,
      cancelledAt: now.toISOString(),
      refundAmountRupees: grossRupees,
      refundRequestId,
      originalCommissionRate: booking.commissionRateSnapshot,
      commissionEffectivelyZero: true,
      payoutStateChange: 'held → rejected',
    },
  })

  return { ok: true }
}
