'use server'

import { eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { auth } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit/write'
import {
  notifyPayoutStateChange,
  safeNotify,
  type PayoutNotifyState,
} from '@/lib/notifications/booking-events'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Result types ────────────────────────────────────────────────────

export type PayoutActionResult =
  | { ok: true }
  | { ok: false; error: string }

// ── Valid transitions ───────────────────────────────────────────────

/**
 * Payout state transitions per ADR-0016:
 *   - approve: pending | held → approved
 *   - hold:    pending → held
 *   - reject:  pending | held → rejected
 */
const APPROVE_FROM = ['pending', 'held'] as const
const HOLD_FROM = ['pending'] as const
const REJECT_FROM = ['pending', 'held'] as const

// ── Validation schemas ─────────────────────────────────────────────

const bookingIdSchema = z.object({
  bookingId: z.string().uuid('Booking ID must be a valid UUID.'),
})

const rejectSchema = z.object({
  bookingId: z.string().uuid('Booking ID must be a valid UUID.'),
  reason: z
    .string()
    .trim()
    .min(1, 'Reason is required for rejection.')
    .max(2000),
})

const holdSchema = z.object({
  bookingId: z.string().uuid('Booking ID must be a valid UUID.'),
  reason: z
    .string()
    .trim()
    .min(1, 'Reason is required for hold.')
    .max(2000),
})

// ── Internal helper: resolve vendor for a booking ──────────────────

async function resolveVendorForBooking(
  db: DBOrTx,
  bookingId: string,
): Promise<{
  vendorUserId: string
  manualPayoutsRemaining: number
} | null> {
  const [row] = await db
    .select({
      vendorUserId: experiences.vendorUserId,
      manualPayoutsRemaining: vendorProfiles.manualPayoutsRemaining,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .where(eq(bookings.id, bookingId))
    .limit(1)

  return row ?? null
}

// ── Fire-and-forget vendor payout notification (post-commit) ───────
//
// Runs AFTER the payout state transition + audit row have committed.
// Wrapped in safeNotify so a notification failure can never fail the
// payout state change. The payout-core (state transition,
// manualPayoutsRemaining decrement, audit) is untouched. An optional
// already-resolved vendorUserId avoids a second lookup when the caller
// already has it.
async function notifyVendorPayout(
  db: DBOrTx,
  args: {
    bookingId: string
    state: PayoutNotifyState
    vendorUserId?: string
  },
): Promise<void> {
  await safeNotify(`payout_${args.state}`, async () => {
    const vendorUserId =
      args.vendorUserId ??
      (await resolveVendorForBooking(db, args.bookingId))?.vendorUserId
    if (!vendorUserId) return
    await notifyPayoutStateChange(db, {
      bookingId: args.bookingId,
      vendorUserId,
      state: args.state,
    })
  })
}

// ── Core testable functions ────────────────────────────────────────

export async function executeApprovePayout(
  db: DBOrTx,
  adminUserId: string,
  input: { bookingId: string },
): Promise<PayoutActionResult> {
  const parsed = bookingIdSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { bookingId } = parsed.data

  const [booking] = await db
    .select({
      state: bookings.state,
      payoutState: bookings.payoutState,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1)

  if (!booking) {
    return { ok: false, error: 'Booking not found.' }
  }

  if (booking.state !== 'completed') {
    return {
      ok: false,
      error: `Cannot approve payout: booking must be completed (current: ${booking.state}).`,
    }
  }

  if (!(APPROVE_FROM as readonly string[]).includes(booking.payoutState)) {
    return {
      ok: false,
      error: `Cannot approve payout: payout state must be pending or held (current: ${booking.payoutState}).`,
    }
  }

  // Resolve vendor for manualPayoutsRemaining decrement
  const vendor = await resolveVendorForBooking(db, bookingId)
  const manualBefore = vendor?.manualPayoutsRemaining ?? 0
  const shouldDecrement = manualBefore > 0

  // Update payout state
  await db
    .update(bookings)
    .set({ payoutState: 'approved', updatedAt: new Date() })
    .where(eq(bookings.id, bookingId))

  // Decrement manualPayoutsRemaining if applicable
  if (shouldDecrement && vendor) {
    await db
      .update(vendorProfiles)
      .set({
        manualPayoutsRemaining: sql`${vendorProfiles.manualPayoutsRemaining} - 1`,
        updatedAt: new Date(),
      })
      .where(eq(vendorProfiles.userId, vendor.vendorUserId))
  }

  // Approval only transitions payout_state → 'approved' (and consumes one of
  // the first-3 manual approvals above). There is NO inline send here: the
  // Payout Batch cron (lib/payments/payout-batch.ts) picks up approved — and,
  // once manualPayoutsRemaining hits 0, pending — Payouts at the daily 5pm-IST
  // run and sends ONE Razorpay X transfer per (Vendor, destination). The cron
  // owns sending; this action owns the approval gate (ADR-0016).

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.payout.approve',
    entityType: 'booking',
    entityId: bookingId,
    payload: {
      previousPayoutState: booking.payoutState,
      newPayoutState: 'approved',
      manualPayoutsRemainingBefore: manualBefore,
      manualPayoutsRemainingAfter: shouldDecrement ? manualBefore - 1 : manualBefore,
    },
  })

  await notifyVendorPayout(db, {
    bookingId,
    state: 'approved',
    vendorUserId: vendor?.vendorUserId,
  })

  return { ok: true }
}

export async function executeHoldPayout(
  db: DBOrTx,
  adminUserId: string,
  input: { bookingId: string; reason: string },
): Promise<PayoutActionResult> {
  const parsed = holdSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { bookingId, reason } = parsed.data

  const [booking] = await db
    .select({
      state: bookings.state,
      payoutState: bookings.payoutState,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1)

  if (!booking) {
    return { ok: false, error: 'Booking not found.' }
  }

  if (booking.state !== 'completed') {
    return {
      ok: false,
      error: `Cannot hold payout: booking must be completed (current: ${booking.state}).`,
    }
  }

  if (!(HOLD_FROM as readonly string[]).includes(booking.payoutState)) {
    return {
      ok: false,
      error: `Cannot hold payout: payout state must be pending (current: ${booking.payoutState}).`,
    }
  }

  await db
    .update(bookings)
    .set({ payoutState: 'held', updatedAt: new Date() })
    .where(eq(bookings.id, bookingId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.payout.hold',
    entityType: 'booking',
    entityId: bookingId,
    payload: {
      previousPayoutState: booking.payoutState,
      newPayoutState: 'held',
      reason,
    },
  })

  await notifyVendorPayout(db, { bookingId, state: 'held' })

  return { ok: true }
}

export async function executeRejectPayout(
  db: DBOrTx,
  adminUserId: string,
  input: { bookingId: string; reason: string },
): Promise<PayoutActionResult> {
  const parsed = rejectSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { bookingId, reason } = parsed.data

  const [booking] = await db
    .select({
      state: bookings.state,
      payoutState: bookings.payoutState,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1)

  if (!booking) {
    return { ok: false, error: 'Booking not found.' }
  }

  if (booking.state !== 'completed') {
    return {
      ok: false,
      error: `Cannot reject payout: booking must be completed (current: ${booking.state}).`,
    }
  }

  if (!(REJECT_FROM as readonly string[]).includes(booking.payoutState)) {
    return {
      ok: false,
      error: `Cannot reject payout: payout state must be pending or held (current: ${booking.payoutState}).`,
    }
  }

  await db
    .update(bookings)
    .set({
      payoutState: 'rejected',
      payoutRejectionReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, bookingId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.payout.reject',
    entityType: 'booking',
    entityId: bookingId,
    payload: {
      previousPayoutState: booking.payoutState,
      newPayoutState: 'rejected',
      reason,
    },
  })

  await notifyVendorPayout(db, { bookingId, state: 'rejected' })

  return { ok: true }
}

// ── Server action wrappers (auth layer) ─────────────────────────────

export async function approvePayoutAction(
  bookingId: string,
): Promise<PayoutActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'payouts'))) {
    return { ok: false, error: 'You do not have permission to approve payouts.' }
  }

  const result = await executeApprovePayout(prodDb, session.user.id, {
    bookingId,
  })

  if (result.ok) revalidatePath('/admin/payouts')
  return result
}

export async function holdPayoutAction(
  bookingId: string,
  reason: string,
): Promise<PayoutActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'payouts'))) {
    return { ok: false, error: 'You do not have permission to hold payouts.' }
  }

  const result = await executeHoldPayout(prodDb, session.user.id, {
    bookingId,
    reason,
  })

  if (result.ok) revalidatePath('/admin/payouts')
  return result
}

export async function rejectPayoutAction(
  bookingId: string,
  reason: string,
): Promise<PayoutActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'payouts'))) {
    return { ok: false, error: 'You do not have permission to reject payouts.' }
  }

  const result = await executeRejectPayout(prodDb, session.user.id, {
    bookingId,
    reason,
  })

  if (result.ok) revalidatePath('/admin/payouts')
  return result
}
