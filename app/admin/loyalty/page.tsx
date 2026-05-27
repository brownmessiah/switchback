import { desc, eq, sql } from 'drizzle-orm'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { db } from '@/db/client'
import { users } from '@/db/schema/users'
import { walletBalances } from '@/db/schema/wallet-balances'
import { walletTransactions } from '@/db/schema/wallet-transactions'

import { GrantCreditForm } from './grant-credit-form'

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
  const userMap = new Map<
    string,
    {
      userId: string
      name: string | null
      email: string | null
      outversCredit: number
      refundBalance: number
    }
  >()

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

  const totalOutversCredit = userBalances.reduce((s, u) => s + u.outversCredit, 0)
  const totalRefundBalance = userBalances.reduce((s, u) => s + u.refundBalance, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Loyalty & Credits</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {userBalances.length} user{userBalances.length === 1 ? '' : 's'} with wallet balances
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Outvers Credit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">INR {totalOutversCredit.toLocaleString('en-IN')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Refund Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">INR {totalRefundBalance.toLocaleString('en-IN')}</p>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Wallet Balances</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Outvers Credit</TableHead>
                <TableHead>Refund Balance</TableHead>
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {userBalances.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No wallet balances yet.
                  </TableCell>
                </TableRow>
              )}
              {userBalances.map((u) => (
                <TableRow key={u.userId}>
                  <TableCell>
                    <div className="text-sm font-medium">{u.email ?? u.name ?? u.userId}</div>
                    <div className="text-xs text-muted-foreground">{u.userId}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    INR {u.outversCredit.toLocaleString('en-IN')}
                  </TableCell>
                  <TableCell className="text-sm">
                    INR {u.refundBalance.toLocaleString('en-IN')}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    INR {(u.outversCredit + u.refundBalance).toLocaleString('en-IN')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Transactions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentTxns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No transactions yet.
                  </TableCell>
                </TableRow>
              )}
              {recentTxns.map((t) => {
                const amount = Number(t.amount)
                return (
                  <TableRow key={t.id}>
                    <TableCell className="text-sm">
                      {t.userEmail ?? t.userName ?? t.userId}
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {t.balanceType.replace('_', ' ')}
                    </TableCell>
                    <TableCell
                      className={`text-sm font-medium ${amount >= 0 ? 'text-green-600' : 'text-destructive'}`}
                    >
                      {amount >= 0 ? '+' : ''}
                      INR {Math.abs(Math.floor(amount)).toLocaleString('en-IN')}
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {t.source.replace('_', ' ')}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-32 truncate">
                      {t.referenceId ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
