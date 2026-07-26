/**
 * Temp identity minted for a phone sign-up (launch-readiness 03).
 *
 * better-auth's phoneNumber plugin, when `signUpOnVerification` is
 * configured, provisions a brand-new User at verify time under a
 * synthesized email address — there is no email at all when someone
 * signs up by phone.
 *
 * SECURITY / DATA-HYGIENE (RECON.md decision table row 7): the domain
 * MUST NOT be `@seed.outvers.dev`. lib/launch/seed-data-registry uses
 * that suffix as the production purge predicate — a real phone-signed-up
 * user given a seed-shaped address would be classified as seed data and
 * deleted by a later purge. `lib/launch/seed-data-registry.test.ts`
 * already pins the exact address this module must produce.
 */

export const PHONE_TEMP_EMAIL_DOMAIN = '@phone.outvers.com'

function msisdn(phoneNumber: string): string {
  return phoneNumber.startsWith('+') ? phoneNumber.slice(1) : phoneNumber
}

/**
 * `signUpOnVerification.getTempEmail` — better-auth calls this with the
 * raw phone number exactly as sent by the client (E.164, e.g.
 * "+919876543210").
 */
export function getPhoneTempEmail(phoneNumber: string): string {
  return `${msisdn(phoneNumber)}${PHONE_TEMP_EMAIL_DOMAIN}`
}
