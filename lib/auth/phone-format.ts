/**
 * Indian phone-number normalization for the sign-in phone panel
 * (launch-readiness 03). Users type a plain 10-digit mobile number — the
 * `+91` country code is applied for them, never typed by hand (issue 03
 * AC: "Indian country code is handled without the user formatting it").
 *
 * Pure module — no 'use client'. Safe to unit-test directly and to share
 * between the phone-auth hook and any future validation.
 */

export const INDIA_DIAL_CODE = '+91'

/** Indian mobile numbers are 10 digits, first digit 6-9 (TRAI numbering plan). */
const NATIONAL_NUMBER_PATTERN = /^[6-9]\d{9}$/

export type PhoneNormalizationResult = { ok: true; e164: string } | { ok: false }

/**
 * Accepts loose user input — spaces, dashes, a leading 0, or a typed
 * `+91`/`91` prefix — and returns the canonical E.164 form, or a failure
 * marker for anything that isn't a 10-digit Indian mobile number.
 */
export function normalizeIndianPhoneInput(raw: string): PhoneNormalizationResult {
  const digitsOnly = raw.replace(/\D/g, '')

  let national = digitsOnly
  if (national.length === 12 && national.startsWith('91')) {
    national = national.slice(2)
  } else if (national.length === 11 && national.startsWith('0')) {
    national = national.slice(1)
  }

  if (!NATIONAL_NUMBER_PATTERN.test(national)) {
    return { ok: false }
  }

  return { ok: true, e164: `${INDIA_DIAL_CODE}${national}` }
}

/**
 * Formats a canonical E.164 Indian number for display — used by the
 * code-entry step's "we sent a code to ..." copy, so the user can confirm
 * which number it went to.
 */
export function formatIndianPhoneForDisplay(e164: string): string {
  const national = e164.startsWith(INDIA_DIAL_CODE)
    ? e164.slice(INDIA_DIAL_CODE.length)
    : e164

  if (!NATIONAL_NUMBER_PATTERN.test(national)) return e164

  return `${INDIA_DIAL_CODE} ${national.slice(0, 5)} ${national.slice(5)}`
}
