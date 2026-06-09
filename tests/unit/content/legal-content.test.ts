import { describe, expect, it } from 'vitest'

import {
  LEGAL_PAGES,
  LEGAL_REVIEW_NOTICE_KEY,
  CANCELLATION_PRESETS,
  REFUND_SLA,
  PAYOUT_FACTS,
  type LegalPageId,
} from '@/lib/legal/content'

/**
 * Contract for the pure legal-content module (issue 07).
 *
 * The four legal pages (/terms, /privacy, /refund-cancellation,
 * /vendor-terms) are business-safe drafts pending final counsel review.
 * The load-bearing facts — cancellation presets (ADR-0005), refund SLAs
 * (ADR-0004), and Payout / TDS facts (ADR-0016) — must be accurate and are
 * therefore pinned here so they are unit-assertable without rendering a page.
 */

describe('legal page registry', () => {
  it('enumerates exactly the four bare-path legal routes', () => {
    const paths = LEGAL_PAGES.map((p) => p.path).sort()
    expect(paths).toEqual([
      '/privacy',
      '/refund-cancellation',
      '/terms',
      '/vendor-terms',
    ])
  })

  it('uses one PascalCase namespace per page', () => {
    const byId: Record<LegalPageId, string> = {
      terms: 'TermsPage',
      privacy: 'PrivacyPage',
      'refund-cancellation': 'RefundCancellationPage',
      'vendor-terms': 'VendorTermsPage',
    }
    for (const page of LEGAL_PAGES) {
      expect(page.namespace).toBe(byId[page.id])
    }
  })

  it('exposes a stable "pending final legal review" notice key shared by all pages', () => {
    expect(LEGAL_REVIEW_NOTICE_KEY).toBe('reviewNotice')
  })
})

describe('cancellation presets (ADR-0005) are accurate', () => {
  it('has exactly the three presets in order', () => {
    expect(CANCELLATION_PRESETS.map((p) => p.id)).toEqual([
      'flexible',
      'moderate',
      'strict',
    ])
  })

  it('Flexible: free up to T-24h, 50% up to T-2h', () => {
    const flexible = CANCELLATION_PRESETS.find((p) => p.id === 'flexible')!
    expect(flexible.freeUntil).toBe('T-24h')
    expect(flexible.halfUntil).toBe('T-2h')
  })

  it('Moderate: free up to T-72h, 50% up to T-24h', () => {
    const moderate = CANCELLATION_PRESETS.find((p) => p.id === 'moderate')!
    expect(moderate.freeUntil).toBe('T-72h')
    expect(moderate.halfUntil).toBe('T-24h')
  })

  it('Strict: free up to T-14d, 50% up to T-7d', () => {
    const strict = CANCELLATION_PRESETS.find((p) => p.id === 'strict')!
    expect(strict.freeUntil).toBe('T-14d')
    expect(strict.halfUntil).toBe('T-7d')
  })
})

describe('refund SLA (ADR-0004) does not over-promise', () => {
  it('wallet increment is 24–48h, distinct from the 5–7 working day bank cashout', () => {
    expect(REFUND_SLA.walletWindow).toBe('24–48h')
    expect(REFUND_SLA.bankCashoutWindow).toBe('5–7 working days')
  })
})

describe('Payout / tax facts (ADR-0016) are accurate', () => {
  it('TDS is 0.1% under Section 194-O', () => {
    expect(PAYOUT_FACTS.tdsRate).toBe('0.1%')
    expect(PAYOUT_FACTS.tdsSection).toBe('194-O')
  })

  it('Payout is issued T+7 from Booking Completion', () => {
    expect(PAYOUT_FACTS.payoutTiming).toBe('T+7')
  })
})
