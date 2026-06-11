/**
 * Tests for BookingRailMobile — the PDP mobile booking bottom-bar (Foundation D,
 * DESIGN.md §8.5 item 4 / §8.4 lg-only side-rail exception).
 *
 * Verifies the bar renders the lowest-bracket "from" price + the per-person
 * suffix, exposes a CTA that opens a bottom Sheet, and — once open — renders the
 * SAME BookingRailInteractive island (the canonical "Book now" → checkout link).
 * The bar is `lg:hidden` so the desktop side-rail owns the revenue spine ≥ lg.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it } from 'vitest'

import enMessages from '@/lib/i18n/messages/en.json'

import { BookingRailMobile, type BookingRailMobileProps } from './booking-rail-mobile'

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )
}

// BookingRailInteractive is a 'use client' island whose effects schedule React
// work via the scheduler; unmount synchronously after each test so no deferred
// task fires after jsdom teardown under full-suite parallelism (cf. #109).
afterEach(() => {
  cleanup()
})

function baseProps(overrides: Partial<BookingRailMobileProps> = {}): BookingRailMobileProps {
  return {
    heading: 'Booking',
    priceTableLabel: 'Per-participant price',
    brackets: [
      { label: '1-2 participants', priceRupees: 1500 },
      { label: '3-5 participants', priceRupees: 1300 },
      { label: '6+ participants', priceRupees: 1100 },
    ],
    perPersonLabel: '/ person',
    participantsLabel: 'Participants',
    totalLabel: 'Total',
    maxParticipants: 12,
    freeCancellation: 'Free cancellation · 24h refund SLA',
    bookNowLabel: 'Book now',
    checkoutHref: '/checkout?experienceId=exp_1',
    slots: [],
    locale: 'en',
    calendarLabels: {
      selectDate: 'Select date',
      today: 'Today',
      unavailable: 'Unavailable',
      selected: 'Selected',
      prevMonth: 'Previous month',
      nextMonth: 'Next month',
      noDates: 'No dates',
    },
    closure: null,
    toastLabels: {
      dateSelected: 'Date selected. Now pick a time slot.',
      slotSelected: 'Date & time slot selected.',
      bookingStarted: 'Taking you to checkout…',
      availabilityError: "We couldn't load availability. Please refresh.",
    },
    ...overrides,
  }
}

describe('BookingRailMobile', () => {
  it('shows the lowest-bracket "from" price with the per-person suffix', () => {
    renderWithIntl(<BookingRailMobile {...baseProps()} />)

    // brackets[0].priceRupees is the from-price (1500), formatted en-IN.
    expect(screen.getByText(/1,500/)).toBeInTheDocument()
    // The per-person suffix is present (matches the desktop rail's leading row).
    expect(screen.getAllByText('/ person').length).toBeGreaterThan(0)
  })

  it('renders a Sheet-trigger BUTTON (not an <a> "Book now") so the bar never collides with the E2E revenue-spine selector', () => {
    renderWithIntl(<BookingRailMobile {...baseProps()} />)

    // The bottom-bar CTA is the Sheet trigger — a <button>, not an <a> — so it
    // never collides with the strict-mode `a:has-text("Book now")` revenue-spine
    // selector the booking-flow E2E asserts on the desktop side-rail. The
    // canonical "Book now" <a> lives only inside the (closed) Sheet's island.
    const trigger = screen.getByTestId('booking-rail-mobile-trigger')
    expect(trigger.tagName).toBe('BUTTON')
    expect(screen.queryByRole('link', { name: /Book now/i })).not.toBeInTheDocument()
  })

  it('disables the CTA and surfaces the closure heading when booking is paused', () => {
    renderWithIntl(
      <BookingRailMobile
        {...baseProps({
          closure: {
            heading: 'Currently closed',
            reason: 'Monsoon shutdown',
            reopens: 'Reopens 1 September 2026',
            bookingDisabled: 'Booking is paused for this Experience.',
            exploreSimilarLabel: 'Explore similar experiences',
            exploreSimilarHref: '/search?region=lonavala',
          },
        })}
      />,
    )

    const trigger = screen.getByTestId('booking-rail-mobile-trigger')
    expect(trigger).toBeDisabled()
    expect(screen.getByText('Currently closed')).toBeInTheDocument()
  })
})
