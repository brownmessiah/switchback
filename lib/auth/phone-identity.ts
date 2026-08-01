/**
 * Identity helpers for phone-number signup.
 *
 * better-auth requires an email on every user, so a phone-only signup needs a
 * placeholder. Placeholders are dangerous in two specific ways:
 *
 *  1. We must never try to DELIVER to one. Bouncing mail at a fake address
 *     damages the sending domain's reputation, which degrades real
 *     transactional email for every user.
 *  2. It must never collide with — or be mistakable for — an address a person
 *     actually controls, or a phone signup could shadow someone's account.
 *
 * Hence `.invalid`, reserved by RFC 2606 exactly for this purpose: it can
 * never be registered and never resolves.
 */

/** RFC 2606 reserved TLD — guaranteed unregistrable and non-resolving. */
const PLACEHOLDER_DOMAIN = 'phone.invalid'

/**
 * Strip the formatting a person types (spaces, dashes, brackets) and the
 * leading `+`, leaving only digits. `+91 98765-43210` and `919876543210` are
 * the same human, so they must resolve to the same identity.
 */
function digitsOnly(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, '')
}

/**
 * The placeholder email for a phone-only account. Stable for a given number,
 * so re-signing-up finds the existing account rather than creating a second.
 */
export function tempEmailForPhone(phoneNumber: string): string {
  return `${digitsOnly(phoneNumber)}@${PLACEHOLDER_DOMAIN}`
}

/**
 * Display name for an account that has no real name yet. The phone number
 * keeps the account identifiable in admin lists until the user fills in a
 * profile.
 */
export function tempNameForPhone(phoneNumber: string): string {
  return `+${digitsOnly(phoneNumber)}`
}

/**
 * Is this one of our placeholder addresses?
 *
 * Callers use this to skip sending. Matched on the exact domain rather than a
 * substring: `phone-invalid.com` is registrable and `phone.invalid@gmail.com`
 * is a real deliverable address, so a loose check would either leak mail to a
 * stranger or silently drop mail to a genuine user.
 */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const at = email.lastIndexOf('@')
  if (at === -1) return false
  return email.slice(at + 1).toLowerCase() === PLACEHOLDER_DOMAIN
}

/**
 * E.164-shaped validation, applied before an SMS is sent.
 *
 * MSG91 cannot route a number without a country code, so an unvalidated send
 * is wasted spend on a message nobody receives. Formatting characters a person
 * naturally types are tolerated; anything else is rejected.
 */
export function isValidPhoneNumber(phoneNumber: string): boolean {
  const trimmed = phoneNumber.trim()

  // Only digits, spaces, dashes, brackets and a single leading plus.
  if (!/^\+[\d\s\-()]+$/.test(trimmed)) return false

  const digits = digitsOnly(trimmed)

  // E.164 allows at most 15 digits; a country code never starts with 0.
  if (digits.startsWith('0')) return false
  return digits.length >= 8 && digits.length <= 15
}
