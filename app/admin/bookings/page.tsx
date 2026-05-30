import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'

import { BookingFilters } from './booking-filters'
import {
  loadBookingsList,
  loadExperiencesForFilter,
  loadVendorsForFilter,
  type BookingListFilters,
} from './loaders'

// ── Variant maps ───────────────────────────────────────────────────

const STATE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  confirmed: 'default',
  awaiting_completion: 'secondary',
  completed: 'default',
  cancelled_by_customer: 'destructive',
  cancelled_by_vendor: 'destructive',
  disputed: 'destructive',
  cancelled_post_experience: 'destructive',
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatCurrency(amount: string | number): string {
  const rupees = Math.floor(Number(amount))
  return `₹${rupees.toLocaleString('en-IN')}`
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

// ── Page ────────────────────────────────────────────────────────────

interface AdminBookingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AdminBookingsPage({ searchParams }: AdminBookingsPageProps) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()
  await requirePermission(db, session.user.id, 'bookings')

  const params = await searchParams
  const filters: BookingListFilters = {
    state: typeof params.state === 'string' ? params.state : undefined,
    dateFrom: typeof params.dateFrom === 'string' ? params.dateFrom : undefined,
    dateTo: typeof params.dateTo === 'string' ? params.dateTo : undefined,
    vendorUserId: typeof params.vendor === 'string' ? params.vendor : undefined,
    experienceId: typeof params.experience === 'string' ? params.experience : undefined,
  }

  const [rows, vendors, experiencesList] = await Promise.all([
    loadBookingsList(db, filters),
    loadVendorsForFilter(db),
    loadExperiencesForFilter(db),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">All Bookings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} booking{rows.length === 1 ? '' : 's'}
          {Object.values(filters).some(Boolean) ? ' (filtered)' : ''}
        </p>
      </div>

      <BookingFilters
        currentFilters={filters}
        vendors={vendors}
        experiences={experiencesList}
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Booking ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Experience</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Guests</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Payment Mode</TableHead>
                <TableHead>State</TableHead>
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
                  >
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/admin/bookings/${row.id}`}
                        className="hover:underline"
                      >
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
                    <TableCell className="text-sm max-w-[200px] truncate">
                      {row.experienceTitle}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.slotStart ? formatDate(row.slotStart) : formatDate(row.confirmedAt)}
                    </TableCell>
                    <TableCell className="text-sm">{row.participantCount}</TableCell>
                    <TableCell className="text-sm font-medium">
                      {formatCurrency(row.grossTotalSnapshot)}
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {row.paymentMode.replace(/_/g, ' ')}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={STATE_VARIANTS[row.state] ?? 'outline'}
                        className="capitalize text-xs"
                      >
                        {row.state.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
