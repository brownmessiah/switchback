import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Regression guard: the Experience-detail (PDP) cancellation copy must state
 * the SAME refund windows as ADR-0005 (and as the /cancellation-policy page).
 * A defect (found in the #12 review) had the PDP showing 7-days/48-hours for
 * Moderate and a 7-days-only Strict — both wrong vs ADR-0005. Showing wrong
 * refund terms is a trust/legal hazard (ADR-0005: refund clarity is the #1
 * competitive wedge), so pin the windows here.
 *
 * ADR-0005 presets:
 *   Flexible — free up to T-24h, 50% up to T-2h, none after
 *   Moderate — free up to T-72h, 50% up to T-24h, none after
 *   Strict   — free up to T-14d, 50% up to T-7d,  none after
 */
const en = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'lib', 'i18n', 'messages', 'en.json'),
    'utf-8',
  ),
) as {
  ExperiencePage: { cancellation: Record<string, string> }
}

const c = en.ExperiencePage.cancellation

describe('PDP cancellation copy matches ADR-0005 windows', () => {
  it('Flexible: 24 hours free, 2 hours half', () => {
    expect(c.flexible).toMatch(/24 hours/)
    expect(c.flexible).toMatch(/2 hours/)
  })

  it('Moderate: 72 hours free, 24 hours half (NOT 7 days / 48 hours)', () => {
    expect(c.moderate).toMatch(/72 hours/)
    expect(c.moderate).toMatch(/24 hours/)
    expect(c.moderate).not.toMatch(/7 days/)
    expect(c.moderate).not.toMatch(/48 hours/)
  })

  it('Strict: 14 days free, 7 days half', () => {
    expect(c.strict).toMatch(/14 days/)
    expect(c.strict).toMatch(/7 days/)
  })
})
