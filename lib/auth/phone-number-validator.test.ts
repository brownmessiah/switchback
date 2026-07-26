import { describe, expect, it } from 'vitest'

import { isValidIndianE164PhoneNumber } from './phone-number-validator'

/**
 * Server-side defense-in-depth (launch-readiness 03): our OWN client only
 * ever sends the canonical E.164 shape produced by
 * lib/auth/phone-format.ts, but `/phone-number/send-otp` and
 * `/phone-number/verify` are client-callable endpoints — nothing stops a
 * direct request with an arbitrary string. Wired as better-auth's
 * `phoneNumberValidator`, so a malformed value is rejected with a clean
 * INVALID_PHONE_NUMBER (400) before it can mint a `verifications` row or
 * (via signUpOnVerification) a User.
 */
describe('isValidIndianE164PhoneNumber', () => {
  it.each(['+919876543210', '+916000000000', '+919999999999'])(
    'accepts %s',
    (value) => {
      expect(isValidIndianE164PhoneNumber(value)).toBe(true)
    },
  )

  it.each([
    ['missing the +91 prefix', '9876543210'],
    ['wrong country code', '+19876543210'],
    ['too short', '+9198765432'],
    ['too long', '+91987654321099'],
    ['invalid leading digit', '+915876543210'],
    ['contains letters', '+91987654321a'],
    ['empty string', ''],
    ['has a space', '+91 9876543210'],
  ])('rejects %s: %s', (_label, value) => {
    expect(isValidIndianE164PhoneNumber(value)).toBe(false)
  })
})
