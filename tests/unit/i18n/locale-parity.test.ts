/**
 * Locale-parity gate (launch-readiness 01).
 *
 * lib/i18n/request.ts loads ONE locale bundle with no English fallback,
 * so a key missing from any locale is missing at runtime for those
 * users. `pnpm i18n:check` validates this but is not wired into CI —
 * this test runs the same invariant inside the vitest suite, which IS a
 * CI gate, so a slice that adds keys to en.json alone fails the build
 * instead of shipping untranslated surfaces.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  findEmptyValues,
  findExtraKeys,
  findMissingKeys,
  flattenKeys,
  type NestedMessages,
} from '../../../scripts/i18n-utils'

const MESSAGES_DIR = join(import.meta.dirname, '..', '..', '..', 'lib', 'i18n', 'messages')
const SOURCE_LOCALE = 'en'

function loadMessages(locale: string): NestedMessages {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf-8'))
}

const locales = readdirSync(MESSAGES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''))

const targetLocales = locales.filter((l) => l !== SOURCE_LOCALE)

describe('locale parity', () => {
  it('has all 13 locale files', () => {
    expect(locales).toContain(SOURCE_LOCALE)
    expect(locales).toHaveLength(13)
  })

  it('en.json is non-empty', () => {
    expect(flattenKeys(loadMessages(SOURCE_LOCALE)).size).toBeGreaterThan(0)
  })

  const sourceFlat = flattenKeys(loadMessages(SOURCE_LOCALE))
  const sourceKeySet = new Set(sourceFlat.keys())

  for (const locale of targetLocales) {
    describe(locale, () => {
      const targetFlat = flattenKeys(loadMessages(locale))
      const targetKeySet = new Set(targetFlat.keys())

      it('has every en.json key', () => {
        expect(findMissingKeys(sourceKeySet, targetKeySet)).toEqual([])
      })

      it('has no keys absent from en.json', () => {
        expect(findExtraKeys(sourceKeySet, targetKeySet)).toEqual([])
      })

      it('has no empty values', () => {
        expect(findEmptyValues(targetFlat)).toEqual([])
      })
    })
  }
})
