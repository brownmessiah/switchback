import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * QA fix pass — closed-Experience booking CTA.
 *
 * When a Region closure is active the rail previously kept rendering a
 * disabled "Book now" button, which QA read as a broken booking affordance.
 * The closure branch must now show the closure notice plus a REAL next
 * action — "Explore similar experiences" — and never the words "Book now".
 */

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${JSON.stringify(vals)}` : key,
}))

vi.mock(
  '@/app/[locale]/(marketing)/experience/[slug]/booking-calendar',
  () => ({ BookingCalendar: () => null }),
)
vi.mock(
  '@/app/[locale]/(marketing)/experience/[slug]/time-slot-list',
  () => ({ TimeSlotList: () => null }),
)

import { BookingRailInteractive } from '@/app/[locale]/(marketing)/experience/[slug]/booking-rail-interactive'

const BASE_PROPS = {
  experienceId: 'exp-cart-test',
  addToCartLabels: {
    label: 'Add to cart',
    added: 'Added to your cart',
    signIn: 'Sign in to add to your cart',
    error: 'Could not add to cart',
  },
  priceTableLabel: 'pricing.priceTable',
  brackets: [
    { label: 'pricing.tier1_2', priceRupees: 5000 },
    { label: 'pricing.tier3_5', priceRupees: 4500 },
    { label: 'pricing.tier6Plus', priceRupees: 4000 },
  ],
  perPersonLabel: 'pricing.perPerson',
  participantsLabel: 'pricing.participants',
  totalLabel: 'pricing.total',
  maxParticipants: 12,
  freeCancellation: 'pricing.freeCancellation',
  bookNowLabel: 'pricing.bookNow',
  checkoutHref: '/checkout?experienceId=e1',
  locale: 'en',
  calendarLabels: {
    selectDate: 'calendar.selectDate',
    today: 'calendar.today',
    unavailable: 'calendar.unavailable',
    selected: 'calendar.selected',
    prevMonth: 'calendar.prevMonth',
    nextMonth: 'calendar.nextMonth',
    noDates: 'calendar.noDates',
  },
  toastLabels: {
    dateSelected: 'toast.dateSelected',
    slotSelected: 'toast.slotSelected',
    bookingStarted: 'toast.bookingStarted',
    availabilityError: 'toast.availabilityError',
  },
} as const

const CLOSURE = {
  heading: 'closure.heading',
  reason: 'Monsoon closure',
  reopens: 'closure.reopens',
  bookingDisabled: 'closure.bookingDisabled',
  exploreSimilarLabel: 'closure.exploreSimilar',
  exploreSimilarHref: '/search?region=lonavala',
}

afterEach(() => {
  cleanup()
})

describe('BookingRailInteractive — Region-closure CTA', () => {
  it('replaces the booking CTA with an "Explore similar experiences" link when closed', () => {
    render(<BookingRailInteractive {...BASE_PROPS} closure={CLOSURE} slots={[]} />)

    // No "Book now" affordance at all — not even a disabled one.
    expect(screen.queryByText('pricing.bookNow')).toBeNull()

    const explore = screen.getByRole('link', { name: 'closure.exploreSimilar' })
    expect(explore).toHaveAttribute('href', '/search?region=lonavala')

    // The closure notice itself stays.
    expect(screen.getByText('closure.heading')).toBeInTheDocument()
    expect(screen.getByText('closure.bookingDisabled')).toBeInTheDocument()
  })

  it('keeps the active Book-now link when no closure is set', () => {
    render(<BookingRailInteractive {...BASE_PROPS} closure={null} slots={[]} />)

    expect(screen.getByText('pricing.bookNow')).toBeInTheDocument()
    expect(screen.queryByText('closure.exploreSimilar')).toBeNull()
  })
})
