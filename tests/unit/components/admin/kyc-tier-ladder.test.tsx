import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { KycTierLadder } from '@/app/admin/vendors/[id]/kyc-tier-ladder'

// #101 — the decision rail's KYC tier ladder (ADR-0007): phone → identity →
// business, in strict promotion order, with the Vendor's CURRENT tier marked so
// the reviewer sees where the Vendor sits and what the next step is. This
// replaces the as-is single line of prose ("Promote to Tier 2 — Identity") with
// a visible progression model.

afterEach(() => cleanup())

describe('KycTierLadder', () => {
  it('renders all three ADR-0007 tiers in promotion order', () => {
    render(<KycTierLadder currentTier="phone" />)
    const ladder = screen.getByTestId('kyc-tier-ladder')
    const steps = within(ladder).getAllByTestId(/^kyc-tier-step-/)
    expect(steps.map((s) => s.getAttribute('data-tier'))).toEqual([
      'phone',
      'identity',
      'business',
    ])
  })

  it('marks the current tier as current and earlier tiers as complete', () => {
    render(<KycTierLadder currentTier="identity" />)
    const ladder = screen.getByTestId('kyc-tier-ladder')
    expect(
      within(ladder).getByTestId('kyc-tier-step-phone').getAttribute('data-state'),
    ).toBe('complete')
    expect(
      within(ladder).getByTestId('kyc-tier-step-identity').getAttribute('data-state'),
    ).toBe('current')
    expect(
      within(ladder).getByTestId('kyc-tier-step-business').getAttribute('data-state'),
    ).toBe('upcoming')
  })

  it('marks the top business tier as current with no upcoming step', () => {
    render(<KycTierLadder currentTier="business" />)
    const ladder = screen.getByTestId('kyc-tier-ladder')
    expect(
      within(ladder).getByTestId('kyc-tier-step-business').getAttribute('data-state'),
    ).toBe('current')
    expect(
      within(ladder).getByTestId('kyc-tier-step-phone').getAttribute('data-state'),
    ).toBe('complete')
    expect(
      within(ladder).getByTestId('kyc-tier-step-identity').getAttribute('data-state'),
    ).toBe('complete')
  })
})
