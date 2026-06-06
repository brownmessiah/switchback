import { Badge } from '@/components/ui/badge'
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from '@/components/ui/responsive-table'
import { kycTierBadge } from '@/lib/admin/kyc-tier-badge'

/**
 * #87 — the admin vendors LIST as a rigorous DESIGN.md §4 A3 table, now via the
 * shared `<ResponsiveTable>` so it reverses to a stacked label:value Card list
 * below `md` (the A3 reversal — DESIGN.md §8.3/§8.5; ADR-0018):
 *  - KYC tier as a distinct-per-tier ramp via `kycTierBadge` (Business →
 *    success, Identity → info, Phone → warning) so the strongest tier is
 *    visually distinct instead of all-green — status color + paired icon,
 *    never color alone (DESIGN.md §1.3 / §5; ADR-0007 distinct labels)
 *  - numeric columns (Commission %, SLA %) right-aligned + `.tabular-nums`
 *    (DESIGN.md §1.3 / §2.2)
 *  - each row links to its `/admin/vendors/[id]` detail (B6 master → detail;
 *    the E2E navigates list → detail via `a[href*="/admin/vendors/"]`)
 *  - `data-vendor-id` is preserved per row via `rowProps` so the admin E2E
 *    selectors survive the reversal
 *
 * No KYC approve/reject/suspend ACTIONS live on the LIST — those are on the
 * [id] detail (#101). The presentational table is split out so it is
 * unit-testable in isolation; the page owns the data load.
 */
export interface VendorsTableRow {
  userId: string
  businessName: string
  slug: string
  kycTier: string
  commissionRate: string | number
  responseTimeSlaScore: string | number
  suspended: boolean
  createdAt: Date | string
  userName: string | null
  userEmail: string | null
}

function formatDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const COLUMNS: ResponsiveTableColumn<VendorsTableRow>[] = [
  {
    key: 'business',
    header: 'Business',
    primary: true,
    cell: (v) => (
      <span className="inline-flex items-center gap-2">
        {v.businessName}
        {v.suspended && <Badge variant="destructive">Suspended</Badge>}
      </span>
    ),
  },
  {
    key: 'contact',
    header: 'Contact',
    cell: (v) => (
      <span className="text-sm text-muted-foreground">
        {v.userEmail ?? v.userName ?? '—'}
      </span>
    ),
  },
  {
    key: 'kyc',
    header: 'KYC',
    cell: (v) => {
      const kyc = kycTierBadge(v.kycTier)
      const KycIcon = kyc.icon
      return (
        <Badge variant={kyc.variant}>
          <KycIcon data-icon="inline-start" aria-hidden />
          {kyc.label}
        </Badge>
      )
    },
  },
  {
    key: 'commission',
    header: 'Commission',
    align: 'right',
    cell: (v) => (
      <span className="text-sm tabular-nums">
        {Math.floor(Number(v.commissionRate))}%
      </span>
    ),
  },
  {
    key: 'sla',
    header: 'SLA',
    align: 'right',
    cell: (v) => (
      <span className="text-sm tabular-nums">
        {Math.floor(Number(v.responseTimeSlaScore))}%
      </span>
    ),
  },
  {
    key: 'joined',
    header: 'Joined',
    cell: (v) => (
      <span className="text-sm text-muted-foreground">
        {formatDate(v.createdAt)}
      </span>
    ),
  },
]

export function VendorsTable({ rows }: { rows: VendorsTableRow[] }) {
  return (
    <ResponsiveTable<VendorsTableRow>
      columns={COLUMNS}
      rows={rows}
      getRowKey={(v) => v.userId}
      rowHref={(v) => `/admin/vendors/${v.userId}`}
      rowProps={(v) => ({ 'data-vendor-id': v.userId })}
      caption="Registered Vendors"
      empty="No vendors found."
    />
  )
}
