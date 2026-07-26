import { describe, expect, it } from 'vitest'

import { getPhoneTempEmail, PHONE_TEMP_EMAIL_DOMAIN } from './phone-temp-identity'

/**
 * launch-readiness 03, decision-table row 7: the temp email minted for a
 * phone sign-up must NEVER fall under `@seed.outvers.dev` — that domain
 * is lib/launch/seed-data-registry's production purge predicate. A real
 * phone-signed-up user given a seed-shaped address would be classified as
 * seed data and deleted by a later purge. seed-data-registry.test.ts
 * already pins the exact address this module must produce.
 */
describe('getPhoneTempEmail', () => {
  it('is NOT under the seed email domain', () => {
    expect(getPhoneTempEmail('+919876543210')).not.toMatch(/@seed\.outvers\.dev$/)
  })

  it('produces the exact address the seed registry test pins', () => {
    expect(getPhoneTempEmail('+919876543210')).toBe('919876543210@phone.outvers.com')
  })

  it('strips the leading + before building the local part', () => {
    expect(getPhoneTempEmail('+15551234567')).toBe('15551234567@phone.outvers.com')
  })

  it('is stable for a phone number already lacking a plus', () => {
    expect(getPhoneTempEmail('919876543210')).toBe('919876543210@phone.outvers.com')
  })

  it('uses the documented domain constant', () => {
    expect(getPhoneTempEmail('+919876543210').endsWith(PHONE_TEMP_EMAIL_DOMAIN)).toBe(true)
  })
})
