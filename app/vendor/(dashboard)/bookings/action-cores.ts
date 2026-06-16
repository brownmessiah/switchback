import { z } from 'zod'

import {
  executeMarkComplete,
  executeMarkNoShow,
  executeVendorCancel,
  VendorActionError,
} from '@/lib/bookings/vendor-actions'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Vendor booking-action CORES (issue #03 security split).
 *
 * These db-injected functions are deliberately NOT in the `'use server'`
 * module. Every exported async function from a `'use server'` file is a
 * client-callable Server Action reachable via a direct POST — exporting a core
 * that takes an arbitrary `vendorUserId` would be an IDOR hole. The thin
 * Server Action wrapper in ./actions derives identity from the session and
 * gates with `hasVendorAccess` before delegating here.
 */

// ── Result types ────────────────────────────────────────────────────

export type MarkCompleteResult =
  | { ok: true; bookingId: string }
  | { ok: false; error: string }

export type VendorCancelResult =
  | { ok: true; bookingId: string; refundAmountRupees: number }
  | { ok: false; error: string }

export type MarkNoShowResult =
  | { ok: true; bookingId: string }
  | { ok: false; error: string }

// ── Validation ──────────────────────────────────────────────────────

const markCompleteSchema = z.object({
  bookingId: z.string().uuid('Invalid booking ID.'),
})

const markNoShowSchema = z.object({
  bookingId: z.string().uuid('Invalid booking ID.'),
})

const vendorCancelSchema = z.object({
  bookingId: z.string().uuid('Invalid booking ID.'),
  reason: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'Cancellation reason is required.')),
})

// ── Cores (auth-free, db-injected, integration-testable) ────────────

export async function executeMarkCompleteAction(
  database: DBOrTx,
  vendorUserId: string,
  input: { bookingId: string },
  // issue #11 §5 — the acting human (audit actor). Defaults to the shop
  // (single-seat back-compat); the Server Action wrapper passes the member.
  actingUserId: string = vendorUserId,
): Promise<MarkCompleteResult> {
  const parsed = markCompleteSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  try {
    const result = await database.transaction(async (tx) =>
      executeMarkComplete(tx, parsed.data.bookingId, vendorUserId, actingUserId),
    )
    return { ok: true, bookingId: result.bookingId }
  } catch (err) {
    if (err instanceof VendorActionError) {
      return { ok: false, error: mapVendorActionError(err) }
    }
    return { ok: false, error: 'An unexpected error occurred.' }
  }
}

export async function executeVendorCancelAction(
  database: DBOrTx,
  vendorUserId: string,
  input: { bookingId: string; reason: string },
  // issue #11 §5 — the acting human (audit actor + refund requestedByUserId).
  actingUserId: string = vendorUserId,
): Promise<VendorCancelResult> {
  const parsed = vendorCancelSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  try {
    const result = await database.transaction(async (tx) =>
      executeVendorCancel(
        tx,
        parsed.data.bookingId,
        vendorUserId,
        parsed.data.reason,
        actingUserId,
      ),
    )
    return {
      ok: true,
      bookingId: result.bookingId,
      refundAmountRupees: result.refundAmountRupees,
    }
  } catch (err) {
    if (err instanceof VendorActionError) {
      return { ok: false, error: mapVendorActionError(err) }
    }
    return { ok: false, error: 'An unexpected error occurred.' }
  }
}

export async function executeMarkNoShowAction(
  database: DBOrTx,
  vendorUserId: string,
  input: { bookingId: string },
  // issue #11 §5 — the acting human (audit actor).
  actingUserId: string = vendorUserId,
): Promise<MarkNoShowResult> {
  const parsed = markNoShowSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  try {
    const result = await database.transaction(async (tx) =>
      executeMarkNoShow(tx, parsed.data.bookingId, vendorUserId, {}, actingUserId),
    )
    return { ok: true, bookingId: result.bookingId }
  } catch (err) {
    if (err instanceof VendorActionError) {
      return { ok: false, error: mapVendorActionError(err) }
    }
    return { ok: false, error: 'An unexpected error occurred.' }
  }
}

// ── Error mapping (sanitised for the client) ────────────────────────

function mapVendorActionError(err: VendorActionError): string {
  switch (err.code) {
    case 'BOOKING_NOT_FOUND':
      return 'Booking not found.'
    case 'NOT_VENDOR_BOOKING':
      return 'You are not authorised to manage this booking.'
    case 'INVALID_STATE':
      return 'This booking cannot be updated in its current state.'
    case 'REASON_REQUIRED':
      return 'A cancellation reason is required.'
    case 'SLOT_NOT_ENDED':
      return 'A no-show can only be marked after the experience has ended.'
    default:
      return 'An unexpected error occurred.'
  }
}
