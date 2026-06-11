import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * QA fix pass — safety-page claim audit (LATEST FEEDBACK #6 / #17).
 *
 * The safety page may only state features the codebase actually ships:
 *   - SOS event capture has no `sos_events` schema yet and SMS has no sender
 *     (only the WhatsApp send-intent exists) → no unconditional
 *     "SOS … WhatsApp and SMS" claim; SOS copy must be feature-conditional.
 *   - There is no location-snapshot storage → no "auto-deleted 72 hours"
 *     retention promise stated as live behavior.
 *   - The dispute queue exists but no enforced SLA timer → 48h is a target
 *     ("we aim to"), not a guarantee.
 *
 * Claims that ARE built stay un-hedged: Aadhaar eKYC, recorded video-call
 * checks, two-bucket Wallet, T-24h auto-capture (this test deliberately does
 * not touch those).
 */
describe('safety copy — only shipped features stated unconditionally', () => {
  const raw = readFileSync(
    join(process.cwd(), 'lib/i18n/messages/en.json'),
    'utf8',
  )
  const en = JSON.parse(raw) as Record<string, unknown>
  const safety = JSON.stringify(en.SafetyPage)

  // Whole-file checks: the same over-claims also lived on AboutPage
  // (howItWorks.trustBody, honesty.body) and HelpPage (faq.safetyStack).
  it('never claims an unconditional WhatsApp-and-SMS SOS fan-out anywhere', () => {
    expect(raw).not.toContain('WhatsApp and SMS')
  })

  it('never promises a live 72-hour location auto-delete anywhere', () => {
    expect(raw).not.toContain('auto-deleted 72 hours')
  })

  it('mentions SOS only with a feature-conditional hedge', () => {
    // Every SOS-capability claim must carry "where enabled" / "where
    // supported" phrasing in the same value (posture statements that describe
    // what SOS does NOT do are exempt by construction — they contain
    // "notifies people" / "not an emergency").
    const offenders: string[] = []
    function walk(node: unknown, path: string[]): void {
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walk(v, [...path, k])
        return
      }
      if (typeof node !== 'string' || !node.includes('SOS')) return
      const hedged =
        node.includes('where enabled') ||
        node.includes('where supported') ||
        node.includes('If trip location sharing is enabled') ||
        // Pure posture/disclaimer statements (what SOS is NOT).
        node.includes('notifies people') ||
        node.includes('not an emergency')
      if (!hedged) offenders.push(path.join('.'))
    }
    walk(en, [])
    // Titles are nav labels, not capability claims.
    const claimOffenders = offenders.filter((p) => !p.endsWith('Title'))
    expect(claimOffenders).toEqual([])
  })

  it('states the 48-hour dispute window as a target, not a guarantee', () => {
    expect(safety).not.toContain('are resolved within 48 hours')
    expect(safety).toContain('we aim to resolve')
  })
})
