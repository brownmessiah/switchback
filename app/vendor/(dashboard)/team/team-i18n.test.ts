/**
 * i18n parity for the Team & Roles UI (issue #05).
 *
 * `lib/i18n/request.ts` does NOT merge non-en locales onto `en`, so EVERY
 * locale file must carry every key the page/modal/list reference, or a runtime
 * MISSING_MESSAGE crash fires. This test loads all 13 locale JSONs and asserts:
 *   - the `VendorTeam` namespace exists with every key the UI consumes, and
 *   - the new `VendorNav.items.team` nav label exists, and
 *   - the human-facing values are actually LOCALIZED — i.e. NOT byte-identical
 *     to their `en.json` source. A raw English copy left in a non-en locale
 *     (the original #05 defect) fails this suite.
 * It catches a missing OR untranslated locale key at test time, before runtime.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SUPPORTED_LOCALES } from '@/lib/i18n/config'

import { roleLabelKey } from './team-display'
import type { AssignableRole } from './team-core'

const MESSAGES_DIR = join(process.cwd(), 'lib', 'i18n', 'messages')

function loadLocale(locale: string): Record<string, Record<string, unknown>> {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf-8'))
}

// Every VendorTeam key the page / modal / list reference. Kept in sync with the
// component consumers — a missing key here OR in any locale fails the suite.
const VENDOR_TEAM_KEYS = [
  'title',
  'subtitle',
  'addUser',
  'ownerRowLabel',
  'ownerRowYou',
  'ownerRoleLabel',
  'columnName',
  'columnEmail',
  'columnRole',
  'columnStatus',
  'columnLastActive',
  'columnActions',
  'empty',
  'edit',
  'remove',
  'statusActive',
  'statusInactive',
  'fullNameLabel',
  'emailLabel',
  'phoneLabel',
  'phoneOptional',
  'roleLabel',
  'statusLabel',
  'addUserTitle',
  'addUserDescription',
  'editTitle',
  'editDescription',
  'cancel',
  'save',
  'sending',
  'removeTitle',
  'removeDescription',
  'removeConfirm',
  'roleManager',
  'roleBookingStaff',
  'roleGuide',
  'roleAccountant',
] as const

const ASSIGNABLE_ROLES: readonly AssignableRole[] = [
  'manager',
  'booking_staff',
  'guide',
  'accountant',
]

// Human-facing VendorTeam values that MUST be localized (not a raw English
// copy) in every non-en locale. These are the labels/sentences/role names a
// user reads — the subtitle, the role names, and the empty state. Keys whose
// "translation" can legitimately equal English across scripts (none here — even
// proper nouns get native transliteration per the locale convention) are
// excluded; everything listed must differ byte-for-byte from `en.json`.
const VENDOR_TEAM_MUST_TRANSLATE_KEYS = [
  'title',
  'subtitle',
  'addUser',
  'ownerRoleLabel',
  'empty',
  'statusActive',
  'statusInactive',
  'addUserTitle',
  'addUserDescription',
  'removeTitle',
  'removeDescription',
  'roleManager',
  'roleBookingStaff',
  'roleGuide',
  'roleAccountant',
] as const

const EN = loadLocale('en')
const EN_VENDOR_TEAM = EN.VendorTeam as Record<string, unknown>
const EN_NAV_TEAM = (EN.VendorNav as { items?: Record<string, unknown> }).items?.team

describe('VendorTeam i18n parity (all 13 locales)', () => {
  it('exposes 13 supported locales', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(13)
  })

  for (const locale of SUPPORTED_LOCALES) {
    describe(`${locale}.json`, () => {
      const messages = loadLocale(locale)

      it('has a VendorTeam namespace with every key the UI consumes', () => {
        const ns = messages.VendorTeam
        expect(ns, `VendorTeam missing in ${locale}.json`).toBeTruthy()
        for (const key of VENDOR_TEAM_KEYS) {
          expect(ns, `VendorTeam.${key} missing in ${locale}.json`).toHaveProperty(key)
          expect(
            (ns as Record<string, unknown>)[key],
            `VendorTeam.${key} empty in ${locale}.json`,
          ).toBeTruthy()
        }
      })

      it('has the role-label keys that roleLabelKey() resolves to', () => {
        const ns = messages.VendorTeam as Record<string, unknown>
        for (const role of ASSIGNABLE_ROLES) {
          expect(
            ns,
            `VendorTeam.${roleLabelKey(role)} (role ${role}) missing in ${locale}.json`,
          ).toHaveProperty(roleLabelKey(role))
        }
      })

      it('has the new VendorNav.items.team nav label', () => {
        const items = (messages.VendorNav as { items?: Record<string, unknown> })?.items
        expect(items, `VendorNav.items missing in ${locale}.json`).toBeTruthy()
        expect(items, `VendorNav.items.team missing in ${locale}.json`).toHaveProperty('team')
        expect((items as Record<string, unknown>).team).toBeTruthy()
      })

      if (locale !== 'en') {
        it('localizes human-facing VendorTeam values (not a raw English copy)', () => {
          const ns = messages.VendorTeam as Record<string, unknown>
          for (const key of VENDOR_TEAM_MUST_TRANSLATE_KEYS) {
            expect(
              ns[key],
              `VendorTeam.${key} is an untranslated English copy in ${locale}.json`,
            ).not.toBe(EN_VENDOR_TEAM[key])
          }
        })

        it('localizes the role-label values that roleLabelKey() resolves to', () => {
          const ns = messages.VendorTeam as Record<string, unknown>
          for (const role of ASSIGNABLE_ROLES) {
            const key = roleLabelKey(role)
            expect(
              ns[key],
              `VendorTeam.${key} (role ${role}) is an untranslated English copy in ${locale}.json`,
            ).not.toBe(EN_VENDOR_TEAM[key])
          }
        })

        it('localizes the VendorNav.items.team nav label (not a raw English copy)', () => {
          const items = (messages.VendorNav as { items?: Record<string, unknown> })?.items
          expect(
            (items as Record<string, unknown>).team,
            `VendorNav.items.team is an untranslated English copy in ${locale}.json`,
          ).not.toBe(EN_NAV_TEAM)
        })
      }
    })
  }
})
