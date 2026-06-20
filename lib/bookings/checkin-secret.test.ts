import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveCheckInSecret } from './checkin-secret'

/**
 * Secret resolver for check-in tokens (issue #06).
 *
 * Reads the HMAC secret at the CALL SITE so the pure token module never
 * touches env. Prefers a dedicated `CHECKIN_TOKEN_SECRET`, falling back to
 * `BETTER_AUTH_SECRET` (always present, ≥32 chars, validated in lib/env.ts).
 * If neither is set it throws — a misconfigured deployment must fail loudly
 * rather than silently sign/verify QR tokens with an empty key.
 *
 * These tests own the two env keys for their duration and restore the
 * original values afterwards so the rest of the suite is unaffected.
 */
describe('resolveCheckInSecret (issue #06)', () => {
  const ORIGINAL_CHECKIN = process.env.CHECKIN_TOKEN_SECRET
  const ORIGINAL_AUTH = process.env.BETTER_AUTH_SECRET

  beforeEach(() => {
    delete process.env.CHECKIN_TOKEN_SECRET
    delete process.env.BETTER_AUTH_SECRET
  })

  afterEach(() => {
    // Restore exactly — including the "was unset" case.
    if (ORIGINAL_CHECKIN === undefined) delete process.env.CHECKIN_TOKEN_SECRET
    else process.env.CHECKIN_TOKEN_SECRET = ORIGINAL_CHECKIN
    if (ORIGINAL_AUTH === undefined) delete process.env.BETTER_AUTH_SECRET
    else process.env.BETTER_AUTH_SECRET = ORIGINAL_AUTH
  })

  it('prefers the dedicated CHECKIN_TOKEN_SECRET when set', () => {
    process.env.CHECKIN_TOKEN_SECRET = 'dedicated-checkin-secret-value'
    process.env.BETTER_AUTH_SECRET = 'auth-secret-should-be-ignored'

    expect(resolveCheckInSecret()).toBe('dedicated-checkin-secret-value')
  })

  it('falls back to BETTER_AUTH_SECRET when CHECKIN_TOKEN_SECRET is unset', () => {
    // CHECKIN_TOKEN_SECRET intentionally absent (deleted in beforeEach).
    process.env.BETTER_AUTH_SECRET = 'auth-secret-fallback-value'

    expect(resolveCheckInSecret()).toBe('auth-secret-fallback-value')
  })

  it('throws a configuration error when neither secret is set', () => {
    // Both keys deleted in beforeEach.
    expect(() => resolveCheckInSecret()).toThrow(/no check-in token secret configured/i)
  })

  it('error message names both env vars so the misconfiguration is actionable', () => {
    expect(() => resolveCheckInSecret()).toThrow(/CHECKIN_TOKEN_SECRET/)
    expect(() => resolveCheckInSecret()).toThrow(/BETTER_AUTH_SECRET/)
  })
})
