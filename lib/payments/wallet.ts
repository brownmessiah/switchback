import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { bookings } from '@/db/schema/bookings'
import { payments } from '@/db/schema/payments'
import { refundRequests } from '@/db/schema/refund-requests'
import { walletBalances } from '@/db/schema/wallet-balances'
import { writeAuditLog } from '@/lib/audit/write'

import type { DBOrTx } from './commission-resolver'
import { createRefund, type RazorpaySdkLike } from './razorpay-client'

/**
 * Wallet operations per ADR-0004 (two-balance wallet model). Backed by
 * the two-row `wallet_balances` table keyed on (user_id, balance_type):
 *
 *   outvers_credit  — closed-loop promotional balance (referral, promo,
 *                     loyalty). Never cashable.
 *   refund_balance  — closed-loop by default, cashable to original
 *                     payment method on Customer request via Razorpay.
 *
 * Spend order on checkout is non-negotiable: Outvers credit first (it
 * expires), then Refund balance (cashout-eligible), then Razorpay for
 * the remainder.
 *
 * All four operations accept a `DBOrTx` so they participate in the
 * caller's transaction — typically the refund-flow's single tx that
 * also reverses commission and transitions Booking state. SELECT FOR
 * UPDATE on the balance row prevents the classic concurrent-spend race
 * where two checkout attempts each see the full balance.
 *
 * Money flows as integer rupees across this boundary; the wallet_balances
 * column is numeric(14,2) for storage parity with payments / refund
 * amounts but we never expose fractional rupees in the API surface.
 *
 * Every wallet movement writes an audit_logs row identifying the source
 * bucket, amount, and reason. This is the spine of the M2 ops
 * reconciliation dashboard.
 */

const OutversCreditSourceSchema = z.enum(['referral', 'promo', 'loyalty'])
export type OutversCreditSource = z.infer<typeof OutversCreditSourceSchema>

function assertPositiveInteger(amountRupees: number, field = 'amountRupees'): void {
  if (!Number.isInteger(amountRupees)) {
    throw new Error(`${field} must be an integer (rupee precision)`)
  }
  if (amountRupees <= 0) {
    throw new Error(`${field} must be positive`)
  }
}

function assertNonNegativeInteger(amountRupees: number, field = 'grossRupees'): void {
  if (!Number.isInteger(amountRupees)) {
    throw new Error(`${field} must be an integer (rupee precision)`)
  }
  if (amountRupees < 0) {
    throw new Error(`${field} must be non-negative`)
  }
}

// ============================================================================
// applyWalletToCheckout
// ============================================================================

export interface ApplyWalletToCheckoutArgs {
  userId: string
  grossRupees: number
  /** Optional but recommended — included in the audit payload for traceability. */
  bookingId?: string
}

export interface ApplyWalletToCheckoutResult {
  outversCreditAppliedRupees: number
  refundBalanceAppliedRupees: number
  razorpayRemainderRupees: number
}

/**
 * Spend order per ADR-0004: Outvers credit → Refund balance → Razorpay
 * remainder. The function DEBITS both balance buckets in the same tx
 * and returns the remainder the Server Action should charge via the
 * Razorpay order.
 *
 * Caller is responsible for wrapping in a db.transaction(...) so that a
 * Razorpay-order failure downstream rolls back the wallet debits. The
 * SELECT FOR UPDATE locks block concurrent spends on the same buckets.
 */
export async function applyWalletToCheckout(
  db: DBOrTx,
  args: ApplyWalletToCheckoutArgs,
): Promise<ApplyWalletToCheckoutResult> {
  assertNonNegativeInteger(args.grossRupees, 'grossRupees')

  if (args.grossRupees === 0) {
    return {
      outversCreditAppliedRupees: 0,
      refundBalanceAppliedRupees: 0,
      razorpayRemainderRupees: 0,
    }
  }

  const rows = await db
    .select()
    .from(walletBalances)
    .where(eq(walletBalances.userId, args.userId))
    .for('update')

  const outversCreditRow = rows.find((r) => r.balanceType === 'outvers_credit')
  const refundBalanceRow = rows.find((r) => r.balanceType === 'refund_balance')

  const outversCreditAvail = outversCreditRow
    ? Math.floor(Number(outversCreditRow.amount))
    : 0
  const refundBalanceAvail = refundBalanceRow
    ? Math.floor(Number(refundBalanceRow.amount))
    : 0

  const outversCreditApplied = Math.min(outversCreditAvail, args.grossRupees)
  const afterOutvers = args.grossRupees - outversCreditApplied
  const refundBalanceApplied = Math.min(refundBalanceAvail, afterOutvers)
  const razorpayRemainder = afterOutvers - refundBalanceApplied

  if (outversCreditApplied > 0) {
    await db
      .update(walletBalances)
      .set({
        amount: sql`${walletBalances.amount} - ${outversCreditApplied}`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(walletBalances.userId, args.userId),
          eq(walletBalances.balanceType, 'outvers_credit'),
        ),
      )
  }
  if (refundBalanceApplied > 0) {
    await db
      .update(walletBalances)
      .set({
        amount: sql`${walletBalances.amount} - ${refundBalanceApplied}`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(walletBalances.userId, args.userId),
          eq(walletBalances.balanceType, 'refund_balance'),
        ),
      )
  }

  await writeAuditLog(db, {
    actorUserId: args.userId,
    action: 'wallet.apply_to_checkout',
    entityType: 'wallet_balance',
    entityId: args.userId,
    payload: {
      userId: args.userId,
      grossRupees: args.grossRupees,
      outversCreditAppliedRupees: outversCreditApplied,
      refundBalanceAppliedRupees: refundBalanceApplied,
      razorpayRemainderRupees: razorpayRemainder,
      bookingId: args.bookingId ?? null,
    },
  })

  return {
    outversCreditAppliedRupees: outversCreditApplied,
    refundBalanceAppliedRupees: refundBalanceApplied,
    razorpayRemainderRupees: razorpayRemainder,
  }
}

// ============================================================================
// creditRefundBalance
// ============================================================================

export interface CreditRefundBalanceArgs {
  userId: string
  amountRupees: number
  /** The refund_requests row that authorised this credit. Required for audit. */
  refundRequestId: string
  bookingId: string
}

/**
 * Credit a refund into the Customer's Refund balance bucket. Called by
 * refund-flow.ts for inside-policy auto-credits and vendor-cancelled
 * full refunds. Idempotent at the row level via INSERT ... ON CONFLICT
 * DO UPDATE, but callers should not rely on that for retry — they
 * should idempotency-key their own flow.
 */
export async function creditRefundBalance(
  db: DBOrTx,
  args: CreditRefundBalanceArgs,
): Promise<void> {
  assertPositiveInteger(args.amountRupees, 'amountRupees')

  await db
    .insert(walletBalances)
    .values({
      userId: args.userId,
      balanceType: 'refund_balance',
      amount: args.amountRupees.toFixed(2),
    })
    .onConflictDoUpdate({
      target: [walletBalances.userId, walletBalances.balanceType],
      set: {
        amount: sql`${walletBalances.amount} + ${args.amountRupees}`,
        updatedAt: sql`now()`,
      },
    })

  await writeAuditLog(db, {
    actorUserId: null,
    action: 'wallet.credit_refund_balance',
    entityType: 'wallet_balance',
    entityId: args.userId,
    payload: {
      userId: args.userId,
      amountRupees: args.amountRupees,
      refundRequestId: args.refundRequestId,
      bookingId: args.bookingId,
    },
  })
}

// ============================================================================
// creditOutversBalance
// ============================================================================

export interface CreditOutversBalanceArgs {
  userId: string
  amountRupees: number
  source: OutversCreditSource
  reason?: string
}

/**
 * Credit the Customer's Outvers credit bucket from a promotional source
 * (referral, promo, loyalty). Never cashable per ADR-0004.
 */
export async function creditOutversBalance(
  db: DBOrTx,
  args: CreditOutversBalanceArgs,
): Promise<void> {
  OutversCreditSourceSchema.parse(args.source)
  assertPositiveInteger(args.amountRupees, 'amountRupees')

  await db
    .insert(walletBalances)
    .values({
      userId: args.userId,
      balanceType: 'outvers_credit',
      amount: args.amountRupees.toFixed(2),
    })
    .onConflictDoUpdate({
      target: [walletBalances.userId, walletBalances.balanceType],
      set: {
        amount: sql`${walletBalances.amount} + ${args.amountRupees}`,
        updatedAt: sql`now()`,
      },
    })

  await writeAuditLog(db, {
    actorUserId: null,
    action: 'wallet.credit_outvers_credit',
    entityType: 'wallet_balance',
    entityId: args.userId,
    payload: {
      userId: args.userId,
      amountRupees: args.amountRupees,
      source: args.source,
      reason: args.reason ?? null,
    },
  })
}

// ============================================================================
// requestCashout
// ============================================================================

export interface RequestCashoutArgs {
  userId: string
  amountRupees: number
  /** The Razorpay payment id the Customer originally paid with. */
  originalPaymentId: string
}

export interface RequestCashoutResult {
  refundRequestId: string
  razorpayRefundId: string
}

export interface RequestCashoutOpts {
  client?: RazorpaySdkLike
}

/**
 * Customer-initiated cashout from Refund balance back to the original
 * payment method (5-7d Razorpay round-trip). Per ADR-0004, this is the
 * cashable path that distinguishes Refund balance from Outvers credit.
 *
 * Flow (all DB work before the external Razorpay call):
 *  1. Look up the originating payment row joined to bookings — verifies
 *     ownership (bookings.customer_user_id == args.userId) AND locks both
 *     rows with FOR UPDATE so two concurrent cashouts cannot proceed on
 *     the same payment for the same Customer.
 *  2. Lock the user's refund_balance row; verify sufficient funds.
 *  3. Debit refund_balance.
 *  4. Insert a refund_requests row with destination='original_payment_method',
 *     reason='admin_override' (cashout is system-processed; the policy basis
 *     enum already covers this label), state='pending'.
 *  5. Write the wallet.request_cashout audit row — BEFORE the Razorpay
 *     call so that a failed audit insert rolls the transaction back
 *     with NO real-money refund in flight. The razorpayRefundId is
 *     omitted here; the refund.processed webhook writes its own audit
 *     row with the upstream id, and the refund_requests linkage stitches
 *     the two together in reconciliation.
 *  6. Call Razorpay.createRefund — the only out-of-band step. If the
 *     caller's transaction rolls back AFTER this returns, the Razorpay
 *     refund will be reconciled via the refund.processed webhook + the
 *     pending refund_requests row (which was committed).
 */
export async function requestCashout(
  db: DBOrTx,
  args: RequestCashoutArgs,
  opts: RequestCashoutOpts = {},
): Promise<RequestCashoutResult> {
  assertPositiveInteger(args.amountRupees, 'amountRupees')

  // 1. Verify ownership AND lock the payment+booking rows in one query.
  // The join makes it structurally impossible to operate on another
  // customer's payment id even if the SA layer trusts user input.
  const [paymentRow] = await db
    .select({ bookingId: payments.bookingId })
    .from(payments)
    .innerJoin(bookings, eq(bookings.id, payments.bookingId))
    .where(
      and(
        eq(payments.razorpayPaymentId, args.originalPaymentId),
        eq(bookings.customerUserId, args.userId),
      ),
    )
    .for('update')
    .limit(1)
  if (!paymentRow) {
    throw new Error(`payment ${args.originalPaymentId} not found`)
  }

  // 2. Lock the refund_balance row + verify funds.
  const [balanceRow] = await db
    .select()
    .from(walletBalances)
    .where(
      and(
        eq(walletBalances.userId, args.userId),
        eq(walletBalances.balanceType, 'refund_balance'),
      ),
    )
    .for('update')

  const currentRupees = balanceRow ? Math.floor(Number(balanceRow.amount)) : 0
  if (currentRupees < args.amountRupees) {
    throw new Error(
      `insufficient refund_balance: have ${currentRupees} rupees, requested ${args.amountRupees}`,
    )
  }

  // 3. Debit.
  await db
    .update(walletBalances)
    .set({
      amount: sql`${walletBalances.amount} - ${args.amountRupees}`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(walletBalances.userId, args.userId),
        eq(walletBalances.balanceType, 'refund_balance'),
      ),
    )

  // 4. Record the refund_requests row.
  const [refundReq] = await db
    .insert(refundRequests)
    .values({
      bookingId: paymentRow.bookingId,
      requestedByUserId: args.userId,
      reason: 'admin_override',
      destination: 'original_payment_method',
      state: 'pending',
      amount: args.amountRupees.toFixed(2),
      cancellationPresetSnapshot: 'custom',
      policyWindowBasisSnapshot: 'admin_override',
    })
    .returning({ id: refundRequests.id })

  if (!refundReq) {
    throw new Error('refund_requests insert returned no row (unreachable)')
  }

  // 5. Audit BEFORE the Razorpay call. If this throws (e.g. audit_logs
  // append-only trigger failure), the tx rolls back — debit reversed,
  // refund_requests row gone, Razorpay was never called.
  await writeAuditLog(db, {
    actorUserId: args.userId,
    action: 'wallet.request_cashout',
    entityType: 'refund_request',
    entityId: refundReq.id,
    payload: {
      userId: args.userId,
      amountRupees: args.amountRupees,
      bookingId: paymentRow.bookingId,
      originalPaymentId: args.originalPaymentId,
      refundRequestId: refundReq.id,
    },
  })

  // 6. External call — last. The webhook's refund.processed event writes
  // its own audit row with the razorpayRefundId; reconciliation stitches
  // by refund_requests.id (passed in notes).
  const refund = await createRefund(
    {
      paymentId: args.originalPaymentId,
      amountRupees: args.amountRupees,
      notes: {
        booking_id: paymentRow.bookingId,
        refund_request_id: refundReq.id,
        type: 'wallet_cashout',
      },
    },
    opts.client ? { client: opts.client } : {},
  )

  return {
    refundRequestId: refundReq.id,
    razorpayRefundId: refund.refundId,
  }
}
