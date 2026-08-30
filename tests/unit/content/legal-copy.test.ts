import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Copy contract for the four legal pages (issue 07): Terms, Privacy,
 * Refund & Cancellation, Vendor Terms.
 *
 * These are business-safe drafts pending final counsel review. The copy must
 * reflect the REAL model and must not over-promise:
 *   - Switchback is a marketplace / intermediary; Experiences are run by
 *     independent third-party Vendors.
 *   - Cancellation presets per ADR-0005 (Flexible / Moderate / Strict).
 *   - Refund SLA per ADR-0004: wallet (Refund balance) credited 24–48h;
 *     cashable to bank in 5–7 working days. The 24–48h is the WALLET
 *     increment, not the bank cashout.
 *   - Payout / GST / TDS per ADR-0016: TDS 0.1% under Section 194-O;
 *     Payout issued T+7 from Completion.
 *   - Every page carries a visible "pending final legal review" note.
 *
 * Banned vocabulary (CONTEXT.md / guardrails): "operator", "settlement",
 * "disbursement", "free cancellation", "guaranteed", balances called
 * "account".
 */

const en = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'lib', 'i18n', 'messages', 'en.json'),
    'utf-8',
  ),
) as Record<string, unknown>

function flatten(obj: unknown, out: string[] = []): string[] {
  if (typeof obj === 'string') {
    out.push(obj)
  } else if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) flatten(v, out)
  }
  return out
}

const NAMESPACES = [
  'TermsPage',
  'PrivacyPage',
  'RefundCancellationPage',
  'VendorTermsPage',
] as const

describe('legal namespaces exist in en.json', () => {
  for (const ns of NAMESPACES) {
    it(`en.json has namespace "${ns}"`, () => {
      expect(en[ns]).toBeDefined()
      expect(typeof en[ns]).toBe('object')
    })
  }
})

describe('every legal page carries a "pending final legal review" note', () => {
  for (const ns of NAMESPACES) {
    it(`${ns} has a reviewNotice mentioning final legal review`, () => {
      const notice = (en[ns] as Record<string, unknown>).reviewNotice
      expect(typeof notice).toBe('string')
      expect(notice as string).toMatch(/pending final legal review/i)
    })

    it(`${ns} has SEO metadata title + description`, () => {
      const metadata = (en[ns] as Record<string, Record<string, string>>).metadata
      expect(typeof metadata.title).toBe('string')
      expect(typeof metadata.description).toBe('string')
    })

    it(`${ns} has a breadcrumb label`, () => {
      const breadcrumb = (en[ns] as Record<string, Record<string, string>>).breadcrumb
      expect(typeof breadcrumb.label).toBe('string')
    })
  }
})

describe('Terms copy: marketplace / intermediary with independent third-party Vendors', () => {
  const all = flatten(en.TermsPage).join(' ')
  it('describes Switchback as a marketplace / intermediary', () => {
    expect(all).toMatch(/marketplace|intermediary/i)
  })
  it('states Experiences are run by independent third-party Vendors', () => {
    expect(all).toMatch(/independent third-party Vendors/)
  })
})

describe('Refund & Cancellation copy: ADR-0005 presets + ADR-0004 SLA', () => {
  const all = flatten(en.RefundCancellationPage).join(' ')

  it('names the three presets', () => {
    expect(all).toMatch(/Flexible/)
    expect(all).toMatch(/Moderate/)
    expect(all).toMatch(/Strict/)
  })

  it('Flexible window: T-24h free, T-2h half', () => {
    expect(all).toMatch(/24 hours/)
    expect(all).toMatch(/2 hours/)
  })

  it('Moderate window: T-72h free, T-24h half', () => {
    expect(all).toMatch(/72 hours/)
  })

  it('Strict window: T-14d free, T-7d half', () => {
    expect(all).toMatch(/14 days/)
    expect(all).toMatch(/7 days/)
  })

  it('refund SLA: wallet (Refund balance) credited 24–48h', () => {
    expect(all).toMatch(/Refund balance/)
    expect(all).toMatch(/24[–-]48\s*h(ours)?/i)
  })

  it('refund SLA: bank cashout 5–7 working days, distinct from the wallet increment', () => {
    expect(all).toMatch(/5[–-]7 working days/)
  })

  it('inside-policy body carries no conflicting timing claim (ADR-0004: timing lives only in the SLA section)', () => {
    const insidePolicyBody = (
      (en.RefundCancellationPage as Record<string, Record<string, string>>).insidePolicy
    ).body
    expect(insidePolicyBody).not.toMatch(/minutes/i)
    expect(insidePolicyBody).not.toMatch(/instant/i)
  })

  it('refund SLA body is the single source of the 24–48h timing', () => {
    const slaBody = (
      (en.RefundCancellationPage as Record<string, Record<string, string>>).refundSla
    ).body
    expect(slaBody).toMatch(/24[–-]48/)
  })

  it('Vendor-cancelled Booking is always a full refund', () => {
    expect(all).toMatch(/Vendor/)
    expect(all).toMatch(/full refund/i)
  })

  it('links the existing /cancellation-policy page', () => {
    // The calculator lives on /cancellation-policy; this page references it.
    expect((en.RefundCancellationPage as Record<string, unknown>).policyLink).toBeDefined()
  })
})

describe('Vendor Terms copy: ADR-0007 KYC + ADR-0016 Payout / TDS / GST', () => {
  const all = flatten(en.VendorTermsPage).join(' ')

  it('names the three KYC tiers', () => {
    expect(all).toMatch(/Phone verified/)
    expect(all).toMatch(/Identity verified/)
    expect(all).toMatch(/Business verified/)
  })

  it('TDS is 0.1% under Section 194-O', () => {
    expect(all).toMatch(/0\.1%/)
    expect(all).toMatch(/194-O/)
  })

  it('Payout is issued T+7 from Completion, net of Commission + GST + TDS', () => {
    expect(all).toMatch(/Payout/)
    expect(all).toMatch(/T\+7/)
    expect(all).toMatch(/Commission/)
    expect(all).toMatch(/GST/)
  })

  it('Vendor cancellation triggers a full refund', () => {
    expect(all).toMatch(/full refund/i)
  })
})

describe('Privacy copy: data handling, business-safe', () => {
  const all = flatten(en.PrivacyPage).join(' ')
  it('mentions personal data / information collected', () => {
    expect(all).toMatch(/personal (data|information)/i)
  })
})

describe('no banned vocabulary in any legal namespace', () => {
  for (const ns of NAMESPACES) {
    const all = flatten(en[ns]).join(' ')
    const lower = all.toLowerCase()

    it(`${ns}: never says "operator"`, () => {
      expect(lower).not.toMatch(/\boperator\b/)
    })
    it(`${ns}: never says "settlement" or "disbursement" for Payout`, () => {
      expect(lower).not.toContain('settlement')
      expect(lower).not.toContain('disbursement')
    })
    it(`${ns}: never says "free cancellation"`, () => {
      expect(lower).not.toContain('free cancellation')
    })
    it(`${ns}: never over-promises with "guaranteed"`, () => {
      expect(lower).not.toContain('guaranteed')
    })
  }
})
