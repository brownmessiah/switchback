import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from '@/components/ui/responsive-table'

import { shortRef } from '@/lib/admin/short-ref'

import { AdminStatusBadge } from '../_components/admin-status-badge'
import { formatRupees, formatRupeesDeduction } from '../_components/money'

/**
 * A reference is opaque (a booking/loyalty UUID) when it matches the UUID
 * shape — those get a `shortRef` (`OV-3F50`) with the full id behind a title.
 * Human-readable refs (e.g. `catalog-refund-credit`) are shown verbatim.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isOpaqueRef(ref: string): boolean {
  return UUID_RE.test(ref.trim())
}

/**
 * #96 — recent Wallet transactions as a DESIGN.md §4 A3 table, migrated to the
 * shared `ResponsiveTable` (ADR-0018 / DESIGN.md §8.5): the `≥ md` Table reverses
 * to a stacked label:value Card list `< md`. Each entry's bucket is tagged via
 * the shared semantic Badge (Outvers credit → `credit` + wallet icon, Refund
 * balance → `success` + check — status color + icon, never color alone,
 * DESIGN.md §1.3 / §5). Signed amounts are right-aligned + `.tabular-nums`
 * (DESIGN.md §1.3 / §2.2). Presentational + unit-testable.
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

function ReferenceCell({ referenceId }: { referenceId: string | null }) {
  if (referenceId == null) return <>—</>
  if (isOpaqueRef(referenceId)) {
    return (
      <span className="font-mono" title={referenceId}>
        {shortRef(referenceId)}
      </span>
    )
  }
  return <>{referenceId}</>
}

const COLUMNS: ResponsiveTableColumn<WalletTransactionRow>[] = [
  {
    key: 'user',
    header: 'User',
    primary: true,
    cell: (t) => t.userEmail ?? t.userName ?? t.userId,
  },
  {
    key: 'bucket',
    header: 'Bucket',
    cell: (t) => (
      <AdminStatusBadge
        status={BUCKET_STATUS[t.balanceType] ?? 'neutral'}
        label={BUCKET_LABEL[t.balanceType] ?? t.balanceType.replace('_', ' ')}
      />
    ),
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    cell: (t) => {
      const isCredit = t.amount >= 0
      return (
        <span className={isCredit ? 'font-medium text-success' : 'font-medium text-destructive'}>
          {isCredit
            ? `+${formatRupees(t.amount)}`
            : formatRupeesDeduction(Math.abs(t.amount))}
        </span>
      )
    },
  },
  {
    key: 'source',
    header: 'Source',
    cell: (t) => <span className="capitalize">{t.source.replace('_', ' ')}</span>,
  },
  {
    key: 'reference',
    header: 'Reference',
    cell: (t) => (
      <span className="text-muted-foreground">
        <ReferenceCell referenceId={t.referenceId} />
      </span>
    ),
  },
  {
    key: 'date',
    header: 'Date',
    cell: (t) => (
      <span className="text-muted-foreground">
        {new Date(t.createdAt).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    ),
  },
]

export function WalletTransactionsTable({ rows }: { rows: WalletTransactionRow[] }) {
  return (
    <ResponsiveTable<WalletTransactionRow>
      columns={COLUMNS}
      rows={rows}
      getRowKey={(t) => t.id}
      rowProps={(t) => ({ 'data-transaction-id': t.id })}
      caption="Recent Wallet transactions"
      empty="No transactions yet."
    />
  )
}
