import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { glob } from 'glob'

/**
 * Credibility copy + locale sweep (issue 01).
 *
 * Guards three honesty fixes across ALL locale message files:
 *   1. No fake-traction claim ("Booked by 40,000+ travellers.") — the
 *      `SignInPage.trustPanel.heading` must be non-numeric, honest copy and
 *      must not call Customers "travellers".
 *   2. No safety over-promise ("Everything below is a feature that exists
 *      today, not a promise.") — the SafetyPage hero softens to make clear
 *      verification varies by Experience and Vendor.
 *   3. The homepage trust chip reads "Flexible cancellation", never "Free
 *      cancellation" (CONTEXT.md: Inside-policy / Flexible cancellation;
 *      _Avoid_ "Free cancellation").
 *
 * The correct Vendor-cancellation "100% refund" string (ADR-0005: a
 * Vendor-cancelled Booking is ALWAYS a full refund) must be PRESERVED.
 *
 * The sweep scans every file via glob so the locale count is irrelevant.
 */

const ROOT = resolve(__dirname, '../../..')
const MESSAGES_GLOB = 'lib/i18n/messages/*.json'

function localeFiles(): { path: string; locale: string; raw: string }[] {
  const paths = glob
    .sync(MESSAGES_GLOB, { cwd: ROOT })
    .map((p) => resolve(ROOT, p))
  expect(paths.length).toBeGreaterThan(0)
  return paths.map((path) => ({
    path,
    locale: path.replace(/.*\/([a-z]+)\.json$/, '$1'),
    raw: readFileSync(path, 'utf-8'),
  }))
}

function get(obj: Record<string, unknown>, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

describe('credibility copy + locale sweep', () => {
  const files = localeFiles()

  describe('no fake-traction claim', () => {
    for (const { locale, raw } of files) {
      it(`${locale}.json contains no "40,000" traction number`, () => {
        expect(raw).not.toContain('40,000')
      })

      it(`${locale}.json contains no "40000" traction number`, () => {
        expect(raw).not.toContain('40000')
      })
    }

    for (const { locale, raw } of files) {
      it(`${locale}.json SignInPage.trustPanel.heading is not the traveller claim`, () => {
        const json = JSON.parse(raw) as Record<string, unknown>
        const heading = get(json, 'SignInPage.trustPanel.heading')
        expect(typeof heading).toBe('string')
        // No traction number, no English "traveller(s)" (domain _Avoid_).
        expect(heading as string).not.toMatch(/40,?000/)
        expect(heading as string).not.toMatch(/travellers?/i)
        expect((heading as string).length).toBeGreaterThan(0)
      })
    }
  })

  describe('no safety over-promise', () => {
    for (const { locale, raw } of files) {
      it(`${locale}.json SafetyPage hero drops the "not a promise" over-claim`, () => {
        const json = JSON.parse(raw) as Record<string, unknown>
        const description = get(json, 'SafetyPage.hero.description')
        expect(typeof description).toBe('string')
        // The English over-promise must be gone from every file.
        expect(raw).not.toContain('not a promise')
        expect(raw).not.toContain('a feature that exists today')
      })
    }

    it('en.json SafetyPage hero carries the softened, honest line', () => {
      const en = JSON.parse(
        readFileSync(resolve(ROOT, 'lib/i18n/messages/en.json'), 'utf-8'),
      ) as Record<string, unknown>
      const description = get(en, 'SafetyPage.hero.description') as string
      expect(description).toContain(
        'Some safety and verification features may vary by experience and vendor.',
      )
      expect(description).toContain('shows what is verified before you book')
    })
  })

  describe('homepage trust chip: Flexible cancellation (never Free)', () => {
    it('en.json HomePage.trustBadges.freeCancellation === "Flexible cancellation"', () => {
      const en = JSON.parse(
        readFileSync(resolve(ROOT, 'lib/i18n/messages/en.json'), 'utf-8'),
      ) as Record<string, unknown>
      expect(get(en, 'HomePage.trustBadges.freeCancellation')).toBe(
        'Flexible cancellation',
      )
    })

    for (const { locale, raw } of files) {
      it(`${locale}.json HomePage.trustBadges.freeCancellation is not "Free cancellation"`, () => {
        const json = JSON.parse(raw) as Record<string, unknown>
        const chip = get(json, 'HomePage.trustBadges.freeCancellation') as string
        expect(typeof chip).toBe('string')
        expect(chip).not.toMatch(/free cancellation/i)
        expect(chip.length).toBeGreaterThan(0)
      })
    }
  })

  describe('preserved Vendor-cancellation 100% refund string', () => {
    it('en.json still carries the "100% refund" Vendor-cancelled copy', () => {
      const raw = readFileSync(
        resolve(ROOT, 'lib/i18n/messages/en.json'),
        'utf-8',
      )
      expect(raw).toContain('you receive a 100% refund')
    })
  })
})
