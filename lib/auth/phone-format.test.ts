import { describe, expect, it } from 'vitest'

import {
  formatIndianPhoneForDisplay,
  INDIA_DIAL_CODE,
  normalizeIndianPhoneInput,
} from './phone-format'

/**
 * Indian phone normalization (launch-readiness 03). The sign-in phone
 * panel never asks the user to type a country code (issue 03 AC) — this
 * module is the single place that turns loose user input into the
 * canonical E.164 shape better-auth's phoneNumber plugin expects.
 */
describe('normalizeIndianPhoneInput', () => {
  it.each([
    ['a bare 10-digit number', '9876543210'],
    ['with spaces', '98765 43210'],
    ['with a dash', '98765-43210'],
    ['with the +91 dial code and a space', '+91 9876543210'],
    ['with the +91 dial code, no space', '+919876543210'],
    ['with a bare 91 prefix (no plus)', '919876543210'],
    ['with a leading 0 (common mistake)', '09876543210'],
  ])('normalizes %s to +919876543210', (_label, input) => {
    expect(normalizeIndianPhoneInput(input)).toEqual({
      ok: true,
      e164: '+919876543210',
    })
  })

  it.each([
    ['empty string', ''],
    ['too short', '98765432'],
    ['too long with no recognizable prefix', '1234567891011'],
    ['starts with an invalid leading digit', '5876543210'],
    ['starts with 0 after removing 91 is still invalid shape', '0123456789'],
    ['letters', 'abcdefghij'],
  ])('rejects %s', (_label, input) => {
    expect(normalizeIndianPhoneInput(input)).toEqual({ ok: false })
  })
})

describe('formatIndianPhoneForDisplay', () => {
  it('formats a canonical E.164 number with a readable grouping', () => {
    expect(formatIndianPhoneForDisplay('+919876543210')).toBe(
      `${INDIA_DIAL_CODE} 98765 43210`,
    )
  })

  it('falls back to the raw value for anything not shaped like an Indian mobile number', () => {
    expect(formatIndianPhoneForDisplay('+1234')).toBe('+1234')
  })
})
