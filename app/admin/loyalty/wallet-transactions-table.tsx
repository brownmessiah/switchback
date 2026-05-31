import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { AdminStatusBadge } from '../_components/admin-status-badge'
import { formatRupees, formatRupeesDeduction } from '../_components/money'

/**
 * #96 — recent Wallet transactions as a DESIGN.md §4 A3 table. Each entry's
 * bucket is tagged via the shared semantic Badge (Outvers credit → `credit` +
 * wallet icon, Refund balance → `success` + check — status color + icon, never
 * color alone, DESIGN.md §1.3 / §5). Signed amounts are right-aligned +
 * `.tabular-nums` (DESIGN.md §1.3 / §2.2). Presentational + unit-testable.
 */
export interface WalletTransactionRow {
  id: string
  userId: string
  /** 'outvers_credit' | 'refund_balance' (kept as the schema's string column). */
  balanceType: string
  amount: number
  source: string
  referenceId: string | null
  createdAt: Date | string
  userName: string | null
  userEmail: string | null
}

const BUCKET_LABEL: Record<string, string> = {
  outvers_credit: 'Outvers credit',
  refund_balance: 'Refund balance',
}

// The two-bucket Wallet (ADR-0004): Outvers credit is the closed-loop credit
// bucket → `credit` token; the cashable Refund balance reads as `success`.
const BUCKET_STATUS: Record<string, string> = {
  outvers_credit: 'credit',
  refund_balance: 'credited',
}

export function WalletTransactionsTable({ rows }: { rows: WalletTransactionRow[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <caption className="sr-only">Recent Wallet transactions</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">User</TableHead>
              <TableHead scope="col">Bucket</TableHead>
              <TableHead scope="col" className="text-right">
                Amount
              </TableHead>
              <TableHead scope="col">Source</TableHead>
              <TableHead scope="col">Reference</TableHead>
              <TableHead scope="col">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No transactions yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((t) => {
                const isCredit = t.amount >= 0
                return (
                  <TableRow key={t.id} className="hover:bg-muted/50">
                    <TableCell className="text-sm">
                      {t.userEmail ?? t.userName ?? t.userId}
                    </TableCell>
                    <TableCell>
                      <AdminStatusBadge
                        status={BUCKET_STATUS[t.balanceType] ?? 'neutral'}
                        label={BUCKET_LABEL[t.balanceType] ?? t.balanceType.replace('_', ' ')}
                      />
                    </TableCell>
                    <TableCell
                      className={`text-right text-sm font-medium tabular-nums ${
                        isCredit ? 'text-success' : 'text-destructive'
                      }`}
                    >
                      {isCredit
                        ? `+${formatRupees(t.amount)}`
                        : formatRupeesDeduction(Math.abs(t.amount))}
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {t.source.replace('_', ' ')}
                    </TableCell>
                    <TableCell className="max-w-32 truncate text-sm text-muted-foreground">
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
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
