import { describe, expect, it } from 'vitest'

import { parseDateParam, parseFiniteNumber } from './param-parsing'

/**
 * Pure URL-param parsing helpers for /search (home-redesign issue 10).
 *
 * `parseDateParam` implements the ADR-0020 date contract: UTC `YYYY-MM-DD`,
 * strictly validated (shape AND real calendar date), past dates collapse to
 * undefined. `parseFiniteNumber` is the carried-in hardening from the issue-07
 * review: raw `Number(...)` let `?groupSize=abc` reach SQL as NaN.
 */

describe('parseDateParam (ADR-0020 date contract)', () => {
  const TODAY = '2026-07-14'

  it('accepts a well-formed future date', () => {
    expect(parseDateParam('2026-08-01', TODAY)).toBe('2026-08-01')
  })

  it('accepts today (a today-slot is still bookable)', () => {
    expect(parseDateParam('2026-07-14', TODAY)).toBe('2026-07-14')
  })

  it('rejects past dates (collapse to undefined, not an error)', () => {
    expect(parseDateParam('2026-07-13', TODAY)).toBeUndefined()
    expect(parseDateParam('2020-01-01', TODAY)).toBeUndefined()
  })

  it('rejects malformed shapes', () => {
    expect(parseDateParam('2026-8-1', TODAY)).toBeUndefined()
    expect(parseDateParam('01-08-2026', TODAY)).toBeUndefined()
    expect(parseDateParam('abc', TODAY)).toBeUndefined()
    expect(parseDateParam('', TODAY)).toBeUndefined()
    expect(parseDateParam(undefined, TODAY)).toBeUndefined()
  })

  it('rejects impossible calendar dates that match the shape', () => {
    expect(parseDateParam('2026-13-01', TODAY)).toBeUndefined()
    expect(parseDateParam('2026-02-30', TODAY)).toBeUndefined()
    expect(parseDateParam('2026-00-10', TODAY)).toBeUndefined()
  })

  it('rejects dates beyond the far-horizon clamp (366 days)', () => {
    // The UI offers 2 months and slots materialize ~90 days out; a
    // '9999-12-31' URL used to serialize to an expanded-year ISO string
    // Postgres rejects — poisoning the DB-outage log signal.
    expect(parseDateParam('9999-12-31', TODAY)).toBeUndefined()
    expect(parseDateParam('2027-08-01', TODAY)).toBeUndefined()
    expect(parseDateParam('2027-07-01', TODAY)).toBe('2027-07-01')
  })

  it('rejects SQL-hostile strings', () => {
    expect(parseDateParam("2026-08-01'; DROP TABLE bookings;--", TODAY)).toBeUndefined()
  })
})

describe('parseFiniteNumber (NaN guard for numeric params)', () => {
  it('parses ordinary numbers', () => {
    expect(parseFiniteNumber('5')).toBe(5)
    expect(parseFiniteNumber('4.5')).toBe(4.5)
    expect(parseFiniteNumber('0')).toBe(0)
  })

  it('collapses junk to undefined instead of NaN', () => {
    expect(parseFiniteNumber('abc')).toBeUndefined()
    expect(parseFiniteNumber('12abc')).toBeUndefined()
    expect(parseFiniteNumber('Infinity')).toBeUndefined()
    expect(parseFiniteNumber('NaN')).toBeUndefined()
    expect(parseFiniteNumber('')).toBeUndefined()
    expect(parseFiniteNumber(undefined)).toBeUndefined()
  })
})
