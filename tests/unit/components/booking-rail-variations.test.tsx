import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue #08 — PDP pricing-variation selector.
 *
 * When an Experience has ≥1 ACTIVE pricing variation the Booking rail renders a
 * selector. Selecting a variation:
 *   - drives the shown per-person price to the variation's price, and
 *   - appends `&variationId=<id>` to the Book-now checkout href (the SERVER
 *     resolves + snapshots the price — the client only sends the id).
 * With NO variations the selector is absent and the href is unchanged.
 *
 * next-intl + the calendar/time-slot children are mocked (key-echoing t()).
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

const CALENDAR_LABELS = {
  selectDate: 'calendar.selectDate',
  today: 'calendar.today',
  unavailable: 'calendar.unavailable',
  selected: 'calendar.selected',
  prevMonth: 'calendar.prevMonth',
  nextMonth: 'calendar.nextMonth',
  noDates: 'calendar.noDates',
}

const VARIATION_LABELS = {
  heading: 'pricing.chooseOption',
  standardOption: 'pricing.standardOption',
  perPerson: 'pricing.perPerson',
  durationSuffix: 'pricing.variationDuration',
}

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
  calendarLabels: CALENDAR_LABELS,
  closure: null,
  toastLabels: {
    dateSelected: 'toast.dateSelected',
    slotSelected: 'toast.slotSelected',
    bookingStarted: 'toast.bookingStarted',
    availabilityError: 'toast.availabilityError',
  },
} as const

const VARIATIONS = [
  { id: 'var-sunrise', name: 'Sunrise batch', description: 'Early', priceRupees: 1800, durationMinutes: 90 },
  { id: 'var-private', name: 'Private session', description: null, priceRupees: 4200, durationMinutes: null },
] as const

function futureSlot() {
  const start = new Date(Date.now() + 24 * 7 * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  return { id: 'slot-1', startAtISO: start.toISOString(), endAtISO: end.toISOString(), remaining: 8 }
}

afterEach(() => {
  cleanup()
})

describe('BookingRailInteractive — pricing-variation selector (issue #08)', () => {
  it('renders NO variation selector when there are no active variations', () => {
    render(<BookingRailInteractive {...BASE_PROPS} slots={[futureSlot()]} />)
    expect(screen.queryByText('pricing.chooseOption')).toBeNull()
    // The Book-now href carries no variationId.
    const link = screen.getByText('pricing.bookNow').closest('a')
    expect(link?.getAttribute('href')).not.toContain('variationId')
  })

  it('renders a selector listing each active variation when present', () => {
    render(
      <BookingRailInteractive
        {...BASE_PROPS}
        slots={[futureSlot()]}
        variations={VARIATIONS}
        variationLabels={VARIATION_LABELS}
      />,
    )
    expect(screen.getByText('pricing.chooseOption')).toBeTruthy()
    expect(screen.getByText('Sunrise batch')).toBeTruthy()
    expect(screen.getByText('Private session')).toBeTruthy()
  })

  it('defaults to the standard (group-pricing) option with no variationId in the href', () => {
    render(
      <BookingRailInteractive
        {...BASE_PROPS}
        slots={[futureSlot()]}
        variations={VARIATIONS}
        variationLabels={VARIATION_LABELS}
      />,
    )
    const link = screen.getByText('pricing.bookNow').closest('a')
    expect(link?.getAttribute('href')).not.toContain('variationId')
  })

  it('selecting a variation drives the shown price and appends variationId to the href', () => {
    render(
      <BookingRailInteractive
        {...BASE_PROPS}
        slots={[futureSlot()]}
        variations={VARIATIONS}
        variationLabels={VARIATION_LABELS}
      />,
    )
    // Pick "Sunrise batch" (₹1,800/person).
    fireEvent.click(screen.getByLabelText('Sunrise batch'))

    // The live total now reflects 1 × ₹1,800 (shown in BOTH the selector option
    // and the total row) — NOT the ₹5,000 bracket price.
    expect(screen.getAllByText('₹1,800').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('₹5,000')).toBeNull()

    // The checkout href now carries the selected variation id.
    const link = screen.getByText('pricing.bookNow').closest('a')
    expect(link?.getAttribute('href')).toContain('variationId=var-sunrise')
  })

  it('switching back to the standard option removes variationId from the href', () => {
    render(
      <BookingRailInteractive
        {...BASE_PROPS}
        slots={[futureSlot()]}
        variations={VARIATIONS}
        variationLabels={VARIATION_LABELS}
      />,
    )
    fireEvent.click(screen.getByLabelText('Private session'))
    expect(screen.getByText('pricing.bookNow').closest('a')?.getAttribute('href')).toContain(
      'variationId=var-private',
    )
    // Back to standard group pricing.
    fireEvent.click(screen.getByLabelText('pricing.standardOption'))
    const link = screen.getByText('pricing.bookNow').closest('a')
    expect(link?.getAttribute('href')).not.toContain('variationId')
  })
})
