import { describe, expect, it } from 'vitest'

import {
  isPlaceholderEmail,
  isValidPhoneNumber,
  tempEmailForPhone,
  tempNameForPhone,
} from './phone-identity'

/**
 * Signing up by phone needs an email, because better-auth requires one on
 * every user. That email is a placeholder, and placeholders are dangerous in
 * two specific ways this module exists to prevent:
 *
 *  1. We must never try to DELIVER to one. A bounce to a fake address hurts
 *     the sending domain's reputation, which would degrade real transactional
 *     mail for everyone.
 *  2. It must never collide with, or be mistakable for, a real address a
 *     person controls — otherwise a phone signup could shadow someone's
 *     account.
 *
 * `.invalid` is reserved by RFC 2606 precisely for this: it can never be
 * registered and never resolves.
 */

describe('tempEmailForPhone', () => {
  it('builds an address on the RFC 2606 reserved .invalid domain', () => {
    expect(tempEmailForPhone('+919876543210')).toMatch(/@phone\.invalid$/)
  })

  it('is stable for the same number, so re-signup finds the same account', () => {
    expect(tempEmailForPhone('+919876543210')).toBe(tempEmailForPhone('+919876543210'))
  })

  it('treats the same number written with and without a plus as one identity', () => {
    expect(tempEmailForPhone('+919876543210')).toBe(tempEmailForPhone('919876543210'))
  })

  it('ignores spaces, dashes and brackets a person might type', () => {
    expect(tempEmailForPhone('+91 98765-43210')).toBe(tempEmailForPhone('+919876543210'))
  })

  it('gives different numbers different addresses', () => {
    expect(tempEmailForPhone('+919876543210')).not.toBe(tempEmailForPhone('+919876543211'))
  })

  it('produces a syntactically valid address', () => {
    expect(tempEmailForPhone('+919876543210')).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/)
  })
})

describe('isPlaceholderEmail', () => {
  it('recognises an address it generated', () => {
    expect(isPlaceholderEmail(tempEmailForPhone('+919876543210'))).toBe(true)
  })

  it('does not flag a real address', () => {
    expect(isPlaceholderEmail('rider@gmail.com')).toBe(false)
  })

  it('is not fooled by a lookalike domain a user could actually register', () => {
    // `phone-invalid.com` is registrable; `phone.invalid` is not.
    expect(isPlaceholderEmail('9876543210@phone-invalid.com')).toBe(false)
  })

  it('is not fooled by the reserved domain appearing mid-address', () => {
    expect(isPlaceholderEmail('phone.invalid@gmail.com')).toBe(false)
  })

  it('treats a missing address as not a placeholder', () => {
    expect(isPlaceholderEmail(null)).toBe(false)
    expect(isPlaceholderEmail(undefined)).toBe(false)
    expect(isPlaceholderEmail('')).toBe(false)
  })

  it('ignores case', () => {
    expect(isPlaceholderEmail('919876543210@PHONE.INVALID')).toBe(true)
  })
})

describe('isValidPhoneNumber', () => {
  it('accepts an E.164 Indian mobile', () => {
    expect(isValidPhoneNumber('+919876543210')).toBe(true)
  })

  it('accepts other country codes', () => {
    expect(isValidPhoneNumber('+14155550123')).toBe(true)
  })

  it('rejects a number with no country code', () => {
    // Without one, MSG91 cannot route the SMS and the send is wasted spend.
    expect(isValidPhoneNumber('9876543210')).toBe(false)
  })

  it('rejects letters and injection attempts', () => {
    expect(isValidPhoneNumber('+9198765abcde')).toBe(false)
    expect(isValidPhoneNumber('+91987654321; DROP TABLE users')).toBe(false)
  })

  it('rejects an implausibly short or long number', () => {
    expect(isValidPhoneNumber('+9198')).toBe(false)
    expect(isValidPhoneNumber('+9198765432101234567')).toBe(false)
  })

  it('rejects a leading zero after the plus', () => {
    expect(isValidPhoneNumber('+0919876543210')).toBe(false)
  })

  it('tolerates spaces and dashes a person types', () => {
    expect(isValidPhoneNumber('+91 98765-43210')).toBe(true)
  })
})

describe('tempNameForPhone', () => {
  it('uses the phone number, so the account is identifiable before profile setup', () => {
    expect(tempNameForPhone('+919876543210')).toContain('9876543210')
  })
})
