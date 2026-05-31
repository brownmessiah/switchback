import { describe, expect, it } from 'vitest'

import {
  IDENTITY_MAX_PARTICIPANTS_PER_SLOT,
  IDENTITY_MAX_PRICE_PER_PERSON_RUPEES,
  assertWithinTier,
  type TierCapInput,
} from './tier-caps'

/**
 * ADR-0007 Tier-2 (Identity verified) caps:
 *   - single-day Experiences only
 *   - max Rs.5,000 per-person ticket
 *   - max 8 participants per slot
 *   - no combo Experiences, no multi-day treks
 *
 * Phone tier cannot publish at all; Business tier is unrestricted.
 *
 * `assertWithinTier` is a pure guard: it takes a tier plus listing facts
 * and returns { ok: true } or { ok: false, code, reason }. Both callers
 * (publish path, booking-create) adapt the structured result to their own
 * error shape.
 */

const SINGLE_DAY_SLOT = {
  // 09:00 → 17:00 same calendar day (UTC)
  startAt: new Date('2026-06-01T09:00:00.000Z'),
  endAt: new Date('2026-06-01T17:00:00.000Z'),
  capacity: 8,
}

function baseInput(overrides: Partial<TierCapInput> = {}): TierCapInput {
  return {
    kycTier: 'identity',
    pricePerPersonRupees: 5000,
    isCombo: false,
    slots: [SINGLE_DAY_SLOT],
    ...overrides,
  }
}

describe('assertWithinTier (ADR-0007 Tier-2 caps)', () => {
  describe('constants', () => {
    it('locks the documented Tier-2 numeric caps', () => {
      expect(IDENTITY_MAX_PRICE_PER_PERSON_RUPEES).toBe(5000)
      expect(IDENTITY_MAX_PARTICIPANTS_PER_SLOT).toBe(8)
    })
  })

  describe('business tier is unrestricted', () => {
    it('allows a combo, multi-day, over-price, over-capacity listing', () => {
      const result = assertWithinTier({
        kycTier: 'business',
        pricePerPersonRupees: 50000,
        isCombo: true,
        slots: [
          {
            startAt: new Date('2026-06-01T09:00:00.000Z'),
            endAt: new Date('2026-06-05T17:00:00.000Z'),
            capacity: 40,
          },
        ],
      })
      expect(result).toEqual({ ok: true })
    })
  })

  describe('phone tier cannot publish', () => {
    it('blocks even a fully compliant listing', () => {
      const result = assertWithinTier(baseInput({ kycTier: 'phone' }))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('PHONE_CANNOT_PUBLISH')
      }
    })
  })

  describe('identity tier — per-person price cap', () => {
    it('allows exactly Rs.5,000 per person', () => {
      const result = assertWithinTier(baseInput({ pricePerPersonRupees: 5000 }))
      expect(result).toEqual({ ok: true })
    })

    it('blocks Rs.5,001 per person', () => {
      const result = assertWithinTier(baseInput({ pricePerPersonRupees: 5001 }))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('PRICE_OVER_CAP')
      }
    })
  })

  describe('identity tier — participants per slot cap', () => {
    it('allows a slot with capacity 8', () => {
      const result = assertWithinTier(
        baseInput({ slots: [{ ...SINGLE_DAY_SLOT, capacity: 8 }] }),
      )
      expect(result).toEqual({ ok: true })
    })

    it('blocks a slot with capacity 9', () => {
      const result = assertWithinTier(
        baseInput({ slots: [{ ...SINGLE_DAY_SLOT, capacity: 9 }] }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('CAPACITY_OVER_CAP')
      }
    })
  })

  describe('identity tier — no combo', () => {
    it('blocks a combo Experience', () => {
      const result = assertWithinTier(baseInput({ isCombo: true }))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('COMBO_NOT_ALLOWED')
      }
    })
  })

  describe('identity tier — single-day only', () => {
    it('blocks a multi-day slot (start and end on different calendar days)', () => {
      const result = assertWithinTier(
        baseInput({
          slots: [
            {
              startAt: new Date('2026-06-01T09:00:00.000Z'),
              endAt: new Date('2026-06-03T17:00:00.000Z'),
              capacity: 8,
            },
          ],
        }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('MULTI_DAY_NOT_ALLOWED')
      }
    })

    it('allows a slot spanning into the late evening on the same calendar day', () => {
      const result = assertWithinTier(
        baseInput({
          slots: [
            {
              startAt: new Date('2026-06-01T06:00:00.000Z'),
              endAt: new Date('2026-06-01T23:30:00.000Z'),
              capacity: 8,
            },
          ],
        }),
      )
      expect(result).toEqual({ ok: true })
    })
  })

  describe('identity tier — no slots to check', () => {
    it('allows an Experience with no materialised slots (price + combo still checked)', () => {
      const result = assertWithinTier(baseInput({ slots: [] }))
      expect(result).toEqual({ ok: true })
    })

    it('still blocks over-price even with no slots', () => {
      const result = assertWithinTier(
        baseInput({ slots: [], pricePerPersonRupees: 9999 }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('PRICE_OVER_CAP')
      }
    })
  })

  describe('identity tier — multiple slots, first violation reported', () => {
    it('blocks when any one of several slots is over capacity', () => {
      const result = assertWithinTier(
        baseInput({
          slots: [
            { ...SINGLE_DAY_SLOT, capacity: 8 },
            { ...SINGLE_DAY_SLOT, capacity: 12 },
          ],
        }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('CAPACITY_OVER_CAP')
      }
    })
  })
})
