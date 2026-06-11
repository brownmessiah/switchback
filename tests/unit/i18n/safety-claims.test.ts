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
describe('SafetyPage copy — only shipped features stated unconditionally', () => {
  const en = JSON.parse(
    readFileSync(join(process.cwd(), 'lib/i18n/messages/en.json'), 'utf8'),
  ) as Record<string, unknown>
  const safety = JSON.stringify(en.SafetyPage)

  it('does not claim an unconditional WhatsApp-and-SMS SOS fan-out', () => {
    expect(safety).not.toContain('WhatsApp and SMS')
  })

  it('does not promise a live 72-hour location auto-delete', () => {
    expect(safety).not.toContain('auto-deleted 72 hours')
  })

  it('states the 48-hour dispute window as a target, not a guarantee', () => {
    expect(safety).not.toContain('are resolved within 48 hours')
    expect(safety).toContain('we aim to resolve')
  })
})
