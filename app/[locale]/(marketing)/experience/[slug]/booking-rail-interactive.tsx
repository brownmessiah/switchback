'use client'

import { useEffect, useState, type ReactElement } from 'react'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { CalendarX, CircleCheck, Clock, Info, Users, Wallet } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { ParticipantsStepper } from '@/components/search/participants-stepper'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import {
  bracketKeyFor,
  computeBookingPrice,
  resolveDisplaySplit,
  type BracketPrices,
} from '@/lib/experiences/booking-price'
import {
  dateKey,
  firstBookableSlotId,
  maxBookableParticipants,
  slotsByDate,
  type CalendarSlot,
} from '@/lib/experiences/booking-calendar'

import { BookingCalendar, type BookingCalendarLabels } from './booking-calendar'
import { TimeSlotList } from './time-slot-list'
import type {
  BookingRailBracket,
  BookingRailClosure,
  BookingRailVariation,
  BookingRailVariationLabels,
} from './booking-rail'

export interface BookingRailInteractiveProps {
  priceTableLabel: string
  /** Ordered 1-2 / 3-5 / 6+ brackets (already-translated labels + prices). */
  brackets: ReadonlyArray<BookingRailBracket>
  /**
   * Active pricing variations (issue #08). When non-empty the rail renders a
   * selector; selecting one drives the per-person price + the submitted
   * `variationId`. Empty / absent → no selector, brackets render as before.
   */
  variations?: ReadonlyArray<BookingRailVariation>
  /** Already-translated variation-selector labels (present when variations exist). */
  variationLabels?: BookingRailVariationLabels
  perPersonLabel: string
  /** Already-translated "Participants" selector label. */
  participantsLabel: string
  /** Already-translated "Total" label. */
  totalLabel: string
  /** Upper bound for the participant stepper. */
  maxParticipants: number
  /** Partial-pay split labels — present only when the Experience allows it. */
  partialPay?: {
    breakdownLabel: string
    notice: string
    advanceLabel: string
    balanceLabel: string
    /** Already-translated refundable/cancellation pointer (no fabricated number). */
    refundablePointer: string
    /**
     * Already-translated "Charged in full now" notice shown under the ADR-0001
     * carve-outs (slot <48h away, or total > Rs.25,000).
     */
    fullUpfrontNotice: string
  }
  freeCancellation: string
  bookNowLabel: string
  /** Base checkout deep link; the selected slot + participant count are appended. */
  checkoutHref: string
  /** Future bookable slots powering the date picker (#70). */
  slots: CalendarSlot[]
  /** Active locale (Intl month/weekday names). */
  locale: string
  /** Already-translated calendar labels. */
  calendarLabels: BookingCalendarLabels
  closure?: BookingRailClosure | null
  /**
   * Already-translated toast copy for the booking flow (issue 24). Fired when a
   * date / time slot is chosen, when the booking is started, and (on mount) when
   * availability failed to load.
   */
  toastLabels: BookingRailToastLabels
  /**
   * True when the server could not load the Availability slots for this
   * Experience — surfaces an error toast on mount so the customer knows the
   * pickers are stale rather than empty (issue 24).
   */
  availabilityError?: boolean
}

export interface BookingRailToastLabels {
  /** Fired when a date is chosen on the calendar. */
  dateSelected: string
  /** Fired when a time slot ("date & time slot") is chosen. */
  slotSelected: string
  /** Fired when the Book-now CTA is clicked (booking started). */
  bookingStarted: string
  /** Fired on mount when the Availability feed failed to load. */
  availabilityError: string
}

function formatRupees(amount: number): string {
  return amount.toLocaleString('en-IN')
}

/**
 * Interactive Booking-rail body (client island). A participant stepper drives
 * the Group-size bracket selection (ADR-0011) and the live Partial-pay
 * Advance/balance split (ADR-0001) — both recompute as the count changes via
 * the pure `computeBookingPrice` helper (the authoritative price is still
 * resolved + snapshotted server-side at Booking-create). The selected count is
 * carried into the Checkout deep link. When a Region closure is active the
 * stepper + CTA are disabled (booking paused).
 */
export function BookingRailInteractive({
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
  availabilityError = false,
}: BookingRailInteractiveProps): ReactElement {
  const t = useTranslations('ExperiencePage')

  // Surface a single error toast on mount when the Availability feed failed to
  // load (issue 24). The pickers still render with whatever slots resolved.
  //
  // a11y (ADR-0018): a load failure deserves ASSERTIVE urgency. sonner's only
  // live region is the container's `aria-live="polite"` and it exposes no
  // per-toast role/assertive option (v2), so we render the message body as its
  // own `role="alert"` element — screen readers interrupt, and the toast is
  // discoverable via `getByRole('alert')`. The toast chrome (close button,
  // styling) is unchanged.
  //
  // The toast is deferred to a macrotask: this island's mount `useEffect` can
  // run BEFORE the root-layout <Toaster> subscribes to sonner's ToastState on
  // first hydration, in which case a synchronous `toast.error()` is enqueued
  // with no subscriber and silently dropped. Firing it on the next tick lets the
  // Toaster subscribe first, so the on-mount error reliably paints.
  useEffect(() => {
    if (!availabilityError) return
    const id = setTimeout(() => {
      toast.error(<span role="alert">{toastLabels.availabilityError}</span>)
    }, 0)
    return () => clearTimeout(id)
  }, [availabilityError, toastLabels.availabilityError])
  const max = Math.max(1, maxParticipants)
  const byDate = slotsByDate(slots)

  // Date → time-slot → participants. A date is chosen on the calendar; that
  // date's time slots appear below; the chosen slot's remaining seats (its max
  // attendees minus what's booked) bounds the participant stepper, so a booking
  // can never exceed a slot's capacity (booking-create enforces the same).
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    slots.length ? dateKey(new Date(slots[0].startAtISO)) : null,
  )
  const slotsForSelectedDate = (selectedDate && byDate.get(selectedDate)) || []
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(() =>
    firstBookableSlotId(slotsForSelectedDate),
  )
  const [count, setCount] = useState(1)
  const disabled = Boolean(closure)

  // Pricing-variation selection (issue #08). `null` = the standard group-pricing
  // option (the brackets drive the price). When a variation is selected its flat
  // per-person price replaces the bracket price and its id is submitted as
  // `variationId` — the SERVER resolves + snapshots the authoritative price.
  const activeVariations = variations ?? []
  const hasVariations = activeVariations.length > 0
  const [selectedVariationId, setSelectedVariationId] = useState<string | null>(null)
  const selectedVariation =
    activeVariations.find((v) => v.id === selectedVariationId) ?? null

  const selectedSlot = slots.find((s) => s.id === selectedSlotId) ?? null
  const slotRemaining = selectedSlot?.remaining ?? max
  const maxForSlot = Math.max(1, maxBookableParticipants(slotRemaining, max))
  // The slot's seats are the binding limit (tighter than the group-size cap).
  const slotLimited = selectedSlot != null && selectedSlot.remaining < max

  const prices: BracketPrices = {
    p12: brackets[0]?.priceRupees ?? 0,
    p35: brackets[1]?.priceRupees ?? brackets[0]?.priceRupees ?? 0,
    p6: brackets[2]?.priceRupees ?? brackets[0]?.priceRupees ?? 0,
  }
  // When a variation is selected, its flat per-person price replaces the
  // bracket price (issue #08). We feed that flat price into all three bracket
  // slots so the Partial-pay Advance/balance split still derives from the same
  // pure helper (the variation is flat per-person — no group-size laddering).
  const effectivePrices: BracketPrices = selectedVariation
    ? {
        p12: selectedVariation.priceRupees,
        p35: selectedVariation.priceRupees,
        p6: selectedVariation.priceRupees,
      }
    : prices
  const price = computeBookingPrice(count, effectivePrices)
  const activeBracket = bracketKeyFor(count)
  const bracketKeys = ['1_2', '3_5', '6_plus'] as const

  // DISPLAY-only payment split (issue 13). Mirrors the ADR-0001 carve-outs the
  // money path applies server-side so the transparency block never promises a
  // 25% Advance that booking-create would coerce to 100% (slot <48h away, or
  // total > Rs.25,000). `hoursToStart` is null until a date is chosen — then the
  // standard 25% preview shows; the authoritative split is still re-derived at
  // Booking-create against the real slot.
  const hoursToStart = selectedSlot
    ? (new Date(selectedSlot.startAtISO).getTime() - Date.now()) / 3_600_000
    : null
  const split = resolveDisplaySplit({
    total: price.total,
    allowsPartialPay: Boolean(partialPay),
    hoursToStart,
  })

  /** Cap the count to a slot's bookable ceiling when the slot/date changes. */
  function clampCountTo(slotId: string | null): void {
    const slot = slots.find((s) => s.id === slotId)
    const ceiling = slot ? Math.max(1, maxBookableParticipants(slot.remaining, max)) : max
    setCount((c) => Math.min(c, ceiling))
  }
  function pickDate(key: string): void {
    setSelectedDate(key)
    const firstId = firstBookableSlotId(byDate.get(key))
    setSelectedSlotId(firstId)
    clampCountTo(firstId)
    toast.info(toastLabels.dateSelected)
  }
  function pickSlot(id: string): void {
    setSelectedSlotId(id)
    clampCountTo(id)
    toast.info(toastLabels.slotSelected)
  }

  const slotParam = selectedSlotId ? `&slotId=${selectedSlotId}` : ''
  // Carry the selected variation (issue #08). The client passes ONLY the id —
  // never a price — and the server resolves + snapshots the authoritative price.
  const variationParam = selectedVariation
    ? `&variationId=${encodeURIComponent(selectedVariation.id)}`
    : ''
  const href = `${checkoutHref}${slotParam}&participants=${count}${variationParam}`


  return (
    <div className="space-y-4">
      {/* Per-participant Group-size bracket price table (ADR-0011). The bracket
          the current count falls into is highlighted so the selector and the
          table read as one control. Hidden when a pricing variation is selected
          (issue #08): the variation's flat per-person price replaces the
          group-size brackets, so showing the bracket ladder would mislead. */}
      {!selectedVariation && (
      <div>
        <p className="mb-2 text-xs text-muted-foreground">{priceTableLabel}</p>
        {/* No aria-label here: the visible caption above already labels the
            table, and a `dl[aria-label]` would collide with the quick-facts
            strip selector the PDP E2E uses to detect structured data. */}
        <dl className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
          {brackets.map((bracket, i) => {
            const isActive = bracketKeys[i] === activeBracket
            return (
              <div
                key={bracket.label}
                className={cn(
                  'flex items-baseline justify-between px-3 py-2',
                  isActive && 'bg-muted',
                )}
                aria-current={isActive ? 'true' : undefined}
              >
                <dt
                  className={cn(
                    'text-sm text-muted-foreground',
                    isActive && 'font-medium text-foreground',
                  )}
                >
                  {bracket.label}
                </dt>
                <dd className="text-sm font-semibold tabular-nums">
                  ₹{formatRupees(bracket.priceRupees)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {perPersonLabel}
                  </span>
                </dd>
              </div>
            )
          })}
        </dl>
      </div>
      )}

      {/* Pricing-variation selector (issue #08) — shown ONLY when the Experience
          has active variations. Selecting one drives the per-person price + the
          submitted variationId; the SERVER resolves + snapshots the price. The
          default "Standard (group pricing)" option keeps the bracket flow. */}
      {hasVariations && variationLabels && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-foreground">
            {variationLabels.heading}
          </legend>
          <div className="space-y-2">
            {/* Standard / group-pricing option (no variationId). */}
            <label
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-md)] border p-2.5 text-sm',
                selectedVariationId === null
                  ? 'border-primary bg-primary/5'
                  : 'border-border',
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="pricing-variation"
                  className="size-4"
                  checked={selectedVariationId === null}
                  disabled={disabled}
                  onChange={() => setSelectedVariationId(null)}
                  aria-label={variationLabels.standardOption}
                />
                <span className="font-medium">{variationLabels.standardOption}</span>
              </span>
            </label>

            {activeVariations.map((variation) => {
              const checked = selectedVariationId === variation.id
              const durationSuffix =
                variation.durationMinutes != null
                  ? ` ${variationLabels.durationSuffix.replace(
                      '{minutes}',
                      String(variation.durationMinutes),
                    )}`
                  : ''
              return (
                <label
                  key={variation.id}
                  className={cn(
                    'flex cursor-pointer items-start justify-between gap-3 rounded-[var(--radius-md)] border p-2.5 text-sm',
                    checked ? 'border-primary bg-primary/5' : 'border-border',
                  )}
                >
                  <span className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="pricing-variation"
                      className="mt-0.5 size-4 shrink-0"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => setSelectedVariationId(variation.id)}
                      aria-label={variation.name}
                    />
                    <span>
                      <span className="block font-medium">{variation.name}</span>
                      {variation.description && (
                        <span className="block text-xs text-muted-foreground">
                          {variation.description}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="font-semibold">
                      ₹{formatRupees(variation.priceRupees)}
                    </span>
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {perPersonLabel}
                      {durationSuffix}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      )}

      {/* Participant stepper — drives the bracket + the live breakdown.
          Shared control (components/search/participants-stepper.tsx) since
          home-redesign issue 07; behavior/aria identical to the old inline
          stepper. */}
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Users aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          {participantsLabel}
        </span>
        <ParticipantsStepper
          label={participantsLabel}
          value={count}
          min={1}
          max={maxForSlot}
          disabled={disabled}
          onChange={setCount}
        />
      </div>

      {/* Capacity note — shown when the chosen time slot's seats are the binding
          limit (fewer than the group-size cap), so the user understands why the
          stepper stops (e.g. "Only 3 spaces left at this time"). */}
      {!disabled && slotLimited && selectedSlot && (
        <p className="text-2xs text-muted-foreground" role="status">
          {t('calendar.onlyNLeft', { count: selectedSlot.remaining })}
        </p>
      )}

      {/* Date + time picker (#70) — pick a date, then a time slot; the chosen
          slot is carried into Checkout. Hidden while booking is paused (the
          closure notice explains). */}
      {!disabled && (
        <div className="space-y-3">
          <BookingCalendar
            slots={slots}
            selectedDate={selectedDate}
            onSelectDate={pickDate}
            locale={locale}
            labels={calendarLabels}
          />
          <TimeSlotList
            slots={slotsForSelectedDate}
            selectedSlotId={selectedSlotId}
            onSelectSlot={pickSlot}
            locale={locale}
          />
        </div>
      )}

      {/* Live price breakdown — Total then (when Partial pay is allowed) the
          Advance/balance split, all reactive to the participant count. */}
      <div className="space-y-2">
        {partialPay && (
          <p className="text-xs font-medium text-foreground">{partialPay.breakdownLabel}</p>
        )}
        <dl className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <dt className="text-sm text-muted-foreground">
              {totalLabel}
              <span className="ml-1 text-xs">
                ({count} × ₹{formatRupees(price.perPerson)})
              </span>
            </dt>
            <dd className="text-sm font-semibold tabular-nums">
              ₹{formatRupees(price.total)}
            </dd>
          </div>
          {partialPay && (
            <>
              <div className="flex items-baseline justify-between">
                <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Wallet aria-hidden="true" className="size-4 shrink-0 text-info" />
                  {partialPay.advanceLabel}
                </dt>
                <dd className="text-sm font-semibold tabular-nums">
                  ₹{formatRupees(split.advanceRupees)}
                </dd>
              </div>
              {/* Balance row only when an Advance/balance split actually applies.
                  Under the ADR-0001 carve-outs (slot <48h, or total > Rs.25,000)
                  the whole amount is captured now, so there is no balance line. */}
              {!split.fullUpfront && (
                <div className="flex items-baseline justify-between">
                  <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    {partialPay.balanceLabel}
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums">
                    ₹{formatRupees(split.balanceRupees)}
                  </dd>
                </div>
              )}
            </>
          )}
        </dl>
        {partialPay && (
          <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-info-subtle px-3 py-2 text-xs text-info">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{split.fullUpfront ? partialPay.fullUpfrontNotice : partialPay.notice}</span>
          </p>
        )}
        {/* Refundable/cancellation pointer (ADR-0005). We do NOT fabricate a
            refundable rupee number — it is a pure function of (preset,
            cancellation timestamp, booking total) — we point to the active
            preset's policy so the breakdown stays accurate and honest. */}
        {partialPay && (
          <p className="text-2xs leading-relaxed text-muted-foreground">
            {partialPay.refundablePointer}
          </p>
        )}
      </div>

      <Separator />

      {closure ? (
        <>
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
          {/* A closed listing gets a REAL next action, never a disabled
              "Book now" (QA fix pass): explore live alternatives in the same
              Region. A "notify me when available" CTA needs waitlist infra
              that doesn't exist yet — deliberately not faked here. */}
          <Link
            href={closure.exploreSimilarHref}
            className={buttonVariants({
              size: 'lg',
              variant: 'outline',
              className: 'w-full',
            })}
          >
            {closure.exploreSimilarLabel}
          </Link>
          <p className="text-center text-xs text-muted-foreground">
            {closure.bookingDisabled}
          </p>
        </>
      ) : (
        <>
          <Link
            href={href}
            onClick={() => toast.info(toastLabels.bookingStarted)}
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
    </div>
  )
}
