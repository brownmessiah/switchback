import Link from 'next/link'

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
import { formatRupees } from '../_components/money'

/**
 * #89 — the admin bookings LIST as a rigorous DESIGN.md §4 A3 table:
 *  - semantic `AdminStatusBadge` per Booking state (status color + paired icon,
 *    never color alone — DESIGN.md §1.3 / §5)
 *  - amount column right-aligned in `.tabular-nums` (DESIGN.md §1.3 / §2.2)
 *  - each row links to its `/admin/bookings/[id]` detail (B6 master → detail)
 *
 * No money mutation lives on the list (the [id] detail is task #102). The
 * presentational table is split out so it is unit-testable in isolation; the
 * page owns the data load + the `BookingFilters` toolbar.
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
  confirmed: 'Confirmed',
  awaiting_completion: 'Awaiting Completion',
  completed: 'Completed',
  disputed: 'Disputed',
  cancelled_by_customer: 'Cancelled by Customer',
  cancelled_by_vendor: 'Cancelled by Vendor',
  cancelled_post_experience: 'Cancelled Post-Experience',
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

export function BookingsTable({ rows }: { rows: BookingsTableRow[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <caption className="sr-only">All Bookings</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Booking ID</TableHead>
              <TableHead scope="col">Customer</TableHead>
              <TableHead scope="col">Vendor</TableHead>
              <TableHead scope="col">Experience</TableHead>
              <TableHead scope="col">Date</TableHead>
              <TableHead scope="col" className="text-right">
                Guests
              </TableHead>
              <TableHead scope="col" className="text-right">
                Amount
              </TableHead>
              <TableHead scope="col">Payment Mode</TableHead>
              <TableHead scope="col">State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  No bookings found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-booking-id={row.id}
                  data-booking-state={row.state}
                  className="hover:bg-muted/50"
                >
                  <TableCell className="font-mono text-xs">
                    <Link href={`/admin/bookings/${row.id}`} className="hover:underline">
                      {row.id.slice(0, 8)}...
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.customerName ?? row.customerEmail ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Link
                      href={`/admin/vendors/${row.vendorUserId}`}
                      className="hover:underline"
                    >
                      {row.vendorBusinessName}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm">
                    {row.experienceTitle}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.slotStart ? formatDate(row.slotStart) : formatDate(row.confirmedAt)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {row.participantCount}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium tabular-nums">
                    {formatRupees(row.grossTotalSnapshot)}
                  </TableCell>
                  <TableCell className="text-sm capitalize">
                    {row.paymentMode.replace(/_/g, ' ')}
                  </TableCell>
                  <TableCell>
                    <AdminStatusBadge status={row.state} label={stateLabel(row.state)} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
