import { eq } from 'drizzle-orm'
import { QrCode } from 'lucide-react'
import { headers } from 'next/headers'
import Link from 'next/link'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { db } from '@/db/client'
import { availabilitySlots, bookings, experiences, users } from '@/db/schema'
import { auth } from '@/lib/auth'
import { bookingStatusBadge } from '@/lib/bookings/booking-status-badge'
import { type BookingState } from '@/lib/bookings/state-machine'
import { computeVendorNetPayout } from '@/lib/payments/payout-calculator'
import {
  summarizeBookings,
  type BookingDisplayBucket,
} from '@/lib/vendor/bookings-summary'

import { VendorTableTabs } from '../vendor-table-tabs'

import { BookingsList, type BookingListRow } from './bookings-list'

/**
 * English labels for the vendor bookings surface (the vendor portal is not yet
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

const inr = (n: number) => `₹${Math.floor(n).toLocaleString('en-IN')}`

const formatDateLabel = (slotStart: Date | null) =>
  slotStart
    ? new Date(slotStart).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—'

const formatTimeLabel = (slotStart: Date | null) =>
  slotStart
    ? new Date(slotStart).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

const formatSlotWindow = (slotStart: Date | null, slotEnd: Date | null) => {
  if (!slotStart) return '—'
  const start = `${formatDateLabel(slotStart)}, ${formatTimeLabel(slotStart)}`
  return slotEnd ? `${start} — ${formatTimeLabel(slotEnd)}` : start
}

/**
 * Annotate each raw row with whether its slot has already ended, reading the
 * clock ONCE inside this helper (react-hooks/purity — `Date.now()` cannot be
 * called directly in the render body; same pattern as the prior `withSlotEnded`
 * and the customer dashboard's `sortBookingsUpcomingFirst`). Drives the no-show
 * action's visibility: a no-show can only be attested after the experience.
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

/** Summary-card definitions — one per display bucket, in lifecycle order. */
const SUMMARY_CARDS: ReadonlyArray<{
  readonly bucket: BookingDisplayBucket
  readonly label: string
}> = [
  { bucket: 'pending', label: 'Pending' },
  { bucket: 'confirmed', label: 'Confirmed' },
  { bucket: 'completed', label: 'Completed' },
  { bucket: 'cancelled', label: 'Cancelled' },
]

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
      customerName: users.name,
      customerEmail: users.email,
      customerPhone: users.phoneNumber,
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

  // Build the fully-serialized rows the client list renders. The complete
  // deduction trail is re-derived here via the EXISTING payout calculator
  // (ADR-0016 — never re-implemented) and carried into the drawer ONLY; the
  // list cards never show it.
  const rows: BookingListRow[] = rawRows.map((row) => {
    const commissionRatePercent = String(row.commissionRate ?? '20.00')
    const gstRatePercent = String(row.gstRate ?? '18.00')
    const breakdown = computeVendorNetPayout({
      grossRupees: Math.floor(Number(row.gross ?? 0)),
      commissionRatePercent,
      gstRateOnCommissionPercent: gstRatePercent,
      tdsRupees: Math.floor(Number(row.tdsAmount ?? 0)),
      tcsRupees: Math.floor(Number(row.tcsAmount ?? 0)),
    })

    return {
      bookingId: row.bookingId,
      state: row.state,
      statusLabel:
        STATE_LABEL[bookingStatusBadge(row.state).labelKey] ??
        row.state.replace(/_/g, ' '),
      customerName: row.customerName ?? 'Customer',
      customerEmail: row.customerEmail ?? null,
      customerPhone: row.customerPhone ?? null,
      expTitle: row.expTitle,
      dateLabel: formatDateLabel(row.slotStart),
      timeLabel: formatTimeLabel(row.slotStart),
      slotLabel: formatSlotWindow(row.slotStart, row.slotEnd),
      participantCount: row.participantCount,
      grossLabel: inr(breakdown.grossRupees),
      slotEnded: row.slotEnded,
      payout: {
        grossLabel: inr(breakdown.grossRupees),
        commissionLabel: inr(breakdown.commissionRupees),
        commissionRatePercent: String(Number(commissionRatePercent)),
        gstOnCommissionLabel: inr(breakdown.gstOnCommissionRupees),
        gstRatePercent: String(Number(gstRatePercent)),
        tdsLabel: inr(breakdown.tdsRupees),
        tcsLabel: inr(breakdown.tcsRupees),
        netPayoutLabel: inr(breakdown.netPayoutRupees),
      },
    }
  })

  const summary = summarizeBookings(rawRows.map((r) => r.state as BookingState))

  return (
    <div className="space-y-6">
      {/* Title row — the header action slot carries the Scan-QR entry point to
          the check-in scanner (issue 06). Hardcoded English, matching this
          page's existing (not-yet-i18n'd) convention; the /vendor/checkin page
          itself is fully localized. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Bookings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review and manage incoming bookings
          </p>
        </div>
        <Link
          href="/vendor/checkin"
          className={buttonVariants({ variant: 'outline', className: 'shrink-0' })}
        >
          <QrCode aria-hidden="true" />
          Scan QR
        </Link>
      </div>

      <VendorTableTabs active="bookings" />

      {/* Four status summary cards. */}
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        data-testid="bookings-summary-cards"
      >
        {SUMMARY_CARDS.map(({ bucket, label }) => (
          <Card key={bucket} size="sm" data-summary-bucket={bucket}>
            <CardContent className="space-y-1">
              <p className="text-2xs font-medium uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
                {label}
              </p>
              <p className="font-heading text-2xl font-semibold tabular-nums">
                {summary[bucket]}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <BookingsList rows={rows} />
    </div>
  )
}
