import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BookingCalendar } from '@/app/[locale]/(marketing)/experience/[slug]/booking-calendar'

const labels = {
  selectDate: 'Select date',
  today: 'Today',
  unavailable: 'Unavailable',
  selected: 'Selected',
  prevMonth: 'Previous month',
  nextMonth: 'Next month',
  noDates: 'No dates available',
}

// Slots in July 2026 (a clean future month, so "today" never collides).
const slots = [
  { id: 'slot-jul-9', startAtISO: '2026-07-09T06:00:00Z' },
  { id: 'slot-jul-16', startAtISO: '2026-07-16T06:00:00Z' },
]

afterEach(() => cleanup())

describe('BookingCalendar', () => {
  it('opens on the month of the first available slot, enabling only available days', () => {
    render(
      <BookingCalendar slots={slots} selectedSlotId={null} onSelect={() => {}} locale="en" labels={labels} />,
    )
    expect(screen.getByTestId('cal-day-2026-07-09')).not.toBeDisabled()
    expect(screen.getByTestId('cal-day-2026-07-16')).not.toBeDisabled()
    expect(screen.getByTestId('cal-day-2026-07-10')).toBeDisabled()
  })

  it('calls onSelect with the slot id when an available day is clicked', () => {
    const onSelect = vi.fn()
    render(
      <BookingCalendar slots={slots} selectedSlotId={null} onSelect={onSelect} locale="en" labels={labels} />,
    )
    fireEvent.click(screen.getByTestId('cal-day-2026-07-09'))
    expect(onSelect).toHaveBeenCalledWith('slot-jul-9')
  })

  it('marks the selected slot day as pressed', () => {
    render(
      <BookingCalendar slots={slots} selectedSlotId="slot-jul-16" onSelect={() => {}} locale="en" labels={labels} />,
    )
    expect(screen.getByTestId('cal-day-2026-07-16')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cal-day-2026-07-09')).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows an empty-state message and no day buttons when there are no slots', () => {
    render(
      <BookingCalendar slots={[]} selectedSlotId={null} onSelect={() => {}} locale="en" labels={labels} />,
    )
    expect(screen.getByText('No dates available')).toBeTruthy()
    expect(screen.queryByTestId('cal-day-2026-07-09')).toBeNull()
  })

  it('navigates to the next month when the next button is clicked', () => {
    render(
      <BookingCalendar slots={slots} selectedSlotId={null} onSelect={() => {}} locale="en" labels={labels} />,
    )
    // July has the slots; August has none, so its 16th is disabled after nav.
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByTestId('cal-day-2026-08-16')).toBeDisabled()
    expect(screen.queryByTestId('cal-day-2026-07-16')).toBeNull()
  })
})
