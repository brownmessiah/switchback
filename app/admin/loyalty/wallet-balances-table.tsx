import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { formatRupees } from '../_components/money'

/**
 * #96 — per-Customer Wallet balances as a DESIGN.md §4 A3 table. The two-bucket
 * Wallet (ADR-0004) is rendered as distinct money columns, all right-aligned +
 * `.tabular-nums` so the figures align (DESIGN.md §1.3 / §2.2). Presentational +
 * split out so it is unit-testable; the page owns the aggregation.
 */
export interface WalletBalanceRow {
  userId: string
  name: string | null
  email: string | null
  outversCredit: number
  refundBalance: number
}

export function WalletBalancesTable({ rows }: { rows: WalletBalanceRow[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
        <Table>
          <caption className="sr-only">Customer Wallet balances</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">User</TableHead>
              <TableHead scope="col" className="text-right">
                Outvers credit
              </TableHead>
              <TableHead scope="col" className="text-right">
                Refund balance
              </TableHead>
              <TableHead scope="col" className="text-right">
                Total
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No wallet balances yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((u) => (
                <TableRow key={u.userId} className="hover:bg-muted/50">
                  <TableCell>
                    <div className="text-sm font-medium">{u.email ?? u.name ?? u.userId}</div>
                    <div className="text-xs text-muted-foreground">{u.userId}</div>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatRupees(u.outversCredit)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatRupees(u.refundBalance)}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium tabular-nums">
                    {formatRupees(u.outversCredit + u.refundBalance)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </CardContent>
    </Card>
  )
}
