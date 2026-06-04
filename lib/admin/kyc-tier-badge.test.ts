import { describe, expect, it } from 'vitest'

import { kycTierBadge } from './kyc-tier-badge'

describe('kycTierBadge', () => {
  it('maps business → the strongest (success) variant with a distinct label', () => {
    const spec = kycTierBadge('business')
    expect(spec.variant).toBe('success')
    expect(spec.label).toBe('Business verified')
  })

  it('maps identity → info variant (distinct from business) with its own label', () => {
    const spec = kycTierBadge('identity')
    expect(spec.variant).toBe('info')
    expect(spec.label).toBe('Identity verified')
  })

  it('maps phone → warning variant (signup-only, cannot publish) with its own label', () => {
    const spec = kycTierBadge('phone')
    expect(spec.variant).toBe('warning')
    expect(spec.label).toBe('Phone verified')
  })

  it('gives the three tiers three DIFFERENT variants (tier ramp, not all-green)', () => {
    const variants = new Set([
      kycTierBadge('business').variant,
      kycTierBadge('identity').variant,
      kycTierBadge('phone').variant,
    ])
    expect(variants.size).toBe(3)
  })

  it('pairs every tier with an icon (a11y: never colour alone)', () => {
    expect(kycTierBadge('business').icon).toBeTruthy()
    expect(kycTierBadge('identity').icon).toBeTruthy()
    expect(kycTierBadge('phone').icon).toBeTruthy()
  })

  it('falls back to a neutral outline + the raw tier label for an unknown value', () => {
    const spec = kycTierBadge('mystery')
    expect(spec.variant).toBe('outline')
    expect(spec.label).toBe('mystery')
  })
})
