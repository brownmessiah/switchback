import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Pure, signed check-in-token module (issue #06).
 *
 * A customer's Booking carries a QR encoding a deep-link
 * `<origin>/vendor/checkin?token=<token>`. Staff scan it with any phone camera;
 * the scanner page submits the token to `recordCheckIn`, which sets
 * `bookings.checked_in_at`. Check-in is a NEW timestamp, NOT a lifecycle state
 * (ADR-0003 untouched).
 *
 * Token shape — `base64url(payloadJson).base64url(hmacSHA256)`:
 *   payload = { bookingId: string; expiresAt: number /* epoch-ms *\/ }
 *   hmac    = HMAC-SHA256(payloadB64Url, secret)   // signs the encoded payload
 *
 * Security (mirrors `lib/payments/razorpay-signature.ts`):
 *   - HMAC-SHA256 keyed by an env secret; the signature is compared in constant
 *     time via `crypto.timingSafeEqual` (no length/position timing leak).
 *   - This module is PURE: no DB, no env reads, no I/O. The secret is supplied
 *     by the caller (read from env at the call site) so it is testable and never
 *     hardcoded.
 *
 * Verification is total — every failure mode returns a typed reason, never
 * throws:
 *   - `malformed`       — not two base64url parts, or the payload is not the
 *                         expected `{ bookingId, expiresAt }` JSON shape.
 *   - `bad_signature`   — the recomputed HMAC does not match (tampered payload,
 *                         or a token signed with a different secret).
 *   - `expired`         — `expiresAt < now`.
 */

export interface CheckInTokenPayload {
  /** The Booking this token checks in. */
  bookingId: string
  /** Absolute expiry as epoch-milliseconds. Compared against `now`. */
  expiresAt: number
}

export type VerifyCheckInResult =
  | { ok: true; bookingId: string }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' }

/**
 * Default token lifetime, used by the call site that mints a Booking QR: the
 * customer confirmation page signs with `slotEnd + DEFAULT_CHECKIN_TTL_MS` so
 * the QR stays scannable through the experience window and a generous grace
 * period after it (late arrivals, manual desk check-in). 24h after slot end.
 */
export const DEFAULT_CHECKIN_TTL_MS = 24 * 60 * 60 * 1000

const HEX_64_RE = /^[0-9a-fA-F]{64}$/

function isValidPayload(value: unknown): value is CheckInTokenPayload {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.bookingId === 'string' &&
    v.bookingId.length > 0 &&
    typeof v.expiresAt === 'number' &&
    Number.isFinite(v.expiresAt)
  )
}

/** HMAC-SHA256 of the (already base64url-encoded) payload, as a hex digest. */
function sign(payloadB64Url: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64Url).digest('hex')
}

/**
 * Sign a `{ bookingId, expiresAt }` payload into a `payload.signature` token.
 * The secret is the caller's (env at the call site) — never read here.
 */
export function signCheckInToken(payload: CheckInTokenPayload, secret: string): string {
  const payloadB64Url = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = sign(payloadB64Url, secret)
  return `${payloadB64Url}.${signature}`
}

/**
 * Verify a token against `secret` at clock `now` (epoch-ms). Pure — returns a
 * typed result, never throws. The signature is checked in constant time before
 * any payload trust; expiry is checked last (`expiresAt < now` → expired; the
 * boundary `expiresAt === now` is still valid).
 */
export function verifyCheckInToken(
  token: string,
  secret: string,
  now: number,
): VerifyCheckInResult {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'malformed' }
  }

  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'malformed' }

  const [payloadB64Url, providedSig] = parts
  if (!payloadB64Url || !providedSig) return { ok: false, reason: 'malformed' }

  // A SHA-256 hex digest is always 64 lowercase hex chars. Anything else is
  // structurally invalid and would crash timingSafeEqual on length mismatch.
  if (!HEX_64_RE.test(providedSig)) return { ok: false, reason: 'bad_signature' }

  // Constant-time signature compare (mirrors razorpay-signature.ts).
  const expectedSig = sign(payloadB64Url, secret)
  const expectedBuf = Buffer.from(expectedSig, 'hex')
  const providedBuf = Buffer.from(providedSig, 'hex')
  if (expectedBuf.length !== providedBuf.length) {
    return { ok: false, reason: 'bad_signature' }
  }
  if (!timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: 'bad_signature' }
  }

  // Signature is trusted — now decode + shape-check the payload.
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payloadB64Url, 'base64url').toString('utf-8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!isValidPayload(parsed)) return { ok: false, reason: 'malformed' }

  if (parsed.expiresAt < now) return { ok: false, reason: 'expired' }

  return { ok: true, bookingId: parsed.bookingId }
}
