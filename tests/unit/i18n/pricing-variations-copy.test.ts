import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { glob } from 'glob'

/**
 * Pricing-variation customer-facing copy parity (issue #08).
 *
 * The PDP selector chrome (`ExperiencePage.pricing.chooseOption` /
 * `.standardOption` / `.variationDuration`) and the listing-card "From ₹X"
 * prefix (`HomePage.from`) are customer-facing — they must exist in EVERY
 * locale, be non-empty, and (for the prose keys) carry a REAL native
 * translation, not an en copy (issue-05 precedent: non-en ≠ en).
 *
 * `variationDuration` is exempted from the "differs from en" check because its
 * value is mostly the language-neutral `· {minutes} ...` token; we only assert
 * it keeps the `{minutes}` placeholder so the rail's substitution works.
 */

const ROOT = resolve(__dirname, '../../..')
const MESSAGES_GLOB = 'lib/i18n/messages/*.json'

function localeFiles(): { locale: string; json: Record<string, unknown> }[] {
  const paths = glob.sync(MESSAGES_GLOB, { cwd: ROOT }).map((p) => resolve(ROOT, p))
  expect(paths.length).toBeGreaterThan(0)
  return paths.map((path) => ({
    locale: path.replace(/.*\/([a-z]+)\.json$/, '$1'),
    json: JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>,
  }))
}

function get(obj: Record<string, unknown>, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, obj)
}

const PROSE_KEYS = [
  'ExperiencePage.pricing.chooseOption',
  'ExperiencePage.pricing.standardOption',
  'HomePage.from',
] as const

describe('pricing-variation customer copy parity (issue #08)', () => {
  const files = localeFiles()
  const en = files.find((f) => f.locale === 'en')!.json
  const nonEn = files.filter((f) => f.locale !== 'en')

  for (const key of PROSE_KEYS) {
    it(`en.json defines ${key}`, () => {
      const v = get(en, key)
      expect(typeof v).toBe('string')
      expect((v as string).length).toBeGreaterThan(0)
    })

    for (const { locale, json } of nonEn) {
      it(`${locale}.json defines ${key}, non-empty and NOT the en string`, () => {
        const v = get(json, key)
        expect(typeof v).toBe('string')
        expect((v as string).length).toBeGreaterThan(0)
        expect(v).not.toBe(get(en, key))
      })
    }
  }

  for (const { locale, json } of files) {
    it(`${locale}.json variationDuration keeps the {minutes} placeholder`, () => {
      const v = get(json, 'ExperiencePage.pricing.variationDuration')
      expect(typeof v).toBe('string')
      expect(v as string).toContain('{minutes}')
    })
  }
})
