import { eq, sql } from 'drizzle-orm'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { refundRequests } from '@/db/schema/refund-requests'
import { writeAuditLog } from '@/lib/audit/write'

import type { DBOrTx } from './commission-resolver'
import {
  type CancellationPreset,
  type PolicyWindowBasis,
  quoteRefund,
  type RefundQuote,
} from './refund-policy'
import { creditRefundBalance } from './wallet'

/**
 * Refund flow per ADRs 0003 / 0004 / 0005.
 *
 * Single entry point `processRefund` orchestrates a Customer or
 * Vendor cancellation:
 *
 *  1. Look up + lock the Booking row (FOR UPDATE).
 *  2. Guard: only `confirmed` Bookings can transition through here; an
 *     already-cancelled or completed Booking is a no-op error.
 *  3. Look up the slot for `startAt`.
 *  4. Compute the refund quote (pure function over the snapshotted
 *     cancellation preset + the slot's startAt + now). The snapshot rule
 *     is what makes this safe — `experiences.cancellation_preset` may
 *     have changed since the Booking was created and we MUST honour the
 *     deal the Customer signed up for.
 *  5. Branch:
 *      - free_window / 50%_window / vendor_cancelled →
 *           INSERT refund_requests (state=credited) +
 *           creditRefundBalance(...) +
 *           UPDATE bookings.state = cancelled_by_(customer|vendor) +
 *           writeAuditLog('booking.cancel', { … commission adjustment … })
 *      - no_refund_window →
 *           INSERT refund_requests (state=rejected, amount=0) +
 *           UPDATE bookings.state = cancelled_by_customer +
 *           writeAuditLog('booking.cancel', …)
 *      - outside_policy →
 *           UPDATE bookings.state = disputed +
 *           writeAuditLog('dispute.opened', …)
 *           (no refund_requests row; the admin resolution path creates
 *            it later with reason=outside_policy_dispute_resolved)
 *
 * The whole thing runs in the caller's transaction (DBOrTx). The Server
 * Action at app/(app)/bookings/[id]/cancel/actions.ts wraps in
 * db.transaction(...) so the booking-state flip, the refund_requests
 * row, the wallet credit, and the audit row commit atomically — or roll
 * back atomically if any step fails.
 *
 * Commission reversal: M2 records the cancellation-fee + adjusted
 * commission in the audit payload only. The M3 Payout module reads
 * audit_logs to compute net Vendor revenue at the next batch run.
 * Money does not move in this function beyond the refund credit;
 * commission is realised at Booking Completion, not at create or
 * cancellation (CONTEXT.md).
 */

export type RefundFlowErrorCode =
  | 'BOOKING_NOT_FOUND'
  | 'BOOKING_NOT_CANCELLABLE'
  | 'SLOT_NOT_FOUND'
  | 'UNAUTHORIZED'

export class RefundFlowError extends Error {
  constructor(
    public code: RefundFlowErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'RefundFlowError'
  }
}

export interface ProcessRefundArgs {
  bookingId: string
  /** Defaults to new Date(). Override for tests that need a specific cancellation moment. */
  cancellationAt?: Date
  vendorCancelled?: boolean
  /** The User initiating the cancellation. Customer for self-cancel, Vendor for vendor-cancel. */
  actorUserId: string
  notes?: string
}

export interface ProcessRefundResult {
  /** Null when the Booking routed to Dispute (no refund_requests row). */
  refundRequestId: string | null
  refundAmountRupees: number
  cancellationFeeRupees: number
  basis: PolicyWindowBasis
  bookingState:
    | 'cancelled_by_customer'
    | 'cancelled_by_vendor'
    | 'disputed'
  routedToDispute: boolean
}

const CANCELLABLE_STATES = new Set(['confirmed'])

export async function processRefund(
  db: DBOrTx,
  args: ProcessRefundArgs,
): Promise<ProcessRefundResult> {
  const cancellationAt = args.cancellationAt ?? new Date()
  const vendorCancelled = args.vendorCancelled ?? false

  // 1. Lock the Booking row.
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, args.bookingId))
    .for('update')
    .limit(1)
  if (!booking) {
    throw new RefundFlowError('BOOKING_NOT_FOUND', `booking ${args.bookingId} not found`)
  }

  // 2. State guard — only `confirmed` Bookings can be cancelled here.
  if (!CANCELLABLE_STATES.has(booking.state)) {
    throw new RefundFlowError(
      'BOOKING_NOT_CANCELLABLE',
      `booking ${args.bookingId} is in state ${booking.state}; only confirmed bookings can be cancelled`,
    )
  }

  // 2a. Ownership guard (defense-in-depth — the Server Action layer also
  // enforces this, but the library defends against any caller that omits
  // the check). For customer-initiated cancellations the actor must be
  // the booking's customer; for vendor-cancelled bookings the actor must
  // be the Experience's vendor. Admin-driven cancellations are handled
  // in M3 with a separate `processRefundAsAdmin` entry point that takes
  // an admin-verified flag.
  if (vendorCancelled) {
    const [exp] = await db
      .select({ vendorUserId: experiences.vendorUserId })
      .from(experiences)
      .where(eq(experiences.id, booking.experienceId))
      .limit(1)
    if (!exp || exp.vendorUserId !== args.actorUserId) {
      throw new RefundFlowError(
        'UNAUTHORIZED',
        `actor ${args.actorUserId} is not the vendor of booking ${args.bookingId}`,
      )
    }
  } else if (booking.customerUserId !== args.actorUserId) {
    throw new RefundFlowError(
      'UNAUTHORIZED',
      `actor ${args.actorUserId} is not the customer of booking ${args.bookingId}`,
    )
  }

  // 3. Look up the slot for startAt.
  const [slot] = await db
    .select({ startAt: availabilitySlots.startAt })
    .from(availabilitySlots)
    .where(eq(availabilitySlots.id, booking.slotId))
    .limit(1)
  if (!slot) {
    throw new RefundFlowError('SLOT_NOT_FOUND', `slot ${booking.slotId} not found`)
  }

  // 4. Quote refund. The booking's snapshotted preset is the source of
  // truth, not the live experience.cancellation_preset.
  const grossRupees = Math.floor(Number(booking.grossTotalSnapshot))
  const preset = booking.cancellationPresetSnapshot as CancellationPreset
  const quote: RefundQuote = quoteRefund({
    preset,
    startAt: slot.startAt,
    cancellationAt,
    bookingTotalRupees: grossRupees,
    vendorCancelled,
  })

  const commissionRate = Number(booking.commissionRateSnapshot) / 100
  const adjustedCommissionOnFeeRupees = Math.floor(
    quote.cancellationFeeRupees * commissionRate,
  )

  // 5. Branch on the policy basis.
  if (quote.basis === 'outside_policy') {
    return handleOutsidePolicy({
      db,
      booking,
      quote,
      args,
      cancellationAt,
      adjustedCommissionOnFeeRupees,
    })
  }

  return handleInsidePolicy({
    db,
    booking,
    quote,
    args,
    cancellationAt,
    vendorCancelled,
    adjustedCommissionOnFeeRupees,
  })
}

interface BranchArgs {
  db: DBOrTx
  booking: typeof bookings.$inferSelect
  quote: RefundQuote
  args: ProcessRefundArgs
  cancellationAt: Date
  adjustedCommissionOnFeeRupees: number
}

interface InsideBranchArgs extends BranchArgs {
  vendorCancelled: boolean
}

async function handleInsidePolicy(
  branch: InsideBranchArgs,
): Promise<ProcessRefundResult> {
  const { db, booking, quote, args, cancellationAt, vendorCancelled, adjustedCommissionOnFeeRupees } = branch

  const reason =
    quote.basis === 'vendor_cancelled' ? 'vendor_cancelled' : 'inside_policy_cancellation'
  const refundState = quote.refundAmountRupees > 0 ? 'credited' : 'rejected'
  const targetBookingState = vendorCancelled
    ? 'cancelled_by_vendor'
    : 'cancelled_by_customer'

  // INSERT the refund_requests row first so creditRefundBalance can
  // reference its id in the audit row it writes. The partial unique
  // `one_active_refund_per_booking` blocks a second concurrent cancel
  // on the same booking inserting another non-rejected row.
  const [reqRow] = await db
    .insert(refundRequests)
    .values({
      bookingId: booking.id,
      requestedByUserId: args.actorUserId,
      reason,
      destination: 'refund_balance',
      state: refundState,
      amount: quote.refundAmountRupees.toFixed(2),
      cancellationPresetSnapshot: booking.cancellationPresetSnapshot,
      policyWindowBasisSnapshot: quote.basis,
      notes: args.notes ?? null,
      resolvedAt: sql`now()`,
    })
    .returning({ id: refundRequests.id })

  if (!reqRow) {
    throw new Error('refund_requests insert returned no row (unreachable)')
  }

  if (quote.refundAmountRupees > 0) {
    await creditRefundBalance(db, {
      userId: booking.customerUserId,
      amountRupees: quote.refundAmountRupees,
      refundRequestId: reqRow.id,
      bookingId: booking.id,
    })
  }

  await db
    .update(bookings)
    .set({ state: targetBookingState, updatedAt: sql`now()` })
    .where(eq(bookings.id, booking.id))

  await writeAuditLog(db, {
    actorUserId: args.actorUserId,
    action: 'booking.cancel',
    entityType: 'booking',
    entityId: booking.id,
    payload: {
      bookingId: booking.id,
      basis: quote.basis,
      refundAmountRupees: quote.refundAmountRupees,
      cancellationFeeRupees: quote.cancellationFeeRupees,
      cancellationPresetSnapshot: booking.cancellationPresetSnapshot,
      commissionRateSnapshot: booking.commissionRateSnapshot,
      adjustedCommissionOnFeeRupees,
      vendorCancelled,
      cancellationAt: cancellationAt.toISOString(),
      refundRequestId: reqRow.id,
      targetBookingState,
    },
  })

  return {
    refundRequestId: reqRow.id,
    refundAmountRupees: quote.refundAmountRupees,
    cancellationFeeRupees: quote.cancellationFeeRupees,
    basis: quote.basis,
    bookingState: targetBookingState,
    routedToDispute: false,
  }
}

async function handleOutsidePolicy(branch: BranchArgs): Promise<ProcessRefundResult> {
  const { db, booking, quote, args, cancellationAt, adjustedCommissionOnFeeRupees } = branch

  await db
    .update(bookings)
    .set({ state: 'disputed', updatedAt: sql`now()` })
    .where(eq(bookings.id, booking.id))

  await writeAuditLog(db, {
    actorUserId: args.actorUserId,
    action: 'dispute.opened',
    entityType: 'booking',
    entityId: booking.id,
    payload: {
      bookingId: booking.id,
      basis: quote.basis,
      reason: 'outside_policy_cancellation',
      cancellationPresetSnapshot: booking.cancellationPresetSnapshot,
      cancellationFeeRupees: quote.cancellationFeeRupees,
      commissionRateSnapshot: booking.commissionRateSnapshot,
      // Provisional commission figure — the dispute outcome may zero the
      // fee out (Vendor at fault) or hold the full cancellation fee
      // (Customer at fault). M3 Payout MUST only realise commission from
      // the eventual `dispute.resolved` audit row, not this provisional
      // value, to avoid over-counting commission on disputed bookings.
      provisionalCommissionOnFeeRupees: adjustedCommissionOnFeeRupees,
      pendingAdminResolution: true,
      cancellationAt: cancellationAt.toISOString(),
      notes: args.notes ?? null,
    },
  })

  return {
    refundRequestId: null,
    refundAmountRupees: 0,
    cancellationFeeRupees: quote.cancellationFeeRupees,
    basis: quote.basis,
    bookingState: 'disputed',
    routedToDispute: true,
  }
}
