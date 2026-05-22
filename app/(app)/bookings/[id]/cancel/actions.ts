'use server'

import { headers } from 'next/headers'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { processRefund, RefundFlowError } from '@/lib/payments/refund-flow'

/**
 * Customer-initiated cancellation Server Action wired to `processRefund`
 * (Task 14). The action:
 *
 *  1. Resolves the authenticated User from the request cookies via
 *     better-auth's session API.
 *  2. Opens a single db.transaction so the booking-state flip, the
 *     refund_requests row, the wallet credit, and the audit row commit
 *     atomically — or roll back atomically on any failure.
 *  3. Returns a discriminated `{ ok: true, ... } | { ok: false, error,
 *     message }` so React forms can render error states without
 *     try/catch wrapping every call site.
 *
 * The action itself is a thin wrapper over `executeCancelBooking` — the
 * pure-function entry point that the test suite exercises directly with
 * a PGlite handle. Keeping the auth and tx-opening concerns out of the
 * pure function means the test does not need to mock Next.js's
 * `headers()` or better-auth's session machinery.
 */

export type CancelBookingResult =
  | {
      ok: true
      bookingId: string
      refundAmountRupees: number
      cancellationFeeRupees: number
      basis: string
      bookingState: 'cancelled_by_customer' | 'cancelled_by_vendor' | 'disputed'
      routedToDispute: boolean
      refundRequestId: string | null
    }
  | {
      ok: false
      error: 'unauthenticated' | 'unauthorized' | 'not_cancellable' | 'not_found' | 'unknown'
      message: string
    }

export interface ExecuteCancelBookingArgs {
  bookingId: string
  actorUserId: string
}

/**
 * Pure-function entry point — opens its own transaction, delegates to
 * processRefund, and maps RefundFlowError codes to the action's result
 * envelope. Exported for direct testing with PGlite.
 */
export async function executeCancelBooking(
  database: DBOrTx,
  args: ExecuteCancelBookingArgs,
): Promise<CancelBookingResult> {
  try {
    const result = await database.transaction(async (tx) =>
      processRefund(tx, {
        bookingId: args.bookingId,
        actorUserId: args.actorUserId,
      }),
    )
    return {
      ok: true,
      bookingId: args.bookingId,
      refundAmountRupees: result.refundAmountRupees,
      cancellationFeeRupees: result.cancellationFeeRupees,
      basis: result.basis,
      bookingState: result.bookingState,
      routedToDispute: result.routedToDispute,
      refundRequestId: result.refundRequestId,
    }
  } catch (err) {
    // User-facing messages MUST NOT leak internal IDs or booking state.
    // The library's RefundFlowError carries verbose context that helps
    // server-side logs (Sentry will capture err.message + stack); the
    // response body to the React client gets a sanitised string keyed
    // off the `error` discriminant.
    if (err instanceof RefundFlowError) {
      if (err.code === 'BOOKING_NOT_FOUND') {
        return { ok: false, error: 'not_found', message: 'Booking not found.' }
      }
      if (err.code === 'UNAUTHORIZED') {
        return {
          ok: false,
          error: 'unauthorized',
          message: 'You are not authorised to cancel this booking.',
        }
      }
      if (err.code === 'BOOKING_NOT_CANCELLABLE') {
        return {
          ok: false,
          error: 'not_cancellable',
          message: 'This booking is no longer cancellable.',
        }
      }
      return {
        ok: false,
        error: 'unknown',
        message: 'An unexpected error occurred.',
      }
    }
    return {
      ok: false,
      error: 'unknown',
      message: 'An unexpected error occurred.',
    }
  }
}

/**
 * Server Action. Bound to the cancel button in the booking detail page.
 * Reads the session from request cookies, then defers to
 * `executeCancelBooking` with the top-level db handle. The action stays
 * authenticated-only — anonymous calls return `unauthenticated` without
 * touching the database.
 */
export async function cancelBookingAction(bookingId: string): Promise<CancelBookingResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return {
      ok: false,
      error: 'unauthenticated',
      message: 'sign in to cancel this booking',
    }
  }

  return executeCancelBooking(db, {
    bookingId,
    actorUserId: session.user.id,
  })
}
