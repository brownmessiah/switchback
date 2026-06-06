import { eq } from 'drizzle-orm'
import Link from 'next/link'
import { headers } from 'next/headers'

import { BookingStatusBadge } from '@/components/booking-status-badge'
import { Button } from '@/components/ui/button'
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from '@/components/ui/responsive-table'
import { db } from '@/db/client'
import { availabilitySlots, bookings, experiences, users } from '@/db/schema'
import { auth } from '@/lib/auth'
import { bookingStatusBadge } from '@/lib/bookings/booking-status-badge'
import { type BookingState, isNoShowMarkableState } from '@/lib/bookings/state-machine'
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

/**
 * One fully-resolved bookings-table row: the raw query fields plus the
 * per-Booking deduction trail (re-derived via the EXISTING payout calculator,
 * ADR-0016 — never re-implements the math) and the human status label. Built
 * once on the server so the `<ResponsiveTable>` column `cell()` closures stay
 * pure presentation.
 */
interface BookingTableRow {
  bookingId: string
  state: BookingState
  customerName: string | null
  expTitle: string
  slotStart: Date | null
  slotEnded: boolean
  participantCount: number
  grossRupees: number
  commissionRupees: number
  netPayoutRupees: number
  statusLabel: string
}

const formatBookingDate = (slotStart: Date | null) =>
  slotStart
    ? new Date(slotStart).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—'

export default async function VendorBookingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  const rawRows = withSlotEnded(
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

  // Resolve every row's deduction trail + status label on the server (ADR-0016
  // via the shared calculator) so the table config below is pure presentation.
  const rows: BookingTableRow[] = rawRows.map((row) => {
    const breakdown = computeVendorNetPayout({
      grossRupees: Math.floor(Number(row.gross ?? 0)),
      commissionRatePercent: String(row.commissionRate ?? '20.00'),
      gstRateOnCommissionPercent: String(row.gstRate ?? '18.00'),
      tdsRupees: Math.floor(Number(row.tdsAmount ?? 0)),
      tcsRupees: Math.floor(Number(row.tcsAmount ?? 0)),
    })
    return {
      bookingId: row.bookingId,
      state: row.state,
      customerName: row.customerName,
      expTitle: row.expTitle,
      slotStart: row.slotStart,
      slotEnded: row.slotEnded,
      participantCount: row.participantCount,
      grossRupees: breakdown.grossRupees,
      commissionRupees: breakdown.commissionRupees,
      netPayoutRupees: breakdown.netPayoutRupees,
      statusLabel:
        STATE_LABEL[bookingStatusBadge(row.state).labelKey] ??
        row.state.replace(/_/g, ' '),
    }
  })

  const columns: ReadonlyArray<ResponsiveTableColumn<BookingTableRow>> = [
    {
      key: 'customer',
      header: 'Customer',
      primary: true,
      cell: (row) => row.customerName ?? 'Customer',
    },
    {
      key: 'experience',
      header: 'Experience',
      cell: (row) => row.expTitle,
    },
    {
      key: 'date',
      header: 'Date',
      cell: (row) => formatBookingDate(row.slotStart),
    },
    {
      key: 'guests',
      header: 'Guests',
      align: 'right',
      cell: (row) => row.participantCount,
    },
    {
      key: 'gross',
      header: 'Gross',
      align: 'right',
      cell: (row) => (
        <span data-testid="booking-gross">{inr(row.grossRupees)}</span>
      ),
    },
    {
      key: 'commission',
      header: 'Commission',
      align: 'right',
      cell: (row) => (
        <span
          data-testid="booking-commission"
          className="text-muted-foreground"
        >
          -{inr(row.commissionRupees)}
        </span>
      ),
    },
    {
      key: 'net',
      header: 'Net',
      align: 'right',
      cell: (row) => (
        <span
          data-testid="booking-net"
          className="font-medium tabular-nums"
        >
          {inr(row.netPayoutRupees)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <BookingStatusBadge
          state={row.state}
          label={row.statusLabel}
          className="text-xs"
        />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-2">
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
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} booking{rows.length === 1 ? '' : 's'}
        </p>
      </div>

      <VendorTableTabs active="bookings" />

      <ResponsiveTable<BookingTableRow>
        caption="Your bookings"
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.bookingId}
        rowHref={(row) => `/vendor/bookings/${row.bookingId}`}
        rowProps={(row) => ({
          'data-testid': 'booking-row',
          'data-booking-id': row.bookingId,
          'data-booking-state': row.state,
        })}
        empty={
          <div className="flex flex-col items-center justify-center text-center">
            <p className="text-lg font-medium">No bookings yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Bookings will appear here once customers start booking your
              experiences.
            </p>
            <Link href="/vendor/listings" className="mt-4">
              <Button variant="outline" size="sm">
                Manage your listings
              </Button>
            </Link>
          </div>
        }
      />
    </div>
  )
}
