'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { BookingStatusBadge } from '@/components/booking-status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import {
  isNoShowMarkableState,
  isVendorCancellableState,
  type BookingState,
} from '@/lib/bookings/state-machine'
import type { BookingDisplayBucket } from '@/lib/vendor/bookings-summary'

import { MarkCompleteButton } from './mark-complete-button'
import { MarkNoShowButton } from './mark-no-show-button'
import { VendorCancelButton } from './vendor-cancel-button'

/**
 * Pre-resolved payout trail for one Booking — the gross → commission → GST →
 * TDS → TCS → net waterfall (ADR-0016), computed server-side via the EXISTING
 * `computeVendorNetPayout` calculator (never re-implemented here) and passed
 * down as already-formatted rupee strings. This trail appears ONLY in the
 * detail drawer; it is deliberately absent from the list card.
 */
export interface BookingPayoutTrail {
  grossLabel: string
  commissionLabel: string
  commissionRatePercent: string
  gstOnCommissionLabel: string
  gstRatePercent: string
  tdsLabel: string
  tcsLabel: string
  netPayoutLabel: string
}

/** One fully-serialized Booking row fed to the client list from the server. */
export interface BookingListRow {
  bookingId: string
  state: BookingState
  statusLabel: string
  customerName: string
  customerEmail: string | null
  customerPhone: string | null
  expTitle: string
  /** Formatted "day month year" of the slot start (or em dash). */
  dateLabel: string
  /** Formatted "HH:MM am/pm" of the slot start (or em dash). */
  timeLabel: string
  /** Formatted full slot window for the drawer (or em dash). */
  slotLabel: string
  participantCount: number
  grossLabel: string
  /** Whether the booked slot's end has already passed (drives no-show action). */
  slotEnded: boolean
  payout: BookingPayoutTrail
}

interface BookingsListProps {
  rows: readonly BookingListRow[]
}

const TABS: ReadonlyArray<{ key: BookingDisplayBucket | 'all'; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
]

type ActiveTab = BookingDisplayBucket | 'all'

/** Map a row's lifecycle state to its display bucket (mirror of the pure module
 *  applied to the client row — the canonical map lives in bookings-summary). */
function rowBucket(state: BookingState): BookingDisplayBucket {
  switch (state) {
    case 'pending_payment':
      return 'pending'
    case 'confirmed':
    case 'awaiting_completion':
    case 'disputed':
      return 'confirmed'
    case 'completed':
      return 'completed'
    case 'cancelled_by_customer':
    case 'cancelled_by_vendor':
    case 'cancelled_post_experience':
    case 'no_show':
      return 'cancelled'
  }
}

export function BookingsList({ rows }: BookingsListProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('pending')
  const [openBookingId, setOpenBookingId] = useState<string | null>(null)

  const visibleRows = useMemo(
    () =>
      activeTab === 'all'
        ? rows
        : rows.filter((row) => rowBucket(row.state) === activeTab),
    [rows, activeTab],
  )

  const openRow = useMemo(
    () => rows.find((row) => row.bookingId === openBookingId) ?? null,
    [rows, openBookingId],
  )

  return (
    <div className="space-y-6">
      {/* Status filter tabs (line variant — DESIGN.md §3). */}
      <nav
        data-testid="bookings-status-tabs"
        aria-label="Filter bookings by status"
        className="flex w-fit flex-wrap items-center gap-1 border-b border-border"
      >
        {TABS.map(({ key, label }) => {
          const isActive = key === activeTab
          return (
            <button
              key={key}
              type="button"
              data-status-tab={key}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => setActiveTab(key)}
              className={cn(
                'min-tap inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px',
                'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-t-md',
                isActive
                  ? 'border-primary-strong text-primary-strong'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          )
        })}
      </nav>

      {visibleRows.length === 0 ? (
        <EmptyState activeTab={activeTab} />
      ) : (
        <ul className="space-y-3" data-testid="bookings-list">
          {visibleRows.map((row) => (
            <li key={row.bookingId}>
              <BookingCard row={row} onViewDetails={() => setOpenBookingId(row.bookingId)} />
            </li>
          ))}
        </ul>
      )}

      <BookingDetailDrawer
        row={openRow}
        onClose={() => setOpenBookingId(null)}
      />
    </div>
  )
}

interface BookingCardProps {
  row: BookingListRow
  onViewDetails: () => void
}

/**
 * One clean horizontal Booking card. Shows ONLY the essentials — Booking ID,
 * customer name, experience, date & time, guests, amount (gross), status badge.
 * The gross/commission/net trail is NOT here; it lives in the detail drawer.
 */
function BookingCard({ row, onViewDetails }: BookingCardProps) {
  return (
    <Card
      size="sm"
      data-testid="booking-row"
      data-booking-id={row.bookingId}
      data-booking-state={row.state}
    >
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{row.customerName}</span>
            <BookingStatusBadge
              state={row.state}
              label={row.statusLabel}
              className="text-xs"
            />
          </div>
          <p className="truncate text-sm text-muted-foreground">{row.expTitle}</p>
          <p className="text-xs text-muted-foreground">
            <span className="tabular-nums">{row.dateLabel}</span>
            {row.timeLabel !== '—' && (
              <>
                {' · '}
                <span className="tabular-nums">{row.timeLabel}</span>
              </>
            )}
            {' · '}
            {row.participantCount} guest{row.participantCount === 1 ? '' : 's'}
            {' · '}
            <span className="font-mono text-2xs">#{row.bookingId.slice(0, 8)}</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <span className="font-medium tabular-nums">{row.grossLabel}</span>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={onViewDetails}
              data-testid="view-details-button"
            >
              View Details
            </Button>
            {row.state === 'awaiting_completion' && (
              <MarkCompleteButton bookingId={row.bookingId} />
            )}
            {isVendorCancellableState(row.state) && (
              <VendorCancelButton bookingId={row.bookingId} />
            )}
            {isNoShowMarkableState(row.state) && row.slotEnded && (
              <MarkNoShowButton bookingId={row.bookingId} />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface EmptyStateProps {
  activeTab: ActiveTab
}

/** Single centered card. Pending uses the exact specified strings; the same
 *  centered-card treatment carries the other tabs. */
function EmptyState({ activeTab }: EmptyStateProps) {
  const heading =
    activeTab === 'pending' || activeTab === 'all'
      ? 'No pending bookings yet'
      : `No ${activeTab} bookings yet`
  return (
    <Card data-testid="bookings-empty">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-lg font-medium">{heading}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          New bookings from customers will appear here for your approval.
        </p>
      </CardContent>
    </Card>
  )
}

interface BookingDetailDrawerProps {
  row: BookingListRow | null
  onClose: () => void
}

/**
 * Detail drawer. Carries the full customer info (name, email, phone,
 * participants, slot) PLUS the complete gross → commission → GST → TDS → TCS →
 * net trail. The trail values were re-derived server-side via
 * `computeVendorNetPayout` (ADR-0016) — this drawer only renders them.
 */
function BookingDetailDrawer({ row, onClose }: BookingDetailDrawerProps) {
  return (
    <Sheet
      open={row != null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-md" data-testid="booking-detail-drawer">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle>Booking details</SheetTitle>
              <SheetDescription>{row.expTitle}</SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-4">
              {/* Status + ID */}
              <div className="flex items-center justify-between gap-3">
                <BookingStatusBadge state={row.state} label={row.statusLabel} className="text-xs" />
                <span className="font-mono text-2xs text-muted-foreground">
                  #{row.bookingId.slice(0, 8)}
                </span>
              </div>

              {/* Customer info */}
              <section className="space-y-2">
                <h3 className="text-2xs font-medium uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
                  Customer
                </h3>
                <dl className="divide-y divide-border text-sm">
                  <DrawerRow label="Name" value={row.customerName} />
                  <DrawerRow label="Email" value={row.customerEmail ?? '—'} />
                  <DrawerRow label="Phone" value={row.customerPhone ?? '—'} />
                  <DrawerRow label="Guests" value={String(row.participantCount)} />
                  <DrawerRow label="Slot" value={row.slotLabel} />
                </dl>
              </section>

              <Separator />

              {/* Payout trail — re-derived server-side via computeVendorNetPayout. */}
              <section className="space-y-2" data-testid="booking-payout-trail">
                <h3 className="text-2xs font-medium uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
                  Payout
                </h3>
                <dl className="divide-y divide-border text-sm">
                  <DrawerRow label="Gross Total" value={row.payout.grossLabel} bold />
                  <DrawerRow
                    label={`Commission (${row.payout.commissionRatePercent}%)`}
                    value={`-${row.payout.commissionLabel}`}
                    muted
                  />
                  <DrawerRow
                    label={`GST on Commission (${row.payout.gstRatePercent}%)`}
                    value={`-${row.payout.gstOnCommissionLabel}`}
                    muted
                  />
                  <DrawerRow label="TDS (0.1%, Sec 194-O)" value={`-${row.payout.tdsLabel}`} muted />
                  <DrawerRow label="GST TCS (0.5%, Sec 52)" value={`-${row.payout.tcsLabel}`} muted />
                  <DrawerRow label="Net Payout" value={row.payout.netPayoutLabel} bold />
                </dl>
              </section>

              <Link href={`/vendor/bookings/${row.bookingId}`} className="block">
                <Button variant="outline" size="sm" className="w-full">
                  Open full booking page
                </Button>
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function DrawerRow({
  label,
  value,
  muted,
  bold,
}: {
  label: string
  value: string
  muted?: boolean
  bold?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 py-2',
        muted && 'text-muted-foreground',
      )}
    >
      <dt>{label}</dt>
      <dd className={cn('text-right tabular-nums', bold && 'font-medium')}>{value}</dd>
    </div>
  )
}
