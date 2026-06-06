import Link from 'next/link'

import { ResponsiveTable, type ResponsiveTableColumn } from '@/components/ui/responsive-table'

import { AdminStatusBadge } from '../_components/admin-status-badge'
import { formatRupees } from '../_components/money'

/**
 * #89 — the admin bookings LIST as a rigorous DESIGN.md §4 A3 table, migrated to
 * the shared `<ResponsiveTable>` (DESIGN.md §8.3/§8.5, ADR-0018):
 *  - `≥ md`: the A3 `Table` (semantic `AdminStatusBadge` per Booking state —
 *    status color + paired icon, never color alone — DESIGN.md §1.3 / §5; amount
 *    + guest columns right-aligned in `.tabular-nums` — DESIGN.md §1.3 / §2.2;
 *    each row links to its `/admin/bookings/[id]` detail — B6 master → detail).
 *  - `< md`: one stacked label:value Card per Booking, titled by the row-link
 *    Booking ID, so the dense 9-column table never forces page-level horizontal
 *    scroll at 360px.
 *
 * Per-row E2E hooks (`data-booking-id`, `data-booking-state`) ride through
 * `rowProps` onto the `≥ md` `TableRow`, so the admin E2E selectors
 * (`tr[data-booking-id]`) survive verbatim. No money mutation lives on the list
 * (the [id] detail is task #102).
 */
export interface BookingsTableRow {
  id: string
  state: string
  participantCount: number
  grossTotalSnapshot: string | number
  paymentMode: string
  confirmedAt: Date | null
  customerName: string | null
  customerEmail: string | null
  experienceTitle: string
  vendorBusinessName: string
  vendorUserId: string
  slotStart: Date | null
}

const STATE_LABEL: Record<string, string> = {
  pending_payment: 'Pending Payment',
  confirmed: 'Confirmed',
  awaiting_completion: 'Awaiting Completion',
  completed: 'Completed',
  disputed: 'Disputed',
  cancelled_by_customer: 'Cancelled by Customer',
  cancelled_by_vendor: 'Cancelled by Vendor',
  cancelled_post_experience: 'Cancelled Post-Experience',
  no_show: 'No-Show',
}

function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state.replace(/_/g, ' ')
}

function formatDate(date: Date | string | null): string {
  if (!date) return '—'
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const COLUMNS: ReadonlyArray<ResponsiveTableColumn<BookingsTableRow>> = [
  {
    key: 'id',
    header: 'Booking ID',
    primary: true,
    cell: (row) => <span className="font-mono text-xs">{row.id.slice(0, 8)}...</span>,
  },
  {
    key: 'customer',
    header: 'Customer',
    cell: (row) => (
      <span className="text-sm">{row.customerName ?? row.customerEmail ?? '—'}</span>
    ),
  },
  {
    key: 'vendor',
    header: 'Vendor',
    cell: (row) => (
      <Link
        href={`/admin/vendors/${row.vendorUserId}`}
        className="text-sm hover:underline"
      >
        {row.vendorBusinessName}
      </Link>
    ),
  },
  {
    key: 'experience',
    header: 'Experience',
    cell: (row) => (
      <span className="block max-w-[200px] truncate text-sm">{row.experienceTitle}</span>
    ),
  },
  {
    key: 'date',
    header: 'Date',
    cell: (row) => (
      <span className="text-sm text-muted-foreground">
        {row.slotStart ? formatDate(row.slotStart) : formatDate(row.confirmedAt)}
      </span>
    ),
  },
  {
    key: 'guests',
    header: 'Guests',
    align: 'right',
    cell: (row) => <span className="text-sm">{row.participantCount}</span>,
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    cell: (row) => (
      <span className="text-sm font-medium">{formatRupees(row.grossTotalSnapshot)}</span>
    ),
  },
  {
    key: 'paymentMode',
    header: 'Payment Mode',
    cell: (row) => (
      <span className="text-sm capitalize">{row.paymentMode.replace(/_/g, ' ')}</span>
    ),
  },
  {
    key: 'state',
    header: 'State',
    cell: (row) => <AdminStatusBadge status={row.state} label={stateLabel(row.state)} />,
  },
]

export function BookingsTable({ rows }: { rows: BookingsTableRow[] }) {
  return (
    <ResponsiveTable
      columns={COLUMNS}
      rows={rows}
      getRowKey={(row) => row.id}
      rowHref={(row) => `/admin/bookings/${row.id}`}
      rowProps={(row) => ({
        'data-booking-id': row.id,
        'data-booking-state': row.state,
      })}
      caption="All Bookings"
      empty="No bookings found."
    />
  )
}
