import type { ReactElement } from 'react'

import {
  CalendarCheck,
  CircleCheck,
  CreditCard,
  MapPin,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'

/**
 * Issue 13 — PDP trust/clarity blocks (DECISION D11: ADD near the booking box;
 * do NOT reorder the overhauled PDP).
 *
 * Both blocks are pure Server Components — they take already-translated strings
 * (the PDP resolves `ExperiencePage.*` in page.tsx, exactly like BookingRail),
 * carry NO `'use client'` directive, and therefore render in the server HTML so
 * crawlers and assistive tech see them without any JS.
 */

export interface ExperienceDisclosureProps {
  /** Already-translated disclosure heading. */
  heading: string
  /** Already-translated disclosure body (the third-party Vendor statement). */
  body: string
}

/**
 * Third-party Vendor disclosure — sits next to the Booking box and states, in
 * plain language, that Experiences are operated by independent third-party
 * Vendors and what Switchback verifies. The NOUN is always "Vendor" (CONTEXT.md);
 * "operated by" is fine as a verb but never surfaces "operator" as a term.
 */
export function ExperienceDisclosure({
  heading,
  body,
}: ExperienceDisclosureProps): ReactElement {
  return (
    <div
      data-slot="vendor-disclosure"
      className="rounded-[var(--radius-card)] border border-border bg-muted/40 p-4"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-info" />
        {heading}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}

export interface ExperienceAfterBookingProps {
  /** Already-translated section heading. */
  heading: string
  /** Already-translated 5 ordered steps (select → pay Advance → confirm → receive → conduct). */
  steps: ReadonlyArray<string>
}

/**
 * "What happens after booking?" — the 5-step post-booking journey, rendered as
 * an <ol> so the sequence is conveyed to assistive tech. Server-rendered and
 * crawlable. The copy carries the load-bearing vocabulary: 25% Advance /
 * Partial pay (ADR-0001), Instant Confirmation (ADR-0003), and the
 * meeting-point + Vendor-details handover (ADR-0009).
 */
export function ExperienceAfterBooking({
  heading,
  steps,
}: ExperienceAfterBookingProps): ReactElement {
  // One icon per step, in journey order. Decorative (aria-hidden); the ordered
  // list conveys the real sequence.
  const ICONS: ReadonlyArray<LucideIcon> = [
    Users,
    CreditCard,
    CircleCheck,
    MapPin,
    CalendarCheck,
  ]

  return (
    <section id="afterBooking" aria-labelledby="afterBooking-heading">
      <h2
        id="afterBooking-heading"
        className="mb-4 font-heading text-h2 font-semibold tracking-tight"
      >
        {heading}
      </h2>
      <ol className="grid gap-4 md:grid-cols-2">
        {steps.map((step, i) => {
          const Icon = ICONS[i] ?? CircleCheck
          return (
            <li
              key={i}
              data-testid="after-booking-step"
              className="flex items-start gap-3 text-sm"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-strong"
              >
                <Icon className="size-4" />
              </span>
              <span className="pt-1.5 leading-snug text-foreground">{step}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
