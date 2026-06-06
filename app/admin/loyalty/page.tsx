import { desc, eq } from 'drizzle-orm'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { users } from '@/db/schema/users'
import { walletBalances } from '@/db/schema/wallet-balances'
import { walletTransactions } from '@/db/schema/wallet-transactions'

import { formatRupees } from '../_components/money'
import { GrantCreditForm } from './grant-credit-form'
import { WalletBalancesTable, type WalletBalanceRow } from './wallet-balances-table'
import {
  WalletTransactionsTable,
  type WalletTransactionRow,
} from './wallet-transactions-table'

export default async function LoyaltyPage() {
  // Aggregate balances per user with user info
  const balances = await db
    .select({
      userId: walletBalances.userId,
      balanceType: walletBalances.balanceType,
      amount: walletBalances.amount,
      userName: users.name,
      userEmail: users.email,
    })
    .from(walletBalances)
    .innerJoin(users, eq(walletBalances.userId, users.id))
    .orderBy(desc(walletBalances.amount))

  // Group by user for display
  const userMap = new Map<string, WalletBalanceRow>()

  for (const row of balances) {
    const existing = userMap.get(row.userId) ?? {
      userId: row.userId,
      name: row.userName,
      email: row.userEmail,
      outversCredit: 0,
      refundBalance: 0,
    }
    if (row.balanceType === 'outvers_credit') {
      existing.outversCredit = Math.floor(Number(row.amount))
    } else if (row.balanceType === 'refund_balance') {
      existing.refundBalance = Math.floor(Number(row.amount))
    }
    userMap.set(row.userId, existing)
  }

  const userBalances = Array.from(userMap.values()).sort(
    (a, b) => b.outversCredit + b.refundBalance - (a.outversCredit + a.refundBalance),
  )

  // Recent wallet transactions
  const recentTxns = await db
    .select({
      id: walletTransactions.id,
      userId: walletTransactions.userId,
      balanceType: walletTransactions.balanceType,
      amount: walletTransactions.amount,
      source: walletTransactions.source,
      referenceId: walletTransactions.referenceId,
      createdAt: walletTransactions.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(walletTransactions)
    .innerJoin(users, eq(walletTransactions.userId, users.id))
    .orderBy(desc(walletTransactions.createdAt))
    .limit(50)

  const txnRows: WalletTransactionRow[] = recentTxns.map((t) => ({
    id: t.id,
    userId: t.userId,
    balanceType: t.balanceType,
    amount: Number(t.amount),
    source: t.source,
    referenceId: t.referenceId,
    createdAt: t.createdAt,
    userName: t.userName,
    userEmail: t.userEmail,
  }))

  const totalOutversCredit = userBalances.reduce((s, u) => s + u.outversCredit, 0)
  const totalRefundBalance = userBalances.reduce((s, u) => s + u.refundBalance, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-h1 font-semibold tracking-tight">Loyalty &amp; Credits</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {userBalances.length} user{userBalances.length === 1 ? '' : 's'} with wallet balances
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Outvers Credit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{formatRupees(totalOutversCredit)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Refund Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{formatRupees(totalRefundBalance)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Manual Credit Grant</CardTitle>
        </CardHeader>
        <CardContent>
          <GrantCreditForm />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Wallet Balances</h2>
        <WalletBalancesTable rows={userBalances} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Recent Transactions</h2>
        <WalletTransactionsTable rows={txnRows} />
      </section>
    </div>
  )
}
