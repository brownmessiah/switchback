import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from '@/components/ui/responsive-table'

import { formatRupees } from '../_components/money'

/**
 * #96 — per-Customer Wallet balances as a DESIGN.md §4 A3 table, migrated to the
 * shared `ResponsiveTable` (ADR-0018 / DESIGN.md §8.5): the `≥ md` Table reverses
 * to a stacked label:value Card list `< md`. The two-bucket Wallet (ADR-0004) is
 * rendered as distinct money columns, all right-aligned + `.tabular-nums` so the
 * figures align (DESIGN.md §1.3 / §2.2). Presentational + split out so it is
 * unit-testable; the page owns the aggregation.
 */
export interface WalletBalanceRow {
  userId: string
  name: string | null
  email: string | null
  switchbackCredit: number
  refundBalance: number
}

const COLUMNS: ResponsiveTableColumn<WalletBalanceRow>[] = [
  {
    key: 'user',
    header: 'User',
    primary: true,
    cell: (u) => (
      <span className="font-medium">{u.email ?? u.name ?? u.userId}</span>
    ),
  },
  {
    key: 'userId',
    header: 'User ID',
    cell: (u) => (
      <span className="font-mono text-xs text-muted-foreground">{u.userId}</span>
    ),
  },
  {
    key: 'switchbackCredit',
    header: 'Switchback credit',
    align: 'right',
    cell: (u) => formatRupees(u.switchbackCredit),
  },
  {
    key: 'refundBalance',
    header: 'Refund balance',
    align: 'right',
    cell: (u) => formatRupees(u.refundBalance),
  },
  {
    key: 'total',
    header: 'Total',
    align: 'right',
    cell: (u) => (
      <span className="font-medium">
        {formatRupees(u.switchbackCredit + u.refundBalance)}
      </span>
    ),
  },
]

export function WalletBalancesTable({ rows }: { rows: WalletBalanceRow[] }) {
  return (
    <ResponsiveTable<WalletBalanceRow>
      columns={COLUMNS}
      rows={rows}
      getRowKey={(u) => u.userId}
      rowProps={(u) => ({ 'data-user-id': u.userId })}
      caption="Customer Wallet balances"
      empty="No wallet balances yet."
    />
  )
}
