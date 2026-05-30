'use server'

import { desc, eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { bookings } from '@/db/schema/bookings'
import { refundRequests } from '@/db/schema/refund-requests'
import { users } from '@/db/schema/users'
import { auth } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit/write'
import { creditRefundBalance } from '@/lib/payments/wallet'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Result types ────────────────────────────────────────────────────

export type RefundActionResult =
  | { ok: true }
  | { ok: false; error: string }

// ── Valid state transitions ─────────────────────────────────────────

/**
 * Refund state transitions:
 *   - approve: pending → approved → credited (in one tx)
 *   - reject:  pending → rejected
 *
 * Per ADR-0004/0005, only pending refund_requests can be acted on.
 * Approved + credited is a single-tx transition (wallet credit is
 * instant for refund_balance).
 */
const APPROVE_FROM = ['pending'] as const
const REJECT_FROM = ['pending'] as const

// ── Validation schemas ──────────────────────────────────────────────

const approveSchema = z.object({
  refundRequestId: z.string().uuid('Refund request ID must be a valid UUID.'),
  amount: z
    .number()
    .int('Amount must be a whole number (rupee precision).')
    .positive('Amount must be positive.'),
})

const rejectSchema = z.object({
  refundRequestId: z.string().uuid('Refund request ID must be a valid UUID.'),
  reason: z
    .string()
    .trim()
    .min(1, 'Reason is required for rejection.')
    .max(2000),
})

// ── Core testable: approve refund ───────────────────────────────────

export async function executeApproveRefund(
  db: DBOrTx,
  adminUserId: string,
  input: { refundRequestId: string; amount: number },
): Promise<RefundActionResult> {
  const parsed = approveSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { refundRequestId, amount } = parsed.data

  // Fetch the refund request with booking info for wallet credit
  const [refundReq] = await db
    .select({
      id: refundRequests.id,
      state: refundRequests.state,
      amount: refundRequests.amount,
      bookingId: refundRequests.bookingId,
      requestedByUserId: refundRequests.requestedByUserId,
    })
    .from(refundRequests)
    .where(eq(refundRequests.id, refundRequestId))
    .limit(1)

  if (!refundReq) {
    return { ok: false, error: 'Refund request not found.' }
  }

  if (!(APPROVE_FROM as readonly string[]).includes(refundReq.state)) {
    return {
      ok: false,
      error: `Cannot approve: refund request must be pending (current: ${refundReq.state}).`,
    }
  }

  const originalAmountRupees = Math.floor(Number(refundReq.amount))

  if (amount > originalAmountRupees) {
    return {
      ok: false,
      error: `Approved amount (₹${amount}) exceeds requested amount (₹${originalAmountRupees}).`,
    }
  }

  // Transition: pending → approved
  await db
    .update(refundRequests)
    .set({
      state: 'approved',
      notes: amount < originalAmountRupees
        ? `Partial refund approved: ₹${amount} of ₹${originalAmountRupees}`
        : null,
      resolvedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(refundRequests.id, refundRequestId))

  // Credit the Customer's Refund balance
  await creditRefundBalance(db, {
    userId: refundReq.requestedByUserId,
    amountRupees: amount,
    refundRequestId,
    bookingId: refundReq.bookingId,
  })

  // Transition: approved → credited
  await db
    .update(refundRequests)
    .set({
      state: 'credited',
      updatedAt: sql`now()`,
    })
    .where(eq(refundRequests.id, refundRequestId))

  // Audit log
  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.refund.approve',
    entityType: 'refund_request',
    entityId: refundRequestId,
    payload: {
      previousState: refundReq.state,
      newState: 'credited',
      requestedAmountRupees: originalAmountRupees,
      approvedAmountRupees: amount,
      isPartial: amount < originalAmountRupees,
      bookingId: refundReq.bookingId,
      customerUserId: refundReq.requestedByUserId,
    },
  })

  return { ok: true }
}

// ── Core testable: reject refund ────────────────────────────────────

export async function executeRejectRefund(
  db: DBOrTx,
  adminUserId: string,
  input: { refundRequestId: string; reason: string },
): Promise<RefundActionResult> {
  const parsed = rejectSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { refundRequestId, reason } = parsed.data

  const [refundReq] = await db
    .select({
      id: refundRequests.id,
      state: refundRequests.state,
      bookingId: refundRequests.bookingId,
      requestedByUserId: refundRequests.requestedByUserId,
      amount: refundRequests.amount,
    })
    .from(refundRequests)
    .where(eq(refundRequests.id, refundRequestId))
    .limit(1)

  if (!refundReq) {
    return { ok: false, error: 'Refund request not found.' }
  }

  if (!(REJECT_FROM as readonly string[]).includes(refundReq.state)) {
    return {
      ok: false,
      error: `Cannot reject: refund request must be pending (current: ${refundReq.state}).`,
    }
  }

  // Transition: pending → rejected
  await db
    .update(refundRequests)
    .set({
      state: 'rejected',
      notes: reason,
      resolvedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(refundRequests.id, refundRequestId))

  // Audit log
  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.refund.reject',
    entityType: 'refund_request',
    entityId: refundRequestId,
    payload: {
      previousState: refundReq.state,
      newState: 'rejected',
      reason,
      requestedAmountRupees: Math.floor(Number(refundReq.amount)),
      bookingId: refundReq.bookingId,
      customerUserId: refundReq.requestedByUserId,
    },
  })

  return { ok: true }
}

// ── Query: list refund requests ─────────────────────────────────────

export interface RefundRequestRow {
  id: string
  state: string
  amount: string
  reason: string
  bookingId: string
  customerEmail: string | null
  customerUserId: string
  notes: string | null
  createdAt: Date
  resolvedAt: Date | null
}

export async function listRefundRequests(
  db: DBOrTx,
  filter?: { state?: string },
): Promise<RefundRequestRow[]> {
  let query = db
    .select({
      id: refundRequests.id,
      state: refundRequests.state,
      amount: refundRequests.amount,
      reason: refundRequests.reason,
      bookingId: refundRequests.bookingId,
      customerEmail: users.email,
      customerUserId: refundRequests.requestedByUserId,
      notes: refundRequests.notes,
      createdAt: refundRequests.createdAt,
      resolvedAt: refundRequests.resolvedAt,
    })
    .from(refundRequests)
    .innerJoin(users, eq(refundRequests.requestedByUserId, users.id))
    .orderBy(desc(refundRequests.createdAt))
    .$dynamic()

  if (filter?.state) {
    query = query.where(eq(refundRequests.state, filter.state as typeof refundRequests.state.enumValues[number]))
  }

  return query
}

// ── Server action wrappers (auth layer) ─────────────────────────────

export async function approveRefundAction(
  refundRequestId: string,
  amount: number,
): Promise<RefundActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'refunds'))) {
    return { ok: false, error: 'You do not have permission to process refunds.' }
  }

  const result = await executeApproveRefund(prodDb, session.user.id, {
    refundRequestId,
    amount,
  })

  if (result.ok) revalidatePath('/admin/refunds')
  return result
}

export async function rejectRefundAction(
  refundRequestId: string,
  reason: string,
): Promise<RefundActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'refunds'))) {
    return { ok: false, error: 'You do not have permission to process refunds.' }
  }

  const result = await executeRejectRefund(prodDb, session.user.id, {
    refundRequestId,
    reason,
  })

  if (result.ok) revalidatePath('/admin/refunds')
  return result
}
