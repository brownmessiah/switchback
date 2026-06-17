import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { glob } from 'glob'

/**
 * Customer-facing cancellation badge/line copy parity (issue #10).
 *
 * The Experience detail shows EITHER a "Non-cancellable" badge (when the preset
 * is non_cancellable) OR a "Full refund if you cancel up to {hours}h before
 * activity" line. Both strings are customer-facing — they must exist in EVERY
 * locale, be non-empty, and (for the prose keys) carry a REAL native
 * translation, not an en copy (issue-05 precedent: non-en ≠ en). The {hours}
 * numeric placeholder must survive in every locale so next-intl can interpolate
 * the derived figure.
 *
 * CONTEXT.md domain vocabulary forbids the "Free cancellation" phrase in any
 * user-facing string — the freeUpToHours line is "Full refund if you cancel
 * up to …", never "Free cancellation". This suite also guards that ban.
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
  'ExperiencePage.cancellation.nonCancellableBadge',
  'ExperiencePage.cancellation.nonCancellableDescription',
  'ExperiencePage.cancellation.freeUpToHours',
] as const

const PLACEHOLDER_KEY = 'ExperiencePage.cancellation.freeUpToHours'

describe('cancellation badge/line customer copy parity (issue #10)', () => {
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
    it(`${locale}.json freeUpToHours keeps the {hours} placeholder`, () => {
      const v = get(json, PLACEHOLDER_KEY)
      expect(typeof v).toBe('string')
      expect(v as string).toContain('{hours}')
    })
  }

  // CONTEXT.md ban: no customer-facing cancellation prose may use the English
  // "Free cancellation" phrase (en is reworded to "Full refund if you cancel
  // up to …"; non-en locales carry the equivalent without the banned phrase).
  for (const { locale, json } of files) {
    it(`${locale}.json freeUpToHours does not use the banned "Free cancellation" phrase`, () => {
      const v = get(json, PLACEHOLDER_KEY) as string
      expect(v.toLowerCase()).not.toContain('free cancellation')
    })
  }
})
