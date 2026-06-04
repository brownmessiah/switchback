import { eq } from 'drizzle-orm'
import Link from 'next/link'
import { headers } from 'next/headers'

import { BookingStatusBadge } from '@/components/booking-status-badge'
import { Button } from '@/components/ui/button'
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
import { availabilitySlots, bookings, experiences, users } from '@/db/schema'
import { auth } from '@/lib/auth'
import { bookingStatusBadge } from '@/lib/bookings/booking-status-badge'
import { isNoShowMarkableState } from '@/lib/bookings/state-machine'
import { computeVendorNetPayout } from '@/lib/payments/payout-calculator'

import { VendorTableTabs } from '../vendor-table-tabs'

import { MarkCompleteButton } from './mark-complete-button'
import { MarkNoShowButton } from './mark-no-show-button'
import { VendorCancelButton } from './vendor-cancel-button'

/**
 * English labels for the vendor bookings table (the vendor portal is not yet
 * internationalised — it renders hardcoded English elsewhere on the page).
 * Keyed by the labelKey returned from the shared `bookingStatusBadge` helper so
 * the colour/icon/label triple stays in lockstep with the customer surface.
 */
const STATE_LABEL: Record<string, string> = {
  pending_payment: 'Payment pending',
  confirmed: 'Confirmed',
  awaiting_completion: 'Awaiting completion',
  completed: 'Completed',
  disputed: 'Disputed',
  cancelled_by_customer: 'Cancelled by customer',
  cancelled_by_vendor: 'Cancelled by you',
  cancelled_post_experience: 'Cancelled',
  no_show: 'No-show',
}

/** States in which the vendor can cancel. */
const VENDOR_CANCELLABLE_STATES = new Set(['confirmed', 'awaiting_completion'])

/**
 * Annotate each booking row with whether its slot has already ended, reading
 * the clock ONCE outside the render body (react-hooks/purity — same pattern as
 * the customer dashboard's sortBookingsUpcomingFirst). Drives the no-show
 * button's visibility: a no-show can only be attested after the experience.
 */
function withSlotEnded<T extends { slotEnd: Date | null }>(
  rows: readonly T[],
): Array<T & { slotEnded: boolean }> {
  const now = Date.now()
  return rows.map((r) => ({
    ...r,
    slotEnded: r.slotEnd != null && r.slotEnd.getTime() <= now,
  }))
}

const inr = (n: number) => `₹${Math.floor(n).toLocaleString('en-IN')}`

export default async function VendorBookingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  const rows = withSlotEnded(
    await db
    .select({
      bookingId: bookings.id,
      state: bookings.state,
      participantCount: bookings.participantCount,
      gross: bookings.grossTotalSnapshot,
      commissionRate: bookings.commissionRateSnapshot,
      gstRate: bookings.gstRateOnCommissionSnapshot,
      tdsAmount: bookings.tdsAmountSnapshot,
      tcsAmount: bookings.tcsAmountSnapshot,
      paymentMode: bookings.paymentMode,
      customerName: users.name,
      expTitle: experiences.title,
      slotStart: availabilitySlots.startAt,
      slotEnd: availabilitySlots.endAt,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(users, eq(bookings.customerUserId, users.id))
    .leftJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .where(eq(experiences.vendorUserId, userId))
    .orderBy(bookings.createdAt),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} booking{rows.length === 1 ? '' : 's'}
        </p>
      </div>

      <VendorTableTabs active="bookings" />

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-lg font-medium">No bookings yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Bookings will appear here once customers start booking your experiences.
              </p>
              <Link href="/vendor/listings" className="mt-4">
                <Button variant="outline" size="sm">
                  Manage your listings
                </Button>
              </Link>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Experience</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Guests</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  // Per-Booking deduction trail via the EXISTING payout
                  // calculator (ADR-0016) — re-derives Commission from the
                  // snapshot rate; never re-implements the math.
                  const breakdown = computeVendorNetPayout({
                    grossRupees: Math.floor(Number(row.gross ?? 0)),
                    commissionRatePercent: String(row.commissionRate ?? '20.00'),
                    gstRateOnCommissionPercent: String(row.gstRate ?? '18.00'),
                    tdsRupees: Math.floor(Number(row.tdsAmount ?? 0)),
                    tcsRupees: Math.floor(Number(row.tcsAmount ?? 0)),
                  })
                  const statusLabel =
                    STATE_LABEL[bookingStatusBadge(row.state).labelKey] ??
                    row.state.replace(/_/g, ' ')
                  return (
                    <TableRow
                      key={row.bookingId}
                      data-testid="booking-row"
                      data-booking-id={row.bookingId}
                      data-booking-state={row.state}
                    >
                      <TableCell className="font-medium">
                        {row.customerName ?? 'Customer'}
                      </TableCell>
                      <TableCell className="text-sm">{row.expTitle}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.slotStart
                          ? new Date(row.slotStart).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.participantCount}
                      </TableCell>
                      <TableCell
                        data-testid="booking-gross"
                        className="text-right tabular-nums"
                      >
                        {inr(breakdown.grossRupees)}
                      </TableCell>
                      <TableCell
                        data-testid="booking-commission"
                        className="text-right tabular-nums text-muted-foreground"
                      >
                        -{inr(breakdown.commissionRupees)}
                      </TableCell>
                      <TableCell
                        data-testid="booking-net"
                        className="text-right font-medium tabular-nums"
                      >
                        {inr(breakdown.netPayoutRupees)}
                      </TableCell>
                      <TableCell>
                        <BookingStatusBadge
                          state={row.state}
                          label={statusLabel}
                          className="text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Link href={`/vendor/bookings/${row.bookingId}`}>
                            <Button variant="outline" size="sm">
                              View
                            </Button>
                          </Link>
                          {row.state === 'awaiting_completion' && (
                            <MarkCompleteButton bookingId={row.bookingId} />
                          )}
                          {VENDOR_CANCELLABLE_STATES.has(row.state) && (
                            <VendorCancelButton bookingId={row.bookingId} />
                          )}
                          {isNoShowMarkableState(row.state) && row.slotEnded && (
                            <MarkNoShowButton bookingId={row.bookingId} />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
