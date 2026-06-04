import { describe, expect, it } from 'vitest'

import { dateKey, monthCells, slotsByDate } from './booking-calendar'

describe('dateKey', () => {
  it('formats a Date as a UTC YYYY-MM-DD key', () => {
    expect(dateKey(new Date('2026-06-04T10:30:00Z'))).toBe('2026-06-04')
  })

  it('uses the UTC calendar day (not local)', () => {
    expect(dateKey(new Date('2026-06-04T23:59:00Z'))).toBe('2026-06-04')
  })
})

describe('slotsByDate', () => {
  it('maps each date to its FIRST slot id (slots sorted ascending)', () => {
    const map = slotsByDate([
      { id: 's1', startAtISO: '2026-06-09T06:00:00Z' },
      { id: 's2', startAtISO: '2026-06-09T11:00:00Z' }, // same day → ignored
      { id: 's3', startAtISO: '2026-06-16T06:00:00Z' },
    ])
    expect(map.get('2026-06-09')).toBe('s1')
    expect(map.get('2026-06-16')).toBe('s3')
    expect(map.size).toBe(2)
  })

  it('is empty for no slots', () => {
    expect(slotsByDate([]).size).toBe(0)
  })
})

describe('monthCells', () => {
  it('pads leading blanks to the weekday of the 1st (Sunday-start)', () => {
    // June 2026: the 1st is a Monday → exactly 1 leading blank.
    const cells = monthCells(2026, 5)
    expect(cells[0]).toBeNull()
    expect(cells[1]?.getUTCDate()).toBe(1)
    expect(cells.length).toBe(1 + 30) // 1 blank + 30 days
    expect(cells[cells.length - 1]?.getUTCDate()).toBe(30)
  })

  it('handles a month starting on Sunday with no leading blanks', () => {
    // February 2026: the 1st is a Sunday → no leading blank.
    const cells = monthCells(2026, 1)
    expect(cells[0]?.getUTCDate()).toBe(1)
    expect(cells.length).toBe(28)
  })
})
