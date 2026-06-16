/**
 * i18n parity for the /vendor/checkin scanner page (issue #06).
 *
 * `lib/i18n/request.ts` does NOT merge non-en locales onto `en`, so EVERY
 * locale file must carry every key the page/manual-entry component reference, or
 * a runtime MISSING_MESSAGE crash fires. This test loads all 13 locale JSONs and
 * asserts:
 *   - the `VendorCheckin` namespace exists with every key the UI consumes, and
 *   - the human-facing values are actually LOCALIZED — i.e. NOT byte-identical
 *     to their `en.json` source (the #05 raw-English-copy defect).
 * It catches a missing OR untranslated locale key at test time, before runtime.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SUPPORTED_LOCALES } from '@/lib/i18n/config'

const MESSAGES_DIR = join(process.cwd(), 'lib', 'i18n', 'messages')

function loadLocale(locale: string): Record<string, Record<string, unknown>> {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf-8'))
}

// Every VendorCheckin key the page / manual-entry component reference. Kept in
// sync with the consumers — a missing key here OR in any locale fails the suite.
const VENDOR_CHECKIN_KEYS = [
  'title',
  'subtitle',
  'manualLabel',
  'manualPlaceholder',
  'submit',
  'submitting',
  'scanAgain',
  'resultCheckedInTitle',
  'resultCheckedInBody',
  'resultAlreadyTitle',
  'resultAlreadyBody',
  'resultInvalidTitle',
  'resultInvalidBody',
  'resultErrorTitle',
  'resultErrorBody',
  'emptyTokenError',
] as const

// Human-facing VendorCheckin values that MUST be localized (not a raw English
// copy) in every non-en locale: every sentence/label a user reads.
const VENDOR_CHECKIN_MUST_TRANSLATE_KEYS = [
  'title',
  'subtitle',
  'manualLabel',
  'submit',
  'scanAgain',
  'resultCheckedInTitle',
  'resultCheckedInBody',
  'resultAlreadyTitle',
  'resultAlreadyBody',
  'resultInvalidTitle',
  'resultInvalidBody',
  'resultErrorTitle',
  'resultErrorBody',
  'emptyTokenError',
] as const

const EN = loadLocale('en')
const EN_VENDOR_CHECKIN = EN.VendorCheckin as Record<string, unknown>

describe('VendorCheckin i18n parity (all 13 locales)', () => {
  it('exposes 13 supported locales', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(13)
  })

  for (const locale of SUPPORTED_LOCALES) {
    describe(`${locale}.json`, () => {
      const messages = loadLocale(locale)

      it('has a VendorCheckin namespace with every key the UI consumes', () => {
        const ns = messages.VendorCheckin
        expect(ns, `VendorCheckin missing in ${locale}.json`).toBeTruthy()
        for (const key of VENDOR_CHECKIN_KEYS) {
          expect(ns, `VendorCheckin.${key} missing in ${locale}.json`).toHaveProperty(key)
          expect(
            (ns as Record<string, unknown>)[key],
            `VendorCheckin.${key} empty in ${locale}.json`,
          ).toBeTruthy()
        }
      })

      if (locale !== 'en') {
        it('localizes human-facing VendorCheckin values (not a raw English copy)', () => {
          const ns = messages.VendorCheckin as Record<string, unknown>
          for (const key of VENDOR_CHECKIN_MUST_TRANSLATE_KEYS) {
            expect(
              ns[key],
              `VendorCheckin.${key} is an untranslated English copy in ${locale}.json`,
            ).not.toBe(EN_VENDOR_CHECKIN[key])
          }
        })
      }
    })
  }
})
