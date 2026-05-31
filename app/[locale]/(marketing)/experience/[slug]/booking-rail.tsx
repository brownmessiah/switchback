import type { ReactElement } from 'react'

import Link from 'next/link'
import { CalendarX, CircleCheck, Clock, Info, Wallet } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

/** One Group-size bracket row in the per-participant price table. */
export interface BookingRailBracket {
  /** Already-translated bracket label, e.g. "1-2 participants". */
  label: string
  /** Per-person price in whole rupees. */
  priceRupees: number
}

export interface BookingRailClosure {
  /** Already-translated "Currently closed" heading. */
  heading: string
  /** Vendor/admin-supplied closure reason. */
  reason: string
  /** Already-translated, date-interpolated "Reopens {date}" line. */
  reopens: string
  /** Already-translated "Booking is paused…" helper. */
  bookingDisabled: string
}

interface BookingRailProps {
  /** Already-translated module heading (`pricing.heading`). */
  heading: string
  /** Already-translated "per-participant price table" caption. */
  priceTableLabel: string
  brackets: ReadonlyArray<BookingRailBracket>
  /** Already-translated "/ person" suffix (`pricing.perPerson`). */
  perPersonLabel: string
  /** Partial-pay split — present only when the Experience allows partial pay. */
  partialPay?: {
    /** Already-translated "Live price breakdown" caption. */
    breakdownLabel: string
    /** Already-translated info notice (`pricing.partialPay`). */
    notice: string
    /** Already-translated "Advance due now (25%)" label. */
    advanceLabel: string
    advanceRupees: number
    /** Already-translated "Balance at T-24h" label. */
    balanceLabel: string
    balanceRupees: number
  }
  /** Already-translated "Free cancellation · 24h refund SLA" line. */
  freeCancellation: string
  /** Already-translated "Book now" CTA label. */
  bookNowLabel: string
  /** Destination href for the Book-now CTA (checkout deep link). */
  checkoutHref: string
  /** When set, booking is paused (ADR-0011 Region closure) and the CTA disabled. */
  closure?: BookingRailClosure | null
}

function formatRupees(amount: number): string {
  return amount.toLocaleString('en-IN')
}

/**
 * BookingRail — the persistent sticky B3 Booking module
 * (Direction B "Conversion-dense sticky-rail", #65 / DESIGN.md §4 B3).
 *
 * A presentational Server Component (no client interactivity): the stickiness
 * is pure CSS `position: sticky` set by the page on the rail's column wrapper,
 * so it is fully SSR-compatible. It restates the Group-size bracket pricing,
 * the live Partial-pay Advance/balance split, and the Book-now CTA — all kept
 * permanently in view before commit. ADR-0011: an active Region closure pauses
 * booking and disables the CTA.
 *
 * Money is `.tabular-nums` (DESIGN.md §1.3). Status pairs colour WITH an icon,
 * never colour alone (DESIGN.md §1.3 / §5). Coral renders only as a fill on the
 * Book-now button (`--primary`), never as low-contrast text.
 */
export function BookingRail({
  heading,
  priceTableLabel,
  brackets,
  perPersonLabel,
  partialPay,
  freeCancellation,
  bookNowLabel,
  checkoutHref,
  closure,
}: BookingRailProps): ReactElement {
  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="text-h3">{heading}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Per-participant Group-size bracket price table (ADR-0011). */}
        <div>
          <p className="mb-2 text-xs text-muted-foreground">{priceTableLabel}</p>
          <dl className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
            {brackets.map((bracket) => (
              <div
                key={bracket.label}
                className="flex items-baseline justify-between px-3 py-2"
              >
                <dt className="text-sm text-muted-foreground">{bracket.label}</dt>
                <dd className="text-sm font-semibold tabular-nums">
                  ₹{formatRupees(bracket.priceRupees)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {perPersonLabel}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Live price breakdown — Partial-pay Advance/balance split (B3). The
            money-moment: Advance due now (25%) vs balance auto-captured at
            T-24h, shown before commit. Info-coloured + icon (never colour
            alone). */}
        {partialPay && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">
              {partialPay.breakdownLabel}
            </p>
            <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-info-subtle px-3 py-2 text-xs text-info">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{partialPay.notice}</span>
            </p>
            <dl className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Wallet
                    aria-hidden="true"
                    className="size-4 shrink-0 text-info"
                  />
                  {partialPay.advanceLabel}
                </dt>
                <dd className="text-sm font-semibold tabular-nums">
                  ₹{formatRupees(partialPay.advanceRupees)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Clock
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  {partialPay.balanceLabel}
                </dt>
                <dd className="text-sm font-semibold tabular-nums">
                  ₹{formatRupees(partialPay.balanceRupees)}
                </dd>
              </div>
            </dl>
          </div>
        )}

        <Separator />

        {closure ? (
          <>
            {/* ADR-0011: an active Region closure pauses booking and is
                surfaced inline (warning + icon), disabling the CTA. */}
            <div
              role="status"
              className="space-y-1 rounded-[var(--radius-md)] border border-warning/30 bg-warning-subtle p-3 text-sm"
            >
              <p className="flex items-center gap-1.5 font-medium text-warning">
                <CalendarX aria-hidden="true" className="size-4 shrink-0" />
                {closure.heading}
              </p>
              <p className="text-muted-foreground">{closure.reason}</p>
              <p className="text-xs text-muted-foreground">{closure.reopens}</p>
            </div>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className={buttonVariants({
                size: 'lg',
                className: 'w-full cursor-not-allowed opacity-60',
              })}
            >
              {bookNowLabel}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              {closure.bookingDisabled}
            </p>
          </>
        ) : (
          <>
            <Link
              href={checkoutHref}
              className={buttonVariants({ size: 'lg', className: 'w-full' })}
            >
              {bookNowLabel}
            </Link>
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-success">
              <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
              {freeCancellation}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
