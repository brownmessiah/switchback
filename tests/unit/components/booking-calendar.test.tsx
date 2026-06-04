import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BookingCalendar } from '@/app/[locale]/(marketing)/experience/[slug]/booking-calendar'
import type { CalendarSlot } from '@/lib/experiences/booking-calendar'

const labels = {
  selectDate: 'Select date',
  today: 'Today',
  unavailable: 'Unavailable',
  selected: 'Selected',
  prevMonth: 'Previous month',
  nextMonth: 'Next month',
  noDates: 'No dates available',
}

const slot = (
  id: string,
  startAtISO: string,
  remaining: number,
): CalendarSlot => ({
  id,
  startAtISO,
  endAtISO: new Date(new Date(startAtISO).getTime() + 3 * 3600_000).toISOString(),
  remaining,
})

// July 2026 — a clean future month so "today" never collides.
const slots = [
  slot('jul9-am', '2026-07-09T06:00:00Z', 8),
  slot('jul9-pm', '2026-07-09T11:00:00Z', 3),
  slot('jul10-sold', '2026-07-10T06:00:00Z', 0), // date with only a sold-out slot
  slot('jul16-am', '2026-07-16T06:00:00Z', 5),
]

afterEach(() => cleanup())

describe('BookingCalendar (date picker)', () => {
  it('opens on the month of the first slot, enabling only dates with seats', () => {
    render(
      <BookingCalendar slots={slots} selectedDate={null} onSelectDate={() => {}} locale="en" labels={labels} />,
    )
    expect(screen.getByTestId('cal-day-2026-07-09')).not.toBeDisabled()
    expect(screen.getByTestId('cal-day-2026-07-16')).not.toBeDisabled()
    // A date whose only slot is sold out is NOT bookable.
    expect(screen.getByTestId('cal-day-2026-07-10')).toBeDisabled()
  })

  it('calls onSelectDate with the date key when an available day is clicked', () => {
    const onSelectDate = vi.fn()
    render(
      <BookingCalendar slots={slots} selectedDate={null} onSelectDate={onSelectDate} locale="en" labels={labels} />,
    )
    fireEvent.click(screen.getByTestId('cal-day-2026-07-09'))
    expect(onSelectDate).toHaveBeenCalledWith('2026-07-09')
  })

  it('marks the selected date as pressed', () => {
    render(
      <BookingCalendar slots={slots} selectedDate="2026-07-16" onSelectDate={() => {}} locale="en" labels={labels} />,
    )
    expect(screen.getByTestId('cal-day-2026-07-16')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cal-day-2026-07-09')).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the empty-state and no day buttons when there are no slots', () => {
    render(
      <BookingCalendar slots={[]} selectedDate={null} onSelectDate={() => {}} locale="en" labels={labels} />,
    )
    expect(screen.getByText('No dates available')).toBeTruthy()
    expect(screen.queryByTestId('cal-day-2026-07-09')).toBeNull()
  })

  it('navigates to the next month', () => {
    render(
      <BookingCalendar slots={slots} selectedDate={null} onSelectDate={() => {}} locale="en" labels={labels} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByTestId('cal-day-2026-08-16')).toBeDisabled()
    expect(screen.queryByTestId('cal-day-2026-07-16')).toBeNull()
  })
})
