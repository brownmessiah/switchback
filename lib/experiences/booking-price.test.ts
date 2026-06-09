import { describe, expect, it } from 'vitest'

import {
  bracketKeyFor,
  computeBookingPrice,
  resolveDisplaySplit,
} from './booking-price'

const PRICES = { p12: 8500, p35: 7800, p6: 7200 }

describe('bracketKeyFor (ADR-0011 group-size brackets 1-2 / 3-5 / 6+)', () => {
  it('uses the 1-2 bracket for 1 and 2 participants', () => {
    expect(bracketKeyFor(1)).toBe('1_2')
    expect(bracketKeyFor(2)).toBe('1_2')
  })
  it('uses the 3-5 bracket for 3, 4, 5 participants', () => {
    expect(bracketKeyFor(3)).toBe('3_5')
    expect(bracketKeyFor(5)).toBe('3_5')
  })
  it('uses the 6+ bracket for 6 and above', () => {
    expect(bracketKeyFor(6)).toBe('6_plus')
    expect(bracketKeyFor(12)).toBe('6_plus')
  })
})

describe('computeBookingPrice', () => {
  it('prices 1 participant at the 1-2 bracket with a 25% advance (matches the PDP rail)', () => {
    const r = computeBookingPrice(1, PRICES)
    expect(r.bracket).toBe('1_2')
    expect(r.perPerson).toBe(8500)
    expect(r.total).toBe(8500)
    expect(r.advanceRupees).toBe(2125) // floor(8500 * 0.25)
    expect(r.balanceRupees).toBe(6375) // 8500 - 2125
  })

  it('multiplies the bracket price by the participant count', () => {
    const r = computeBookingPrice(2, PRICES)
    expect(r.perPerson).toBe(8500)
    expect(r.total).toBe(17000)
    expect(r.advanceRupees).toBe(4250)
    expect(r.balanceRupees).toBe(12750)
  })

  it('switches to the 3-5 bracket price at 3 participants', () => {
    const r = computeBookingPrice(3, PRICES)
    expect(r.bracket).toBe('3_5')
    expect(r.perPerson).toBe(7800)
    expect(r.total).toBe(23400)
    expect(r.advanceRupees).toBe(5850)
    expect(r.balanceRupees).toBe(17550)
  })

  it('switches to the 6+ bracket price at 6 participants', () => {
    const r = computeBookingPrice(6, PRICES)
    expect(r.bracket).toBe('6_plus')
    expect(r.perPerson).toBe(7200)
    expect(r.total).toBe(43200)
    expect(r.advanceRupees).toBe(10800)
    expect(r.balanceRupees).toBe(32400)
  })

  it('floors a non-integer advance and keeps advance + balance == total', () => {
    const r = computeBookingPrice(3, { p12: 999, p35: 777, p6: 555 })
    expect(r.total).toBe(2331) // 3 * 777
    expect(r.advanceRupees).toBe(Math.floor(2331 * 0.25)) // 582
    expect(r.advanceRupees + r.balanceRupees).toBe(2331)
  })

  it('clamps a count below 1 up to 1', () => {
    const r = computeBookingPrice(0, PRICES)
    expect(r.total).toBe(8500)
  })
})

describe('resolveDisplaySplit (ADR-0001 carve-outs — DISPLAY only, issue 13)', () => {
  it('keeps the 25% Advance split for the default partial-pay case: ≥48h out AND ≤Rs.25,000', () => {
    const r = resolveDisplaySplit({
      total: 10000,
      allowsPartialPay: true,
      hoursToStart: 168, // T+7d
    })
    expect(r.fullUpfront).toBe(false)
    expect(r.advanceRupees).toBe(2500) // floor(10000 * 0.25)
    expect(r.balanceRupees).toBe(7500)
  })

  it('coerces to 100% upfront when the slot starts <48h away (the partial-pay UX value is gone)', () => {
    const r = resolveDisplaySplit({
      total: 10000,
      allowsPartialPay: true,
      hoursToStart: 24,
    })
    expect(r.fullUpfront).toBe(true)
    expect(r.advanceRupees).toBe(10000) // whole amount captured now
    expect(r.balanceRupees).toBe(0)
  })

  it('coerces to 100% upfront (escrow) when the total exceeds Rs.25,000', () => {
    const r = resolveDisplaySplit({
      total: 26000,
      allowsPartialPay: true,
      hoursToStart: 168,
    })
    expect(r.fullUpfront).toBe(true)
    expect(r.advanceRupees).toBe(26000)
    expect(r.balanceRupees).toBe(0)
  })

  it('treats exactly Rs.25,000 as still partial-pay (threshold is strictly greater-than)', () => {
    const r = resolveDisplaySplit({
      total: 25000,
      allowsPartialPay: true,
      hoursToStart: 168,
    })
    expect(r.fullUpfront).toBe(false)
    expect(r.advanceRupees).toBe(6250)
  })

  it('is always full-upfront when the Experience does not allow partial pay', () => {
    const r = resolveDisplaySplit({
      total: 10000,
      allowsPartialPay: false,
      hoursToStart: 168,
    })
    expect(r.fullUpfront).toBe(true)
    expect(r.advanceRupees).toBe(10000)
    expect(r.balanceRupees).toBe(0)
  })

  it('is full-upfront when no slot is selected (hoursToStart unknown) — never under-collect', () => {
    const r = resolveDisplaySplit({
      total: 10000,
      allowsPartialPay: true,
      hoursToStart: null,
    })
    expect(r.fullUpfront).toBe(false)
    // Unknown start defaults to the standard 25% preview (a date must be
    // chosen before checkout; booking-create re-derives the authoritative
    // split server-side against the real slot).
    expect(r.advanceRupees).toBe(2500)
  })
})
