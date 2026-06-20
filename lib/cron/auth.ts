import { timingSafeEqual } from 'node:crypto'

function safeCompare(a: string, b: string): boolean {
  // Length must be checked first — timingSafeEqual throws on length mismatch,
  // which is itself a side channel.
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

/**
 * Cron request auth (ADR-0019). The shared CRON_SECRET is accepted via EITHER:
 *   - `Authorization: Bearer <secret>` — local / Vercel-style, OR
 *   - `X-Cron-Secret: <secret>` — Cloud Run, where the Authorization header
 *     carries the Cloud Scheduler OIDC token (the Cloud Run IAM gate).
 * Constant-time compare on both. This is defense-in-depth on top of OIDC + the
 * RUN_CRON_ROUTES env gate.
 */
export function isCronAuthorized(
  getHeader: (name: string) => string | null,
  secret: string,
): boolean {
  const authHeader = getHeader('authorization') ?? ''
  const cronHeader = getHeader('x-cron-secret') ?? ''
  return safeCompare(authHeader, `Bearer ${secret}`) || safeCompare(cronHeader, secret)
}
