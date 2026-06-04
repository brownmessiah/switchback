import { describe, expect, it } from 'vitest'

import {
  dateIsBookable,
  dateKey,
  firstBookableSlotId,
  formatSlotTime,
  maxBookableParticipants,
  monthCells,
  slotsByDate,
  type CalendarSlot,
} from './booking-calendar'

const slot = (
  id: string,
  startAtISO: string,
  endAtISO: string,
  remaining: number,
): CalendarSlot => ({ id, startAtISO, endAtISO, remaining })

describe('dateKey', () => {
  it('formats a Date as a UTC YYYY-MM-DD key', () => {
    expect(dateKey(new Date('2026-06-04T10:30:00Z'))).toBe('2026-06-04')
  })
  it('uses the UTC calendar day (not local)', () => {
    expect(dateKey(new Date('2026-06-04T23:59:00Z'))).toBe('2026-06-04')
  })
})

describe('slotsByDate', () => {
  it('groups multiple slots under their date, preserving order', () => {
    const map = slotsByDate([
      slot('s1', '2026-06-09T06:00:00Z', '2026-06-09T09:00:00Z', 8),
      slot('s2', '2026-06-09T11:00:00Z', '2026-06-09T14:00:00Z', 3),
      slot('s3', '2026-06-16T06:00:00Z', '2026-06-16T09:00:00Z', 0),
    ])
    expect(map.get('2026-06-09')?.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(map.get('2026-06-16')?.map((s) => s.id)).toEqual(['s3'])
    expect(map.size).toBe(2)
  })
  it('is empty for no slots', () => {
    expect(slotsByDate([]).size).toBe(0)
  })
})

describe('dateIsBookable', () => {
  it('is true when at least one slot has seats remaining', () => {
    expect(dateIsBookable([slot('a', 'x', 'y', 0), slot('b', 'x', 'y', 2)])).toBe(true)
  })
  it('is false when every slot is sold out (or no slots)', () => {
    expect(dateIsBookable([slot('a', 'x', 'y', 0)])).toBe(false)
    expect(dateIsBookable([])).toBe(false)
    expect(dateIsBookable(undefined)).toBe(false)
  })
})

describe('firstBookableSlotId', () => {
  it('returns the first slot with seats, skipping sold-out ones', () => {
    expect(
      firstBookableSlotId([slot('a', 'x', 'y', 0), slot('b', 'x', 'y', 5)]),
    ).toBe('b')
  })
  it('returns null when none have seats', () => {
    expect(firstBookableSlotId([slot('a', 'x', 'y', 0)])).toBeNull()
  })
})

describe('maxBookableParticipants', () => {
  it('is bounded by the slot remaining when it is the tighter limit', () => {
    expect(maxBookableParticipants(1, 12)).toBe(1) // 1 seat left → can only book 1
  })
  it('is bounded by the group size when it is the tighter limit', () => {
    expect(maxBookableParticipants(20, 8)).toBe(8)
  })
  it('is 0 for a sold-out slot', () => {
    expect(maxBookableParticipants(0, 12)).toBe(0)
  })
})

describe('monthCells', () => {
  it('pads leading blanks to the weekday of the 1st (Sunday-start)', () => {
    const cells = monthCells(2026, 5) // June 2026, 1st is a Monday
    expect(cells[0]).toBeNull()
    expect(cells[1]?.getUTCDate()).toBe(1)
    expect(cells.length).toBe(1 + 30)
  })
  it('handles a month starting on Sunday with no leading blanks', () => {
    const cells = monthCells(2026, 1) // Feb 2026, 1st is a Sunday
    expect(cells[0]?.getUTCDate()).toBe(1)
    expect(cells.length).toBe(28)
  })
})

describe('formatSlotTime', () => {
  it('renders a localized start–end range in UTC', () => {
    const label = formatSlotTime('2026-06-09T07:00:00Z', '2026-06-09T10:00:00Z', 'en-IN')
    expect(label).toMatch(/7[:.]00/)
    expect(label).toContain('–')
    expect(label).toMatch(/10[:.]00/)
  })
  it('shows only the start when there is no end', () => {
    const label = formatSlotTime('2026-06-09T07:00:00Z', null, 'en-IN')
    expect(label).not.toContain('–')
  })
})
