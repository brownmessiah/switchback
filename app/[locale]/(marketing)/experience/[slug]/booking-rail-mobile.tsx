'use client'

import type { ReactElement } from 'react'

import { useTranslations } from 'next-intl'
import { CalendarX } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

import { AskQuestion, type AskQuestionLabels } from './ask-question'
import { BookingRailInteractive } from './booking-rail-interactive'
import type { BookingRailInteractiveProps } from './booking-rail-interactive'

/** Experience-enquiry context + labels for the mobile-bar "Ask a Question" CTA. */
export interface AskQuestionContext {
  experienceSlug: string
  experienceTitle: string
  isSignedIn: boolean
  signInHref: string
  labels: AskQuestionLabels
}

/**
 * Props mirror the BookingRail shell: every field is forwarded verbatim to the
 * BookingRailInteractive island inside the Sheet, so the mobile bar and the
 * desktop side-rail are driven by ONE already-computed prop set (no data refork).
 * `heading` titles the Sheet (the same `pricing.heading` the rail Card uses).
 */
export interface BookingRailMobileProps extends BookingRailInteractiveProps {
  /** Already-translated module heading (`pricing.heading`) — titles the Sheet. */
  heading: string
  /** "Ask a Question" enquiry CTA (issue 17) — rendered in the bar beside the Book CTA. */
  askQuestion?: AskQuestionContext
}

function formatRupees(amount: number): string {
  return amount.toLocaleString('en-IN')
}

/**
 * BookingRailMobile — the PDP sticky booking bottom-bar + bottom Sheet
 * (Foundation D; DESIGN.md §8.5 item 4, §8.4 PDP-booking side-rail `lg`-only
 * exception). Rendered `< lg` only (`lg:hidden`); the desktop sticky side-rail
 * owns the revenue spine at `≥ lg`.
 *
 * The decision-complete booking Card (calendar + participant stepper + price
 * breakdown + assurances) needs ~22rem, which does not dock beside the gallery
 * at tablet width — so on base AND tablet it lives behind this bar. The bar
 * shows the from-price (the lowest Group-size bracket — `brackets[0]`, matching
 * the rail's leading price row) and a primary CTA that opens a **bottom Sheet**
 * (A4 "bottom on mobile") wrapping the SAME self-contained `BookingRailInteractive`
 * island — so the canonical "Book now" → checkout deep link (slot + participant
 * count) is reached identically from mobile and desktop.
 *
 * The CTA is a Sheet trigger (a `<button>`), deliberately NOT a second "Book now"
 * `<a>`: that would collide with the strict-mode `a:has-text("Book now")`
 * revenue-spine selector the booking-flow E2E asserts on the desktop rail. When
 * a Region closure is active (ADR-0011) the bar de-emphasises, the trigger is
 * disabled showing the closure heading, and the reopens line replaces the price
 * (so the paused state surfaces closure status inline on the mobile tier too).
 */
export function BookingRailMobile({
  heading,
  askQuestion,
  ...railProps
}: BookingRailMobileProps): ReactElement {
  const t = useTranslations('ExperiencePage')
  const { brackets, perPersonLabel, closure } = railProps
  const fromPriceRupees = brackets[0]?.priceRupees ?? 0
  const disabled = Boolean(closure)

  return (
    <div
      // A4 elevated action bar: surface-3 + --shadow-lg hairline, cleared above
      // the device safe-area inset (home-indicator notch). lg:hidden — the
      // desktop sticky side-rail covers ≥ lg.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface-3 px-4 pt-3 shadow-[var(--shadow-lg)] [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <div className="min-w-0">
          {disabled ? (
            <p role="status" className="truncate text-xs text-muted-foreground">
              {closure?.reopens ?? closure?.reason ?? closure?.bookingDisabled}
            </p>
          ) : (
            <p className="truncate text-base font-bold tabular-nums text-foreground">
              ₹{formatRupees(fromPriceRupees)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                {perPersonLabel}
              </span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* "Ask a Question" (issue 17) — a compact enquiry CTA in the mobile
              sticky bar, available whether or not booking is paused. */}
          {askQuestion && (
            <AskQuestion
              experienceSlug={askQuestion.experienceSlug}
              experienceTitle={askQuestion.experienceTitle}
              isSignedIn={askQuestion.isSignedIn}
              signInHref={askQuestion.signInHref}
              labels={askQuestion.labels}
              compact
              className="shrink-0"
            />
          )}
          {disabled ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled
              aria-disabled="true"
              data-testid="booking-rail-mobile-trigger"
              className="shrink-0 cursor-not-allowed px-6 opacity-70"
            >
              <CalendarX aria-hidden="true" />
              {closure?.heading ?? t('closure.heading')}
            </Button>
          ) : (
            <Sheet>
            <SheetTrigger
              data-testid="booking-rail-mobile-trigger"
              render={<Button size="lg" className="shrink-0 px-6" />}
            >
              {t('calendar.selectDate')}
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="max-h-[90dvh] overflow-y-auto rounded-t-[var(--radius-lg)] p-4"
            >
              <SheetHeader className="px-0 pt-0">
                <SheetTitle className="font-heading text-h3 font-semibold tracking-tight">
                  {heading}
                </SheetTitle>
                <SheetDescription>{t('pricing.priceTable')}</SheetDescription>
              </SheetHeader>
              {/* The exact same island the desktop side-rail renders — identical
                  props, no data refork. */}
              <BookingRailInteractive {...railProps} />
            </SheetContent>
          </Sheet>
          )}
        </div>
      </div>
    </div>
  )
}
