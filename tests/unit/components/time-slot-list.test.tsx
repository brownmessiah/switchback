import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// next-intl: t returns the key, suffixing a count when interpolated so we can
// assert remaining-seats labels.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: { count?: number }) =>
    vals?.count != null ? `${key}:${vals.count}` : key,
}))

import { TimeSlotList } from '@/app/[locale]/(marketing)/experience/[slug]/time-slot-list'
import type { CalendarSlot } from '@/lib/experiences/booking-calendar'

const slot = (id: string, startAtISO: string, remaining: number): CalendarSlot => ({
  id,
  startAtISO,
  endAtISO: new Date(new Date(startAtISO).getTime() + 3 * 3600_000).toISOString(),
  remaining,
})

const dateSlots = [
  slot('am', '2026-07-09T07:00:00Z', 8),
  slot('pm', '2026-07-09T11:00:00Z', 1),
  slot('eve', '2026-07-09T15:00:00Z', 0), // sold out
]

afterEach(() => cleanup())

describe('TimeSlotList', () => {
  it('renders a button per slot with its remaining-seats label', () => {
    render(<TimeSlotList slots={dateSlots} selectedSlotId={null} onSelectSlot={() => {}} locale="en" />)
    expect(screen.getByTestId('time-slot-am')).toBeTruthy()
    expect(screen.getByText('calendar.seatsLeft:8')).toBeTruthy()
    expect(screen.getByText('calendar.seatsLeft:1')).toBeTruthy()
  })

  it('disables a sold-out slot and labels it sold out', () => {
    render(<TimeSlotList slots={dateSlots} selectedSlotId={null} onSelectSlot={() => {}} locale="en" />)
    expect(screen.getByTestId('time-slot-eve')).toBeDisabled()
    expect(screen.getByText('calendar.soldOut')).toBeTruthy()
  })

  it('calls onSelectSlot when an available slot is clicked, but not for sold-out', () => {
    const onSelectSlot = vi.fn()
    render(<TimeSlotList slots={dateSlots} selectedSlotId={null} onSelectSlot={onSelectSlot} locale="en" />)
    fireEvent.click(screen.getByTestId('time-slot-pm'))
    expect(onSelectSlot).toHaveBeenCalledWith('pm')
    fireEvent.click(screen.getByTestId('time-slot-eve'))
    expect(onSelectSlot).toHaveBeenCalledTimes(1) // sold-out click ignored
  })

  it('marks the selected slot as pressed', () => {
    render(<TimeSlotList slots={dateSlots} selectedSlotId="pm" onSelectSlot={() => {}} locale="en" />)
    expect(screen.getByTestId('time-slot-pm')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('time-slot-am')).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders nothing when there are no slots', () => {
    const { container } = render(
      <TimeSlotList slots={[]} selectedSlotId={null} onSelectSlot={() => {}} locale="en" />,
    )
    expect(container.firstChild).toBeNull()
  })
})
