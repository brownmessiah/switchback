'use server'

import { headers } from 'next/headers'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import {
  generateItinerary,
  tripPlannerInputSchema,
  type Itinerary,
} from '@/lib/ai/trip-planner'
import { getRedis } from '@/lib/redis'

export type PlanTripResult =
  | { ok: true; itinerary: Itinerary }
  | { ok: false; error: 'invalid_input' | 'no_inventory' | 'rate_limited' | 'failed' }

/** Soft abuse guard: max requests per identity per rolling window. */
const RATE_LIMIT_MAX = 8
const RATE_LIMIT_WINDOW_SECONDS = 60 * 5

/**
 * Server Action for the trip planner.
 *
 * SECURITY: the Anthropic key lives only in `lib/ai/claude-client.ts` (a
 * `server-only` module) and is read inside `generateItinerary` here on the
 * server. It is never passed to or referenced by the client form, so it cannot
 * leak into the browser bundle (ADR-0010 + project security rules).
 *
 * The page is public (ai_generations.requested_by_user_id is nullable), so an
 * anonymous Customer can plan; we still attach the user id when signed in for
 * provenance, and apply a soft per-identity rate cap as a basic abuse guard.
 */
export async function planTrip(formData: FormData): Promise<PlanTripResult> {
  const parsed = tripPlannerInputSchema.safeParse({
    region: String(formData.get('region') ?? ''),
    activity: formData.get('activity') ? String(formData.get('activity')) : undefined,
    days: Number(formData.get('days')),
    budgetRupees: Number(formData.get('budgetRupees')),
    groupSize: Number(formData.get('groupSize')),
    travelStyle: String(formData.get('travelStyle') ?? ''),
  })

  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' }
  }

  let requestedByUserId: string | null = null
  let rateKeyId = 'anon'
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (session?.user) {
      requestedByUserId = session.user.id
      rateKeyId = session.user.id
    }
  } catch {
    // Anonymous is allowed — fall through with a null user id.
  }

  // Soft rate limit (best-effort; never blocks on Redis failure).
  try {
    const redis = getRedis()
    const key = `trip-planner:rate:${rateKeyId}`
    const count = await redis.incr(key)
    if (count === 1) {
      await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS)
    }
    if (count > RATE_LIMIT_MAX) {
      return { ok: false, error: 'rate_limited' }
    }
  } catch {
    // Degrade open — a rate-limiter outage must not break the page.
  }

  try {
    const itinerary = await generateItinerary(db, parsed.data, { requestedByUserId })
    const hasRecommendation = itinerary.days.some((d) => d.items.length > 0)
    if (!hasRecommendation) {
      return { ok: false, error: 'no_inventory' }
    }
    return { ok: true, itinerary }
  } catch (error: unknown) {
    console.error('[trip-planner] generation failed', error)
    return { ok: false, error: 'failed' }
  }
}
