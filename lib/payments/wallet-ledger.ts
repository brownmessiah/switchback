import { and, eq, sql, sum } from 'drizzle-orm'

import { promoCodes } from '@/db/schema/promo-codes'
import { promoRedemptions } from '@/db/schema/promo-redemptions'
import { walletBalances } from '@/db/schema/wallet-balances'
import { walletTransactions } from '@/db/schema/wallet-transactions'
import { writeAuditLog } from '@/lib/audit/write'

import type { DBOrTx } from './commission-resolver'

/**
 * Wallet ledger operations. Every wallet movement creates an immutable
 * `wallet_transactions` row AND updates the aggregate `wallet_balances`
 * row in the same transaction.
 *
 * The ledger is the source of truth for reconciliation; the aggregate
 * table is the hot read path for checkout spend-order calculations.
 */

// ============================================================================
// grantCredit
// ============================================================================

export interface GrantCreditArgs {
  userId: string
  amountRupees: number
  source: 'promo' | 'referral' | 'admin' | 'refund'
  balanceType: 'switchback_credit' | 'refund_balance'
  referenceId?: string
  expiresAt?: Date
  actorUserId?: string | null
}

/**
 * Grant credit to a user's wallet. Creates a wallet_transactions row
 * and upserts the aggregate wallet_balances row in one go.
 *
 * Returns the created wallet_transaction id.
 */
export async function grantCredit(
  db: DBOrTx,
  args: GrantCreditArgs,
): Promise<{ walletTransactionId: string }> {
  assertPositiveInteger(args.amountRupees, 'amountRupees')

  // 1. Insert ledger row
  const [txnRow] = await db
    .insert(walletTransactions)
    .values({
      userId: args.userId,
      balanceType: args.balanceType,
      amount: args.amountRupees.toFixed(2),
      source: args.source,
      referenceId: args.referenceId ?? null,
      expiresAt: args.expiresAt ?? null,
    })
    .returning({ id: walletTransactions.id })

  if (!txnRow) {
    throw new Error('wallet_transactions insert returned no row (unreachable)')
  }

  // 2. Upsert aggregate balance
  await db
    .insert(walletBalances)
    .values({
      userId: args.userId,
      balanceType: args.balanceType,
      amount: args.amountRupees.toFixed(2),
    })
    .onConflictDoUpdate({
      target: [walletBalances.userId, walletBalances.balanceType],
      set: {
        amount: sql`${walletBalances.amount} + ${args.amountRupees}`,
        updatedAt: sql`now()`,
      },
    })

  // 3. Audit
  await writeAuditLog(db, {
    actorUserId: args.actorUserId ?? null,
    action: 'wallet.grant_credit',
    entityType: 'wallet_transaction',
    entityId: txnRow.id,
    payload: {
      userId: args.userId,
      amountRupees: args.amountRupees,
      balanceType: args.balanceType,
      source: args.source,
      referenceId: args.referenceId ?? null,
      expiresAt: args.expiresAt?.toISOString() ?? null,
    },
  })

  return { walletTransactionId: txnRow.id }
}

// ============================================================================
// redeemPromo
// ============================================================================

export interface RedeemPromoArgs {
  userId: string
  code: string
}

export interface RedeemPromoResult {
  walletTransactionId: string
  creditedAmount: number
}

/**
 * Redeem a promo code for the given user. Performs all validations
 * (active, date range, usage limits) and atomically increments the
 * promo counter, creates a wallet_transactions row, updates the
 * aggregate balance, and logs the promo_redemptions row.
 *
 * All within a single db handle (caller passes a transaction).
 */
export async function redeemPromo(
  db: DBOrTx,
  args: RedeemPromoArgs,
): Promise<RedeemPromoResult> {
  // 1. Look up the promo code
  const [promo] = await db
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.code, args.code))
    .limit(1)

  if (!promo) {
    throw new Error(`promo code "${args.code}" not found`)
  }

  // 2. Validate active flag
  if (!promo.active) {
    throw new Error(`promo code "${args.code}" is inactive`)
  }

  // 3. Validate date range
  const now = new Date()
  if (promo.startsAt && now < promo.startsAt) {
    throw new Error(`promo code "${args.code}" has not started yet`)
  }
  if (promo.expiresAt && now > promo.expiresAt) {
    throw new Error(`promo code "${args.code}" has expired`)
  }

  // 4. Check per-user limit
  const existingRedemptions = await db
    .select()
    .from(promoRedemptions)
    .where(
      and(
        eq(promoRedemptions.promoCodeId, promo.id),
        eq(promoRedemptions.customerUserId, args.userId),
      ),
    )

  if (existingRedemptions.length >= promo.perUserLimit) {
    throw new Error(
      `promo code "${args.code}" already redeemed ${existingRedemptions.length} time(s) by this user (limit: ${promo.perUserLimit})`,
    )
  }

  // 5. Atomic counter increment — prevents exceeding max_total_uses.
  // The WHERE clause ensures we only increment if under the limit.
  // If another concurrent tx incremented first, this returns 0 rows.
  if (promo.maxTotalUses !== null) {
    const updated = await db
      .update(promoCodes)
      .set({
        currentUses: sql`${promoCodes.currentUses} + 1`,
      })
      .where(
        and(
          eq(promoCodes.id, promo.id),
          sql`${promoCodes.currentUses} < ${promo.maxTotalUses}`,
        ),
      )
      .returning({ id: promoCodes.id })

    if (updated.length === 0) {
      throw new Error(`promo code "${args.code}" has reached its maximum usage limit`)
    }
  } else {
    // No global limit — just increment the counter for stats
    await db
      .update(promoCodes)
      .set({
        currentUses: sql`${promoCodes.currentUses} + 1`,
      })
      .where(eq(promoCodes.id, promo.id))
  }

  // 6. Grant credit via ledger
  const creditAmount = Math.floor(Number(promo.creditAmount))
  const { walletTransactionId } = await grantCredit(db, {
    userId: args.userId,
    amountRupees: creditAmount,
    source: 'promo',
    balanceType: 'switchback_credit',
    referenceId: promo.id,
  })

  // 7. Log the redemption
  await db.insert(promoRedemptions).values({
    promoCodeId: promo.id,
    customerUserId: args.userId,
    walletTransactionId,
  })

  // 8. Audit
  await writeAuditLog(db, {
    actorUserId: args.userId,
    action: 'wallet.redeem_promo',
    entityType: 'promo_code',
    entityId: promo.id,
    payload: {
      userId: args.userId,
      code: args.code,
      creditAmount,
      promoCodeId: promo.id,
      walletTransactionId,
    },
  })

  return { walletTransactionId, creditedAmount: creditAmount }
}

// ============================================================================
// balanceFromLedger
// ============================================================================

export interface LedgerBalance {
  switchbackCredit: number
  refundBalance: number
}

/**
 * Compute wallet balances by summing all wallet_transactions rows
 * grouped by balance_type. This is the reconciliation path — the
 * authoritative balance derived from the immutable ledger.
 *
 * For the hot-read path (checkout), use the aggregate wallet_balances
 * table instead.
 */
export async function balanceFromLedger(
  db: DBOrTx,
  userId: string,
): Promise<LedgerBalance> {
  const rows = await db
    .select({
      balanceType: walletTransactions.balanceType,
      total: sum(walletTransactions.amount),
    })
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, userId))
    .groupBy(walletTransactions.balanceType)

  let switchbackCredit = 0
  let refundBalance = 0

  for (const row of rows) {
    const total = Math.floor(Number(row.total ?? 0))
    if (row.balanceType === 'switchback_credit') {
      switchbackCredit = total
    } else if (row.balanceType === 'refund_balance') {
      refundBalance = total
    }
  }

  return { switchbackCredit, refundBalance }
}

// ============================================================================
// Helpers
// ============================================================================

function assertPositiveInteger(amountRupees: number, field = 'amountRupees'): void {
  if (!Number.isInteger(amountRupees)) {
    throw new Error(`${field} must be an integer (rupee precision)`)
  }
  if (amountRupees <= 0) {
    throw new Error(`${field} must be positive`)
  }
}
