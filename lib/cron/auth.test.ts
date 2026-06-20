import { describe, expect, it } from 'vitest'

import { isCronAuthorized } from './auth'

/**
 * Cron auth (ADR-0019). On Cloud Run the Scheduler sends its OIDC token in the
 * Authorization header (Cloud Run IAM gate), so the app-level CRON_SECRET
 * defense-in-depth must travel in X-Cron-Secret. Locally / on Vercel it stays in
 * the Authorization Bearer. Accept either, constant-time.
 */
function hdr(map: Record<string, string>): (k: string) => string | null {
  return (k) => map[k.toLowerCase()] ?? null
}

describe('isCronAuthorized', () => {
  const secret = 'top-secret'

  it('accepts Authorization: Bearer <secret> (local / Vercel)', () => {
    expect(isCronAuthorized(hdr({ authorization: `Bearer ${secret}` }), secret)).toBe(true)
  })

  it('accepts X-Cron-Secret when Authorization carries an OIDC token (Cloud Run)', () => {
    expect(
      isCronAuthorized(hdr({ authorization: 'Bearer eyJ.oidc.token', 'x-cron-secret': secret }), secret),
    ).toBe(true)
  })

  it('rejects when neither header matches', () => {
    expect(isCronAuthorized(hdr({ authorization: 'Bearer wrong' }), secret)).toBe(false)
    expect(isCronAuthorized(hdr({}), secret)).toBe(false)
  })

  it('rejects a wrong X-Cron-Secret', () => {
    expect(isCronAuthorized(hdr({ 'x-cron-secret': 'nope' }), secret)).toBe(false)
  })
})
