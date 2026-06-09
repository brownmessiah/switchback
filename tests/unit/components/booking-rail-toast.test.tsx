import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue 24 — the PDP booking rail fires toasts for the booking flow:
 *   - date selected         → info toast (toastLabels.dateSelected)
 *   - time slot selected    → info toast (toastLabels.slotSelected)
 *   - booking started       → info toast on the Book-now CTA (toastLabels.bookingStarted)
 *   - availability error     → error toast on mount when the slot feed failed to load
 * Toasts ADD to the existing rail UX (the calendar/time-slot pickers still work).
 */

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${JSON.stringify(vals)}` : key,
}))

const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))
vi.mock('@/lib/toast', () => ({ toast }))

// Real calendar + time-slot pickers expose onSelectDate / onSelectSlot — stub
// them to thin buttons that invoke those callbacks so we can drive selection.
vi.mock(
  '@/app/[locale]/(marketing)/experience/[slug]/booking-calendar',
  () => ({
    BookingCalendar: ({ onSelectDate }: { onSelectDate: (key: string) => void }) => (
      <button type="button" data-testid="pick-date" onClick={() => onSelectDate('2099-12-25')}>
        pick date
      </button>
    ),
  }),
)
vi.mock(
  '@/app/[locale]/(marketing)/experience/[slug]/time-slot-list',
  () => ({
    TimeSlotList: ({ onSelectSlot }: { onSelectSlot: (id: string) => void }) => (
      <button type="button" data-testid="pick-slot" onClick={() => onSelectSlot('slot-2')}>
        pick slot
      </button>
    ),
  }),
)

import { BookingRailInteractive } from '@/app/[locale]/(marketing)/experience/[slug]/booking-rail-interactive'

const FUTURE = '2099-12-25T10:00:00.000Z'
const FUTURE_END = '2099-12-25T12:00:00.000Z'
const FUTURE_2 = '2099-12-25T14:00:00.000Z'
const FUTURE_2_END = '2099-12-25T16:00:00.000Z'

const baseProps = {
  priceTableLabel: 'Price',
  brackets: [
    { label: '1-2', priceRupees: 2000 },
    { label: '3-5', priceRupees: 1800 },
    { label: '6+', priceRupees: 1600 },
  ],
  perPersonLabel: '/person',
  participantsLabel: 'Participants',
  totalLabel: 'Total',
  maxParticipants: 8,
  freeCancellation: 'Free cancellation',
  bookNowLabel: 'Book now',
  checkoutHref: '/checkout?experienceId=exp-1',
  slots: [
    { id: 'slot-1', startAtISO: FUTURE, endAtISO: FUTURE_END, remaining: 8 },
    { id: 'slot-2', startAtISO: FUTURE_2, endAtISO: FUTURE_2_END, remaining: 5 },
  ],
  locale: 'en',
  calendarLabels: {} as never,
  toastLabels: {
    dateSelected: 'Date selected',
    slotSelected: 'Time slot selected',
    bookingStarted: 'Taking you to checkout',
    availabilityError: "We couldn't load availability. Please refresh.",
  },
}

beforeEach(() => {
  toast.info.mockClear()
  toast.error.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('BookingRailInteractive — booking-flow toasts (issue 24)', () => {
  it('fires an info toast when a date is selected', async () => {
    const user = userEvent.setup()
    render(<BookingRailInteractive {...baseProps} />)
    await user.click(screen.getByTestId('pick-date'))
    expect(toast.info).toHaveBeenCalledWith('Date selected')
  })

  it('fires an info toast when a time slot is selected', async () => {
    const user = userEvent.setup()
    render(<BookingRailInteractive {...baseProps} />)
    await user.click(screen.getByTestId('pick-slot'))
    expect(toast.info).toHaveBeenCalledWith('Time slot selected')
  })

  it('fires an info toast when the booking is started (Book now CTA)', async () => {
    const user = userEvent.setup()
    render(<BookingRailInteractive {...baseProps} />)
    await user.click(screen.getByRole('link', { name: /book now/i }))
    expect(toast.info).toHaveBeenCalledWith('Taking you to checkout')
  })

  it('fires an error toast on mount when availability failed to load', () => {
    render(<BookingRailInteractive {...baseProps} availabilityError />)
    expect(toast.error).toHaveBeenCalledWith(
      "We couldn't load availability. Please refresh.",
    )
  })

  it('does NOT fire an availability error toast when availability loaded fine', () => {
    render(<BookingRailInteractive {...baseProps} />)
    expect(toast.error).not.toHaveBeenCalled()
  })
})
