/**
 * i18n parity for the Team & Roles UI (issue #05).
 *
 * `lib/i18n/request.ts` does NOT merge non-en locales onto `en`, so EVERY
 * locale file must carry every key the page/modal/list reference, or a runtime
 * MISSING_MESSAGE crash fires. This test loads all 13 locale JSONs and asserts:
 *   - the `VendorTeam` namespace exists with every key the UI consumes, and
 *   - the new `VendorNav.items.team` nav label exists.
 * It catches a missing-locale key at test time, before runtime.
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
    })
  }
})
