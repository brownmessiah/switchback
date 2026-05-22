import { Redis } from '@upstash/redis'

import { env } from '@/lib/env'

/**
 * Upstash Redis client. Used for:
 *  - Razorpay webhook idempotency-key dedup (ADR-0001 / payments)
 *  - Booking-create idempotency-key dedup (ADR-0001)
 *  - MSG91 OTP rate limiting (ADR-0015 SOS notification ceilings)
 *  - Bokun channel-manager webhook dedup (ADR-0014)
 *  - Hot cache for slug_redirects lookups (ADR-0013, 24h TTL)
 *
 * Returns a real client when UPSTASH_REDIS_REST_URL is set; otherwise
 * returns a Map-backed in-memory stub so feature code can run AND
 * verify idempotent behaviour locally without provisioning Redis.
 *
 * The stub honours get/set/del/exists semantics correctly so that
 * idempotency tests (booking-create, webhook dedup) verify the same
 * behaviour they get in production. TTLs are no-ops in the stub —
 * tests that want eviction behaviour mock Redis explicitly.
 */
type SetOptions = { ex?: number; px?: number; nx?: boolean; xx?: boolean }
type RedisLike = {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, opts?: SetOptions) => Promise<'OK' | null>
  del: (key: string) => Promise<number>
  incr: (key: string) => Promise<number>
  expire: (key: string, seconds: number) => Promise<number>
  exists: (key: string) => Promise<number>
}

let cached: RedisLike | null = null

function makeStub(): RedisLike {
  const store = new Map<string, string>()
  return {
    get: async (key) => store.get(key) ?? null,
    set: async (key, value, opts) => {
      if (opts?.nx && store.has(key)) return null
      if (opts?.xx && !store.has(key)) return null
      store.set(key, String(value))
      return 'OK'
    },
    del: async (key) => (store.delete(key) ? 1 : 0),
    incr: async (key) => {
      const next = Number(store.get(key) ?? '0') + 1
      store.set(key, String(next))
      return next
    },
    expire: async () => 1,
    exists: async (key) => (store.has(key) ? 1 : 0),
  }
}

export function getRedis(): RedisLike {
  if (cached) return cached

  const url = env.UPSTASH_REDIS_REST_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN

  if (url && token) {
    cached = new Redis({ url, token }) as unknown as RedisLike
    return cached
  }

  cached = makeStub()
  return cached
}

/** Test-only — wipe the cached instance so a fresh getRedis() runs init. */
export function _resetRedisCacheForTests(): void {
  cached = null
}
