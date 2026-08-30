import { and, asc, count, desc, eq, gt, isNotNull } from 'drizzle-orm'

import { walletBalances } from '@/db/schema/wallet-balances'
import { walletTransactions } from '@/db/schema/wallet-transactions'

import type { DBOrTx } from './commission-resolver'

/**
 * loadWalletView — the pure read model for the dedicated `/wallet` page
 * (issue 09). Read-only: no writes, no audit. It reuses the same two
 * data sources the dashboard wallet aside already reads:
 *
 *   - `wallet_balances` (aggregate hot-read) for each ADR-0004 bucket:
 *       outvers_credit (closed-loop promo, EXPIRES) and
 *       refund_balance (cashable to original method).
 *   - `wallet_transactions` (immutable ledger) for the paginated,
 *       newest-first transaction list and the soonest upcoming credit
 *       expiry.
 *
 * Money crosses this boundary as integer rupees — the numeric(14,2)
 * column is floored, matching the dashboard and checkout surfaces. The
 * `amount` is signed (positive = credit, negative = debit) and that sign
 * is preserved so the page can render +/− with paired color + text.
 */

export interface WalletViewTransaction {
  id: string
  /** 'outvers_credit' | 'refund_balance' (schema's string column). */
  balanceType: string
  /** Signed integer rupees: positive = credit, negative = debit. */
  amount: number
  source: string
  referenceId: string | null
  expiresAt: Date | null
  createdAt: Date
}

export interface WalletView {
  balances: {
    outversCredit: number
    refundBalance: number
  }
  transactions: WalletViewTransaction[]
  total: number
  page: number
  totalPages: number
  /** Soonest upcoming expiry among outvers_credit ledger rows, or null. */
  soonestCreditExpiry: Date | null
}

export interface LoadWalletViewArgs {
  page: number
  pageSize: number
}

function toIntRupees(value: string | number | null): number {
  return Math.floor(Number(value ?? 0))
}

/**
 * Build the read model for a single user's wallet. `page` is 1-based;
 * out-of-range pages clamp to an empty slice (total/totalPages stay
 * accurate so the page can render its pager honestly).
 */
export async function loadWalletView(
  db: DBOrTx,
  userId: string,
  { page, pageSize }: LoadWalletViewArgs,
): Promise<WalletView> {
  const safePageSize = Math.max(1, Math.floor(pageSize))
  const safePage = Math.max(1, Math.floor(page))

  // 1. Bucket balances from the aggregate table.
  const balanceRows = await db
    .select({
      balanceType: walletBalances.balanceType,
      amount: walletBalances.amount,
    })
    .from(walletBalances)
    .where(eq(walletBalances.userId, userId))

  const balances = {
    outversCredit: toIntRupees(
      balanceRows.find((r) => r.balanceType === 'outvers_credit')?.amount ?? null,
    ),
    refundBalance: toIntRupees(
      balanceRows.find((r) => r.balanceType === 'refund_balance')?.amount ?? null,
    ),
  }

  // 2. Total ledger count for pagination.
  const [{ value: total } = { value: 0 }] = await db
    .select({ value: count() })
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, userId))

  const totalPages = total === 0 ? 0 : Math.ceil(total / safePageSize)

  // 3. Paginated, newest-first ledger slice. Tie-break by id so rows
  //    sharing a createdAt stay deterministically ordered across pages.
  const txnRows = await db
    .select({
      id: walletTransactions.id,
      balanceType: walletTransactions.balanceType,
      amount: walletTransactions.amount,
      source: walletTransactions.source,
      referenceId: walletTransactions.referenceId,
      expiresAt: walletTransactions.expiresAt,
      createdAt: walletTransactions.createdAt,
    })
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, userId))
    .orderBy(desc(walletTransactions.createdAt), desc(walletTransactions.id))
    .limit(safePageSize)
    .offset((safePage - 1) * safePageSize)

  const transactions: WalletViewTransaction[] = txnRows.map((r) => ({
    id: r.id,
    balanceType: r.balanceType,
    amount: toIntRupees(r.amount),
    source: r.source,
    referenceId: r.referenceId,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  }))

  // 4. Soonest upcoming Switchback-credit expiry (closed-loop credit is
  //    time-bound, ADR-0004). Only outvers_credit rows can expire.
  const [nextExpiry] = await db
    .select({ expiresAt: walletTransactions.expiresAt })
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, userId),
        eq(walletTransactions.balanceType, 'outvers_credit'),
        isNotNull(walletTransactions.expiresAt),
        gt(walletTransactions.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(walletTransactions.expiresAt))
    .limit(1)

  return {
    balances,
    transactions,
    total,
    page: safePage,
    totalPages,
    soonestCreditExpiry: nextExpiry?.expiresAt ?? null,
  }
}
