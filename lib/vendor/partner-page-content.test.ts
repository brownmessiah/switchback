import { describe, expect, it } from 'vitest'

import {
  VENDOR_ONBOARDING_HREF,
  VENDOR_PARTNER_PATH,
  partnerPageContent,
} from './partner-page-content'

/**
 * Contract for the /vendor-partner public partner page (issue 06).
 *
 * The page's section structure + the KYC-tier → documents mapping live in a
 * pure module so the ADR-0007 fidelity is unit-testable without rendering the
 * async server component. The page is a thin presentational consumer of this
 * structure; the i18n copy is asserted separately (partner-page-copy.test.ts).
 *
 * ADR-0007 tiers (verbatim badge strings):
 *   Tier 1 — Phone verified   (no badge)
 *   Tier 2 — Identity verified (badge "Identity verified")
 *   Tier 3 — Business verified (badge "Business verified")
 */

describe('partnerPageContent — required sections (issue 06)', () => {
  const sectionIds = partnerPageContent.sections.map((s) => s.id)

  it('includes every required section in order', () => {
    expect(sectionIds).toEqual([
      'benefits',
      'whoCanJoin',
      'documents',
      'verification',
      'bookingPayout',
    ])
  })

  it('benefits section enumerates the five marketplace benefits', () => {
    const benefits = partnerPageContent.sections.find((s) => s.id === 'benefits')
    expect(benefits?.items.map((i) => i.id)).toEqual([
      'onlineBookings',
      'verifiedBadge',
      'dashboard',
      'payoutTracking',
      'visibility',
    ])
  })
})

describe('partnerPageContent — documents mapped to KYC tiers (ADR-0007)', () => {
  const documents = partnerPageContent.sections.find((s) => s.id === 'documents')

  it('has exactly the three ADR-0007 tiers in ladder order', () => {
    expect(documents?.items.map((i) => i.id)).toEqual([
      'phone',
      'identity',
      'business',
    ])
  })

  it('Tier 1 (phone) has NO badge string', () => {
    const phone = documents?.items.find((i) => i.id === 'phone')
    expect(phone?.badge).toBeNull()
  })

  it('Tier 2 uses the exact "Identity verified" badge string', () => {
    const identity = documents?.items.find((i) => i.id === 'identity')
    expect(identity?.badge).toBe('Identity verified')
  })

  it('Tier 3 uses the exact "Business verified" badge string', () => {
    const business = documents?.items.find((i) => i.id === 'business')
    expect(business?.badge).toBe('Business verified')
  })
})

describe('partnerPageContent — CTA targets', () => {
  it('the single primary CTA points at the real auth-gated onboarding route', () => {
    expect(VENDOR_ONBOARDING_HREF).toBe('/vendor/onboarding')
  })

  it('the partner page lives at the bare-path /vendor-partner (no /en, no /operators)', () => {
    expect(VENDOR_PARTNER_PATH).toBe('/vendor-partner')
    expect(VENDOR_PARTNER_PATH).not.toContain('/en')
    expect(VENDOR_PARTNER_PATH).not.toContain('operator')
  })
})
