/**
 * Server-side phone-number shape validator (launch-readiness 03).
 *
 * Wired as better-auth's `phoneNumberValidator` — defense-in-depth for
 * `/phone-number/send-otp` and `/phone-number/verify`, both client-callable
 * endpoints. Our own client (lib/auth/phone-format.ts) only ever sends this
 * exact E.164 shape, but nothing stops a direct request with an arbitrary
 * string; a mismatch here is rejected with a clean INVALID_PHONE_NUMBER
 * (400) before it can mint a `verifications` row or, via
 * `signUpOnVerification`, a User.
 */

const INDIAN_E164_PATTERN = /^\+91[6-9]\d{9}$/

export function isValidIndianE164PhoneNumber(value: string): boolean {
  return INDIAN_E164_PATTERN.test(value)
}
