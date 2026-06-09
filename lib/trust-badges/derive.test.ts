import { describe, expect, it } from 'vitest'

import {
  deriveTrustBadges,
  type TrustBadgeId,
  type TrustBadgeInput,
} from './derive'

/**
 * Data-honesty (D0): a TrustBadge renders ONLY when that listing's real data
 * backs it. These tests pin the eligibility rule for each badge in the
 * canonical vocabulary — present WITH backing data, absent WITHOUT.
 *
 * Eligibility (ADR-0001/0005/0007/0015 + ADR-0017 difficulty):
 *   - verified-vendor       : vendorKycTier ∈ {identity, business} (never phone)
 *   - safety-checked        : requiresSafetyStack === true
 *   - instant-confirmation  : universal (ADR-0003: every paid Booking confirms instantly)
 *   - partial-pay           : paymentModesAllowed includes 'partial_pay' AND base price ≤ Rs.25,000
 *   - flexible-cancellation : cancellationPreset === 'flexible'
 *   - beginner-friendly     : difficulty === 'easy'
 *
 * "Popular Choice" is intentionally NOT derived here — it reuses the existing
 * social-proof `highlight` signal (deriveHighlight in card-badges.ts), which is
 * rendered as a distinct image overlay. trust-badges owns the trust dimension.
 */

/** A bare listing that backs NO trust badge except the universal instant one. */
const bare: TrustBadgeInput = {
  vendorKycTier: 'phone',
  requiresSafetyStack: false,
  cancellationPreset: 'moderate',
  difficulty: 'challenging',
  paymentModesAllowed: ['full_upfront'],
  basePriceRupees: 30_000,
}

function ids(input: TrustBadgeInput): TrustBadgeId[] {
  return deriveTrustBadges(input).map((b) => b.id)
}

describe('deriveTrustBadges — instant-confirmation (universal, ADR-0003)', () => {
  it('always includes instant-confirmation even for a bare listing', () => {
    expect(ids(bare)).toContain('instant-confirmation')
  })
})

describe('deriveTrustBadges — verified-vendor (ADR-0007 KYC tier)', () => {
  it('absent when vendorKycTier is phone (below identity)', () => {
    expect(ids({ ...bare, vendorKycTier: 'phone' })).not.toContain('verified-vendor')
  })

  it('present when vendorKycTier is identity', () => {
    expect(ids({ ...bare, vendorKycTier: 'identity' })).toContain('verified-vendor')
  })

  it('present when vendorKycTier is business', () => {
    expect(ids({ ...bare, vendorKycTier: 'business' })).toContain('verified-vendor')
  })

  it('carries the tier-specific label key (identity vs business)', () => {
    const identity = deriveTrustBadges({ ...bare, vendorKycTier: 'identity' }).find(
      (b) => b.id === 'verified-vendor',
    )
    const business = deriveTrustBadges({ ...bare, vendorKycTier: 'business' }).find(
      (b) => b.id === 'verified-vendor',
    )
    expect(identity?.labelKey).toBe('verifiedVendor.identity')
    expect(business?.labelKey).toBe('verifiedVendor.business')
  })
})

describe('deriveTrustBadges — safety-checked (ADR-0015)', () => {
  it('absent when requiresSafetyStack is false (E2E invariant)', () => {
    expect(ids({ ...bare, requiresSafetyStack: false })).not.toContain('safety-checked')
  })

  it('present when requiresSafetyStack is true', () => {
    expect(ids({ ...bare, requiresSafetyStack: true })).toContain('safety-checked')
  })
})

describe('deriveTrustBadges — flexible-cancellation (ADR-0005)', () => {
  it('present only for the flexible preset', () => {
    expect(ids({ ...bare, cancellationPreset: 'flexible' })).toContain(
      'flexible-cancellation',
    )
  })

  it('absent for moderate / strict / custom presets', () => {
    expect(ids({ ...bare, cancellationPreset: 'moderate' })).not.toContain(
      'flexible-cancellation',
    )
    expect(ids({ ...bare, cancellationPreset: 'strict' })).not.toContain(
      'flexible-cancellation',
    )
    expect(ids({ ...bare, cancellationPreset: 'custom' })).not.toContain(
      'flexible-cancellation',
    )
  })
})

describe('deriveTrustBadges — beginner-friendly (ADR-0017 difficulty)', () => {
  it('present only for the easy difficulty tier', () => {
    expect(ids({ ...bare, difficulty: 'easy' })).toContain('beginner-friendly')
  })

  it('absent for harder tiers and when difficulty is null', () => {
    expect(ids({ ...bare, difficulty: 'moderate' })).not.toContain('beginner-friendly')
    expect(ids({ ...bare, difficulty: 'challenging' })).not.toContain(
      'beginner-friendly',
    )
    expect(ids({ ...bare, difficulty: 'extreme' })).not.toContain('beginner-friendly')
    expect(ids({ ...bare, difficulty: null })).not.toContain('beginner-friendly')
  })
})

describe('deriveTrustBadges — partial-pay (ADR-0001)', () => {
  it('present when partial_pay is allowed and base price ≤ Rs.25,000', () => {
    expect(
      ids({
        ...bare,
        paymentModesAllowed: ['full_upfront', 'partial_pay'],
        basePriceRupees: 25_000,
      }),
    ).toContain('partial-pay')
  })

  it('absent when the Experience does not offer partial_pay', () => {
    expect(
      ids({
        ...bare,
        paymentModesAllowed: ['full_upfront'],
        basePriceRupees: 10_000,
      }),
    ).not.toContain('partial-pay')
  })

  it('absent above the Rs.25,000 escrow carve-out (100%-upfront default)', () => {
    expect(
      ids({
        ...bare,
        paymentModesAllowed: ['full_upfront', 'partial_pay'],
        basePriceRupees: 25_001,
      }),
    ).not.toContain('partial-pay')
  })
})

describe('deriveTrustBadges — ordering + full vocabulary', () => {
  it('returns badges in the canonical order when a listing backs all of them', () => {
    const full: TrustBadgeInput = {
      vendorKycTier: 'business',
      requiresSafetyStack: true,
      cancellationPreset: 'flexible',
      difficulty: 'easy',
      paymentModesAllowed: ['full_upfront', 'partial_pay'],
      basePriceRupees: 5_000,
    }
    expect(ids(full)).toEqual([
      'verified-vendor',
      'safety-checked',
      'instant-confirmation',
      'partial-pay',
      'flexible-cancellation',
      'beginner-friendly',
    ])
  })

  it('every returned badge carries a stable labelKey', () => {
    for (const badge of deriveTrustBadges(bare)) {
      expect(typeof badge.labelKey).toBe('string')
      expect(badge.labelKey.length).toBeGreaterThan(0)
    }
  })
})
