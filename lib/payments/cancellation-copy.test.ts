import { describe, expect, it } from 'vitest'

import { PRESET_WINDOWS } from './refund-policy'
import {
  CANCELLATION_COPY,
  cancellationFreeHours,
  freeCancellationLine,
  isNonCancellable,
  type CancellationCopyPreset,
} from './cancellation-copy'

/**
 * The per-preset plain-language copy is the single canonical source (ADR-0005
 * wedge): it renders identically on the vendor form and the customer detail.
 * The numeric figures must DERIVE from PRESET_WINDOWS so the copy can never
 * drift from the refund math — this suite is the guard.
 */

describe('cancellation-copy — canonical per-preset source', () => {
  it('covers exactly the four named presets the picker offers', () => {
    expect(Object.keys(CANCELLATION_COPY).sort()).toEqual(
      ['flexible', 'moderate', 'non_cancellable', 'strict'].sort(),
    )
  })

  describe('free-cancellation hours derive from PRESET_WINDOWS', () => {
    it('flexible = 24h (the PRESET_WINDOWS freeHours)', () => {
      expect(cancellationFreeHours('flexible')).toBe(PRESET_WINDOWS.flexible.freeHours)
      expect(cancellationFreeHours('flexible')).toBe(24)
    })

    it('moderate = 72h / 3 days (NOT the legacy inaccurate "7 days")', () => {
      expect(cancellationFreeHours('moderate')).toBe(PRESET_WINDOWS.moderate.freeHours)
      expect(cancellationFreeHours('moderate')).toBe(72)
    })

    it('strict = 14 days in hours', () => {
      expect(cancellationFreeHours('strict')).toBe(PRESET_WINDOWS.strict.freeHours)
      expect(cancellationFreeHours('strict')).toBe(14 * 24)
    })

    it('non_cancellable has no free window', () => {
      expect(cancellationFreeHours('non_cancellable')).toBeNull()
    })
  })

  describe('vendor-facing English plain-language rule per preset', () => {
    it('flexible states the 24h free window', () => {
      expect(CANCELLATION_COPY.flexible.rule).toContain('24')
      expect(CANCELLATION_COPY.flexible.rule.toLowerCase()).toContain('free cancellation')
    })

    it('moderate states 72h / 3 days — NOT 7 days (the fixed discrepancy)', () => {
      const rule = CANCELLATION_COPY.moderate.rule
      expect(rule).toContain('72')
      expect(rule).not.toContain('7 days')
    })

    it('strict states the 14-day free window and the 7-day 50% window', () => {
      const rule = CANCELLATION_COPY.strict.rule
      expect(rule).toContain('14')
      expect(rule).toContain('7')
      expect(rule).toContain('50%')
    })

    it('non_cancellable states no refund after payment', () => {
      const rule = CANCELLATION_COPY.non_cancellable.rule.toLowerCase()
      expect(rule).toContain('non-cancellable')
      expect(rule).toContain('no refund')
    })
  })

  describe('isNonCancellable', () => {
    it('is true only for non_cancellable', () => {
      expect(isNonCancellable('non_cancellable')).toBe(true)
      expect(isNonCancellable('flexible')).toBe(false)
      expect(isNonCancellable('moderate')).toBe(false)
      expect(isNonCancellable('strict')).toBe(false)
    })

    it('treats an unknown/legacy preset string as cancellable', () => {
      expect(isNonCancellable('custom')).toBe(false)
      expect(isNonCancellable('whatever')).toBe(false)
    })
  })

  describe('freeCancellationLine — the customer "Free cancellation up to Xh" line', () => {
    it('returns the hour figure for a windowed preset (derived, accurate)', () => {
      expect(freeCancellationLine('flexible')).toEqual({ hours: 24 })
      expect(freeCancellationLine('moderate')).toEqual({ hours: 72 })
      expect(freeCancellationLine('strict')).toEqual({ hours: 14 * 24 })
    })

    it('returns null for non_cancellable (no line — a badge is shown instead)', () => {
      expect(freeCancellationLine('non_cancellable')).toBeNull()
    })

    it('returns null for an unknown/legacy preset', () => {
      expect(freeCancellationLine('custom')).toBeNull()
    })
  })

  it('CancellationCopyPreset type accepts the four presets', () => {
    const presets: CancellationCopyPreset[] = [
      'flexible',
      'moderate',
      'strict',
      'non_cancellable',
    ]
    expect(presets).toHaveLength(4)
  })
})
