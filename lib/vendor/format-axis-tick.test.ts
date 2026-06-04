import { describe, expect, it } from 'vitest'

import { formatAxisTick } from './format-axis-tick'

// The vendor dashboard revenue chart's y-axis previously formatted ticks with a
// raw `₹${value.toLocaleString('en-IN')}` which produced long strings ("₹10,000")
// that overflowed the narrow axis gutter and rendered clipped/garbled ("0,000",
// "'7,500"). formatAxisTick uses Indian compact notation (K / L / Cr) so every
// tick is short enough to never clip, and always carries an unambiguous ₹ prefix.
describe('formatAxisTick (compact Indian rupees)', () => {
  it('renders zero as a bare ₹0 (no decimals, no suffix)', () => {
    expect(formatAxisTick(0)).toBe('₹0')
  })

  it('renders sub-thousand values with no suffix', () => {
    expect(formatAxisTick(500)).toBe('₹500')
    expect(formatAxisTick(999)).toBe('₹999')
  })

  it('renders thousands with a K suffix, trimming a trailing .0', () => {
    expect(formatAxisTick(1000)).toBe('₹1K')
    expect(formatAxisTick(2500)).toBe('₹2.5K')
    expect(formatAxisTick(7500)).toBe('₹7.5K')
    expect(formatAxisTick(10000)).toBe('₹10K')
  })

  it('renders lakhs with an L suffix (Indian grouping, not 1M)', () => {
    expect(formatAxisTick(100000)).toBe('₹1L')
    expect(formatAxisTick(250000)).toBe('₹2.5L')
    // 10 lakh — the example called out in the fix plan.
    expect(formatAxisTick(1000000)).toBe('₹10L')
  })

  it('renders crores with a Cr suffix', () => {
    expect(formatAxisTick(10000000)).toBe('₹1Cr')
    expect(formatAxisTick(25000000)).toBe('₹2.5Cr')
  })

  it('caps the fraction at one digit and drops a redundant trailing zero', () => {
    // 7,654 → 7.654K → one-dp 7.7K (no stray punctuation, no clipped digit).
    expect(formatAxisTick(7654)).toBe('₹7.7K')
    // 12,000 → 12K, not 12.0K.
    expect(formatAxisTick(12000)).toBe('₹12K')
  })

  it('floors fractional input before formatting (chart aggregates can be float)', () => {
    expect(formatAxisTick(999.9)).toBe('₹999')
    expect(formatAxisTick(2500.4)).toBe('₹2.5K')
  })

  it('handles negative values by keeping the sign ahead of the ₹', () => {
    expect(formatAxisTick(-2500)).toBe('-₹2.5K')
  })
})
