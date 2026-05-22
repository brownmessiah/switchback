import { Redis } from '@upstash/redis'

import { env } from '@/lib/env'

/**
 * Upstash Redis client. Used for:
 *  - Razorpay webhook idempotency-key dedup (ADR-0001 / payments)
 *  - MSG91 OTP rate limiting (ADR-0015 SOS notification ceilings)
 *  - Bokun channel-manager webhook dedup (ADR-0014)
 *  - Hot cache for slug_redirects lookups (ADR-0013, 24h TTL)
 *
 * Returns a real client when UPSTASH_REDIS_REST_URL is set; otherwise
 * returns a stub that no-ops so feature code can run in local dev
 * without provisioning Redis.
 */
type RedisLike = Pick<Redis, 'get' | 'set' | 'del' | 'incr' | 'expire' | 'exists'>

let cached: RedisLike | null = null

export function getRedis(): RedisLike {
  if (cached) return cached

  const url = env.UPSTASH_REDIS_REST_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN

  if (url && token) {
    cached = new Redis({ url, token })
    return cached
  }

  // Local dev stub — every call resolves to "miss" so callers behave
  // as if the cache is cold but never errors.
  cached = {
    get: async () => null,
    set: async () => 'OK' as const,
    del: async () => 0,
    incr: async () => 1,
    expire: async () => 0,
    exists: async () => 0,
  } as RedisLike

  return cached
}

/** Test-only — wipe the cached instance so a fresh getRedis() runs init. */
export function _resetRedisCacheForTests(): void {
  cached = null
}
