import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CHECKIN_TTL_MS,
  signCheckInToken,
  verifyCheckInToken,
  type VerifyCheckInResult,
} from './checkin-token'

/**
 * Pure check-in-token module (issue #06). HMAC-SHA256-signed, no DB.
 *
 * Mirrors `lib/payments/razorpay-signature.ts`: `node:crypto` `createHmac` +
 * `timingSafeEqual`. A token is `base64url(payloadJson).base64url(hmac)`. The
 * payload is `{ bookingId, expiresAt }` (epoch-ms). The secret is supplied by
 * the caller (env at the call site) so this module stays pure + testable and
 * never hardcodes a secret.
 *
 * Proves the security contract:
 *   - a valid token verifies and returns the bookingId
 *   - a tampered payload (flipped char) → bad_signature
 *   - a token signed with a DIFFERENT secret → bad_signature (unforgeable)
 *   - an expired token (expiresAt < now) → expired
 *   - malformed / garbage input → malformed
 */

const SECRET = 'a'.repeat(32)
const OTHER_SECRET = 'b'.repeat(32)
const BOOKING_ID = '11111111-1111-1111-1111-111111111111'

// A fixed clock so expiry assertions are deterministic.
const NOW = 1_700_000_000_000

function ok(result: VerifyCheckInResult): { bookingId: string } {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
  return result
}

/**
 * Build a CORRECTLY-signed token from an arbitrary JSON payload value, mirroring
 * the production `sign()` (HMAC-SHA256 over the base64url-encoded payload, hex
 * digest). Because the signature is valid, verification passes the constant-time
 * compare and reaches the payload shape-check — letting us exercise the
 * `isValidPayload` rejection arm with a non-`bad_signature` cause.
 */
function signArbitraryPayload(payloadValue: unknown, secret: string): string {
  const payloadB64Url = Buffer.from(JSON.stringify(payloadValue)).toString('base64url')
  const signature = createHmac('sha256', secret).update(payloadB64Url).digest('hex')
  return `${payloadB64Url}.${signature}`
}

describe('signCheckInToken / verifyCheckInToken (issue #06)', () => {
  it('a valid token verifies and returns the bookingId', () => {
    const token = signCheckInToken(
      { bookingId: BOOKING_ID, expiresAt: NOW + 60_000 },
      SECRET,
    )
    const result = verifyCheckInToken(token, SECRET, NOW)
    expect(result.ok).toBe(true)
    expect(ok(result).bookingId).toBe(BOOKING_ID)
  })

  it('rejects a token whose payload was tampered (flipped char) → bad_signature', () => {
    const token = signCheckInToken(
      { bookingId: BOOKING_ID, expiresAt: NOW + 60_000 },
      SECRET,
    )
    const [payload, sig] = token.split('.')
    // Flip the first payload char to a different base64url char.
    const flipped = (payload![0] === 'A' ? 'B' : 'A') + payload!.slice(1)
    const tampered = `${flipped}.${sig}`

    const result = verifyCheckInToken(tampered, SECRET, NOW)
    expect(result).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a token signed with a different secret → bad_signature (unforgeable)', () => {
    const token = signCheckInToken(
      { bookingId: BOOKING_ID, expiresAt: NOW + 60_000 },
      OTHER_SECRET,
    )
    const result = verifyCheckInToken(token, SECRET, NOW)
    expect(result).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects an expired token (expiresAt < now) → expired', () => {
    const token = signCheckInToken(
      { bookingId: BOOKING_ID, expiresAt: NOW - 1 },
      SECRET,
    )
    const result = verifyCheckInToken(token, SECRET, NOW)
    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('accepts a token exactly at the expiry boundary (expiresAt === now)', () => {
    const token = signCheckInToken({ bookingId: BOOKING_ID, expiresAt: NOW }, SECRET)
    const result = verifyCheckInToken(token, SECRET, NOW)
    expect(result.ok).toBe(true)
  })

  it('rejects malformed / garbage input → malformed', () => {
    for (const garbage of ['', 'not-a-token', 'a.b.c', '.', 'only-one-part']) {
      expect(verifyCheckInToken(garbage, SECRET, NOW)).toEqual({
        ok: false,
        reason: 'malformed',
      })
    }
  })

  it('rejects a token whose payload is valid base64url but not the expected JSON shape → malformed', () => {
    // A well-formed two-part token whose payload decodes to JSON missing the
    // required fields. Sign it correctly so the signature passes — the shape
    // check must still reject it.
    const badPayload = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64url')
    // Re-sign with the real secret so it's not a signature failure.
    const token = signCheckInToken({ bookingId: BOOKING_ID, expiresAt: NOW + 1 }, SECRET)
    const sig = token.split('.')[1]
    const result = verifyCheckInToken(`${badPayload}.${sig}`, SECRET, NOW)
    // Signature won't match the substituted payload → bad_signature is the
    // first gate; either way it is NOT ok.
    expect(result.ok).toBe(false)
  })

  it('rejects a signature that is not 64 hex chars → bad_signature (structural sig guard)', () => {
    // A two-part token whose signature passes the part-count + non-empty gates
    // but is NOT a 64-char SHA-256 hex digest. This hits the HEX_64_RE guard
    // (which exists to avoid crashing timingSafeEqual on a length mismatch).
    const token = signCheckInToken({ bookingId: BOOKING_ID, expiresAt: NOW + 60_000 }, SECRET)
    const payload = token.split('.')[0]!

    for (const badSig of [
      'deadbeef', // too short
      'g'.repeat(64), // 64 chars but 'g' is not a hex digit
      'a'.repeat(63), // one char short
      'a'.repeat(65), // one char long
    ]) {
      expect(verifyCheckInToken(`${payload}.${badSig}`, SECRET, NOW)).toEqual({
        ok: false,
        reason: 'bad_signature',
      })
    }
  })

  it('rejects a correctly-signed payload that decodes to a non-object → malformed', () => {
    // The signature is VALID (signed with the real secret), so verification
    // passes the constant-time compare and reaches the payload shape-check.
    // A JSON number is valid JSON but `isValidPayload` rejects it (not an
    // object) → malformed, NOT bad_signature.
    const token = signArbitraryPayload(42, SECRET)
    expect(verifyCheckInToken(token, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('rejects a correctly-signed payload that decodes to null → malformed', () => {
    // `typeof null === 'object'` — the explicit `value === null` guard in
    // isValidPayload must reject it. Signature is valid, so we land on the
    // shape-check, not the signature gate.
    const token = signArbitraryPayload(null, SECRET)
    expect(verifyCheckInToken(token, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('rejects a correctly-signed object missing bookingId → malformed', () => {
    // Valid signature, valid JSON object, but `bookingId` absent.
    const token = signArbitraryPayload({ expiresAt: NOW + 60_000 }, SECRET)
    expect(verifyCheckInToken(token, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('rejects a correctly-signed object with an empty bookingId → malformed', () => {
    // `bookingId` is a string but zero-length — the `length > 0` guard rejects it.
    const token = signArbitraryPayload({ bookingId: '', expiresAt: NOW + 60_000 }, SECRET)
    expect(verifyCheckInToken(token, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('rejects a correctly-signed object whose expiresAt is not finite → malformed', () => {
    // `expiresAt` is a number but NaN serialises to JSON `null`, so this also
    // exercises the non-number arm; use a string to force the typeof guard.
    const token = signArbitraryPayload(
      { bookingId: BOOKING_ID, expiresAt: 'soon' },
      SECRET,
    )
    expect(verifyCheckInToken(token, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('exposes a 24h default TTL used by the QR-minting call site', () => {
    expect(DEFAULT_CHECKIN_TTL_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('a token signed with DEFAULT_CHECKIN_TTL_MS past now verifies (mint-then-scan)', () => {
    // Mirrors the confirmation page: sign with slotEnd + DEFAULT_CHECKIN_TTL_MS,
    // then a staff scan inside that window verifies.
    const token = signCheckInToken(
      { bookingId: BOOKING_ID, expiresAt: NOW + DEFAULT_CHECKIN_TTL_MS },
      SECRET,
    )
    const result = verifyCheckInToken(token, SECRET, NOW + 1_000)
    expect(result.ok).toBe(true)
    expect(ok(result).bookingId).toBe(BOOKING_ID)
  })
})
