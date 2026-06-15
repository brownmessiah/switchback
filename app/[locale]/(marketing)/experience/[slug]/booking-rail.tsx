import type { ReactElement } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import type { CalendarSlot } from '@/lib/experiences/booking-calendar'

import { BookingRailInteractive } from './booking-rail-interactive'
import type { BookingRailToastLabels } from './booking-rail-interactive'
import type { BookingCalendarLabels } from './booking-calendar'

/** One Group-size bracket row in the per-participant price table. */
export interface BookingRailBracket {
  /** Already-translated bracket label, e.g. "1-2 participants". */
  label: string
  /** Per-person price in whole rupees. */
  priceRupees: number
}

/**
 * One active pricing variation offered in the PDP selector (issue #08). The
 * `name` / `description` are the Vendor-authored copy (already
 * locale-independent listing content). Selecting it drives the shown per-person
 * price and is submitted as `variationId`; the SERVER resolves + snapshots the
 * authoritative price (the client never sends a price).
 */
export interface BookingRailVariation {
  id: string
  name: string
  description: string | null
  /** Per-person price in whole rupees (display only). */
  priceRupees: number
  /** Optional per-variation duration override in minutes, or null. */
  durationMinutes: number | null
}

/** Already-translated labels for the pricing-variation selector. */
export interface BookingRailVariationLabels {
  /** Selector heading, e.g. "Choose an option". */
  heading: string
  /** The default "Standard (group pricing)" option label when no variation is picked. */
  standardOption: string
  /** "/ person" suffix shown beside each option price. */
  perPerson: string
  /** Duration-suffix formatter token, e.g. "· {minutes} min". */
  durationSuffix: string
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
  /** Already-translated "Explore similar experiences" CTA label. */
  exploreSimilarLabel: string
  /** Where the explore CTA lands (same-Region /search, always live). */
  exploreSimilarHref: string
}

interface BookingRailProps {
  /** Already-translated module heading (`pricing.heading`). */
  heading: string
  /** Already-translated "per-participant price table" caption. */
  priceTableLabel: string
  /** Ordered 1-2 / 3-5 / 6+ Group-size brackets. */
  brackets: ReadonlyArray<BookingRailBracket>
  /**
   * Active pricing variations (issue #08). When non-empty the rail renders a
   * selector; selecting one drives the per-person price + the submitted
   * `variationId`. Empty → no selector, brackets render exactly as before.
   */
  variations?: ReadonlyArray<BookingRailVariation>
  /** Already-translated variation-selector labels (present when variations exist). */
  variationLabels?: BookingRailVariationLabels
  /** Already-translated "/ person" suffix (`pricing.perPerson`). */
  perPersonLabel: string
  /** Already-translated "Participants" selector label (`pricing.participants`). */
  participantsLabel: string
  /** Already-translated "Total" label (`pricing.total`). */
  totalLabel: string
  /** Upper bound for the participant stepper (Experience max group size). */
  maxParticipants: number
  /** Partial-pay split labels — present only when the Experience allows partial pay. */
  partialPay?: {
    /** Already-translated "Live price breakdown" caption. */
    breakdownLabel: string
    /** Already-translated info notice (`pricing.partialPay`). */
    notice: string
    /** Already-translated "Advance due now (25%)" label. */
    advanceLabel: string
    /** Already-translated "Balance at T-24h" label. */
    balanceLabel: string
    /** Already-translated refundable/cancellation pointer (issue 13). */
    refundablePointer: string
    /** Already-translated "charged in full now" carve-out notice (issue 13). */
    fullUpfrontNotice: string
  }
  /** Already-translated "Free cancellation · 24h refund SLA" line. */
  freeCancellation: string
  /** Already-translated "Book now" CTA label. */
  bookNowLabel: string
  /** Base checkout deep link; the selected slot + participant count are appended. */
  checkoutHref: string
  /** Future bookable slots powering the date picker (#70). */
  slots: CalendarSlot[]
  /** Active locale — Intl month/weekday names in the calendar. */
  locale: string
  /** Already-translated calendar labels. */
  calendarLabels: BookingCalendarLabels
  /** When set, booking is paused (ADR-0011 Region closure) and the CTA disabled. */
  closure?: BookingRailClosure | null
  /** Already-translated booking-flow toast copy (issue 24). */
  toastLabels: BookingRailToastLabels
  /** True when the Availability feed failed to load (issue 24). */
  availabilityError?: boolean
}

/**
 * BookingRail — the persistent sticky B3 Booking module
 * (Direction B "Conversion-dense sticky-rail", #65 / DESIGN.md §4 B3).
 *
 * Thin Server-Component shell (Card chrome + heading); the interactive body —
 * the participant stepper that drives the Group-size bracket price and the live
 * Partial-pay Advance/balance split (ADR-0011 + ADR-0001) — is the client island
 * `BookingRailInteractive`. The stickiness is pure CSS `position: sticky` set by
 * the page on the rail's column wrapper, so the shell stays SSR-friendly.
 */
export function BookingRail({
  heading,
  priceTableLabel,
  brackets,
  variations,
  variationLabels,
  perPersonLabel,
  participantsLabel,
  totalLabel,
  maxParticipants,
  partialPay,
  freeCancellation,
  bookNowLabel,
  checkoutHref,
  slots,
  locale,
  calendarLabels,
  closure,
  toastLabels,
  availabilityError,
}: BookingRailProps): ReactElement {
  return (
    <Card className="gap-5 py-5 shadow-md ring-foreground/[0.08]">
      <CardHeader>
        <CardTitle className="font-heading text-h3 font-semibold tracking-tight">
          {heading}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <BookingRailInteractive
          priceTableLabel={priceTableLabel}
          brackets={brackets}
          variations={variations}
          variationLabels={variationLabels}
          perPersonLabel={perPersonLabel}
          participantsLabel={participantsLabel}
          totalLabel={totalLabel}
          maxParticipants={maxParticipants}
          partialPay={partialPay}
          freeCancellation={freeCancellation}
          bookNowLabel={bookNowLabel}
          checkoutHref={checkoutHref}
          slots={slots}
          locale={locale}
          calendarLabels={calendarLabels}
          closure={closure}
          toastLabels={toastLabels}
          availabilityError={availabilityError}
        />
      </CardContent>
    </Card>
  )
}
