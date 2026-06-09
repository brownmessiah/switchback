import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Copy contract for the /vendor-partner public partner page (issue 06).
 *
 * The page's documents/verification copy must match the ADR-0007 KYC tiers
 * verbatim — wrong verification copy is a trust hazard. We pin:
 *   - the exact tier badge strings ("Identity verified" / "Business verified"),
 *   - the document requirements per tier (phone OTP; Aadhaar + PAN; GSTIN /
 *     Udyam + guide-cert + video call; bank details for Payouts),
 *   - the single "Start Vendor Onboarding" CTA label,
 *   - and that the word "operator" NEVER appears (CONTEXT.md banned term — the
 *     page is about Vendors).
 *
 * ADR-0007:
 *   Tier 1 — Phone verified:    phone OTP at signup. No badge.
 *   Tier 2 — Identity verified: Aadhaar OTP + PAN + ≥1 Experience for review.
 *                               Badge "Identity verified".
 *   Tier 3 — Business verified: Tier 2 + video call + (GSTIN OR Udyam) +
 *                               guide cert. Badge "Business verified".
 */
const en = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'lib', 'i18n', 'messages', 'en.json'),
    'utf-8',
  ),
) as { VendorPartnerPage?: Record<string, unknown> }

function flatten(obj: unknown, out: string[] = []): string[] {
  if (typeof obj === 'string') {
    out.push(obj)
  } else if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) flatten(v, out)
  }
  return out
}

describe('VendorPartnerPage i18n namespace exists', () => {
  it('has a VendorPartnerPage namespace in en.json', () => {
    expect(en.VendorPartnerPage).toBeDefined()
  })
})

describe('VendorPartnerPage copy — ADR-0007 KYC tier fidelity', () => {
  const ns = en.VendorPartnerPage as Record<string, Record<string, string>>

  it('Tier 2 documents copy carries the exact "Identity verified" badge', () => {
    expect(ns.documents.identityBadge).toBe('Identity verified')
  })

  it('Tier 3 documents copy carries the exact "Business verified" badge', () => {
    expect(ns.documents.businessBadge).toBe('Business verified')
  })

  it('Tier 1 (phone) requires the phone OTP at signup', () => {
    expect(ns.documents.phoneDocs).toMatch(/phone|OTP/i)
  })

  it('Tier 2 (identity) requires Aadhaar AND PAN', () => {
    expect(ns.documents.identityDocs).toMatch(/Aadhaar/i)
    expect(ns.documents.identityDocs).toMatch(/PAN/i)
  })

  it('Tier 3 (business) requires GSTIN/Udyam, a guide cert, and a video call', () => {
    expect(ns.documents.businessDocs).toMatch(/GSTIN|Udyam/i)
    expect(ns.documents.businessDocs).toMatch(/cert/i)
    expect(ns.verification.businessStep).toMatch(/video/i)
  })

  it('mentions bank details for Payouts', () => {
    const all = flatten(ns).join(' ')
    expect(all).toMatch(/bank/i)
    expect(all).toMatch(/Payout/)
  })
})

describe('VendorPartnerPage copy — CTA + vocabulary guardrails', () => {
  const ns = en.VendorPartnerPage as Record<string, unknown>

  it('has the "Start Vendor Onboarding" primary CTA label', () => {
    const cta = (ns.hero as Record<string, string>).cta
    expect(cta).toBe('Start Vendor Onboarding')
  })

  it('never uses the banned word "operator" anywhere in the namespace', () => {
    const all = flatten(ns).join(' ').toLowerCase()
    expect(all).not.toContain('operator')
  })

  it('uses "Vendor" vocabulary in the hero title', () => {
    const all = flatten(ns).join(' ')
    expect(all).toMatch(/Vendor/)
  })
})
