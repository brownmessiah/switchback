import {
  DEFAULT_CHECKIN_TTL_MS,
  signCheckInToken,
} from './checkin-token'

/**
 * Pure helpers for the customer-facing check-in QR (issue #06). No DB, no I/O —
 * the caller (the confirmation Server Component) supplies the origin, the slot
 * end, and the env secret.
 */

/**
 * The QR is only meaningful where a future/at-the-experience arrival can still
 * be recorded: `confirmed` (paid, before the slot) and `awaiting_completion`
 * (the experience window). It is hidden for terminal/non-arrival states —
 * cancelled, completed, disputed, no-show, and pre-payment.
 */
const CHECK_IN_QR_STATES: ReadonlySet<string> = new Set([
  'confirmed',
  'awaiting_completion',
])

export function shouldShowCheckInQr(state: string): boolean {
  return CHECK_IN_QR_STATES.has(state)
}

/**
 * TTL policy (documented): the QR stays scannable until the slot END plus a 24h
 * grace window, covering late arrivals and a manual desk check-in after the
 * experience. Returned as epoch-ms for {@link signCheckInToken}.
 */
export function checkInExpiryFor(slotEnd: Date): number {
  return slotEnd.getTime() + DEFAULT_CHECKIN_TTL_MS
}

export interface BuildCheckInDeepLinkArgs {
  /** Absolute origin, e.g. `https://switchback.com` (trailing slash tolerated). */
  origin: string
  bookingId: string
  /** The booking's slot end — drives the token expiry via {@link checkInExpiryFor}. */
  slotEnd: Date
  /** HMAC secret, resolved from env at the call site. */
  secret: string
}

/**
 * Build the deep-link the QR encodes: `<origin>/vendor/checkin?token=<token>`.
 * Staff scan it with any phone camera; the URL opens the scanner page, which
 * reads `?token=` and submits `recordCheckIn`.
 */
export function buildCheckInDeepLink({
  origin,
  bookingId,
  slotEnd,
  secret,
}: BuildCheckInDeepLinkArgs): string {
  const token = signCheckInToken(
    { bookingId, expiresAt: checkInExpiryFor(slotEnd) },
    secret,
  )
  const base = origin.replace(/\/+$/, '')
  return `${base}/vendor/checkin?token=${encodeURIComponent(token)}`
}
