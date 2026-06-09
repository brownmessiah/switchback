import { and, eq, ne } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'
import type { ExperienceCardData } from '@/components/experience-card'
import { enrichCardBadges, loadExperienceBookingCountMap } from '@/lib/experiences/card-badges'
import { publiclyVisibleExperienceCondition } from '@/lib/experiences/public-filter'
import { loadExperienceCoverMap } from '@/lib/media/experience-images'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { getRegion } from '@/lib/regions/registry'

/**
 * "Similar experiences" loader for the PDP.
 *
 * Mixes THREE complementary intents so a visitor who is not sold on the current
 * Experience still has a meaningful next step, while NEVER surfacing a listing
 * that is not publicly visible (guardrail D0): EVERY intent group is gated
 * through `lib/experiences/public-filter`
 * (`publiclyVisibleExperienceCondition()` — `status='published'` AND
 * non-fixture). The intents are:
 *
 *   (a) SAME activity, DIFFERENT region. "Nearby" is modelled HONESTLY: there
 *       are no coordinates in the schema, so we do NOT fabricate a distance
 *       metric. Instead we prefer regions in the SAME Indian state (via the
 *       region registry, `lib/regions/registry`), with other regions kept as a
 *       secondary fallback.
 *   (b) SAME region, DIFFERENT activity.
 *   (c) Beginner-friendly alternatives — `difficulty='easy'` — ordered by REAL
 *       demand (the confirmed/awaiting_completion/completed booking count from
 *       `loadExperienceBookingCountMap`), so "popular" is never fabricated.
 *
 * The three candidate lists are concatenated in intent order, the current
 * Experience is excluded, the merge is de-duplicated by id (an Experience that
 * matches two intents appears once, in its first-matched slot), and the result
 * is capped. Cards are shaped + enriched exactly like the home / search / rail
 * grids (`enrichCardBadges`) so the section's tiles are visually identical.
 *
 * Empty-safe: returns `[]` when no candidate qualifies, so the PDP can hide the
 * whole section.
 */

/** Default number of similar cards rendered on the PDP. */
export const SIMILAR_EXPERIENCES_MAX = 8

/** The current Experience's identity + facets the intents key off. */
export interface SimilarExperienceContext {
  id: string
  slug: string
  regionSlug: string
  activitySlug: string
}

/** The column set each intent query selects (the card-shaping source row). */
interface CandidateRow {
  id: string
  slug: string
  title: string
  shortDescription: string | null
  pricePerPerson_1_2: string
  regionSlug: string
  activitySlug: string
  difficulty: 'easy' | 'moderate' | 'challenging' | 'extreme' | null
}

const CANDIDATE_COLUMNS = {
  id: experiences.id,
  slug: experiences.slug,
  title: experiences.title,
  shortDescription: experiences.shortDescription,
  pricePerPerson_1_2: experiences.pricePerPerson_1_2,
  regionSlug: experiences.regionSlug,
  activitySlug: experiences.activitySlug,
  difficulty: experiences.difficulty,
} as const

/** Per-intent fetch cap — enough headroom that the merged cap stays full. */
const PER_INTENT_LIMIT = 12

export async function loadSimilarExperiences(
  db: DBOrTx,
  current: SimilarExperienceContext,
  maxItems: number = SIMILAR_EXPERIENCES_MAX,
): Promise<ExperienceCardData[]> {
  const currentState = getRegion(current.regionSlug)?.state ?? null

  // Intent (a) — same activity, different region. Prefer same-state regions
  // ("nearby" = same Indian state; no fabricated distance). We order so that
  // same-state rows sort first, then fall back to other regions.
  const sameActivityRows = await db
    .select(CANDIDATE_COLUMNS)
    .from(experiences)
    .where(
      and(
        eq(experiences.activitySlug, current.activitySlug),
        ne(experiences.regionSlug, current.regionSlug),
        publiclyVisibleExperienceCondition(),
      ),
    )
    .limit(PER_INTENT_LIMIT)

  // Intent (b) — same region, different activity.
  const sameRegionRows = await db
    .select(CANDIDATE_COLUMNS)
    .from(experiences)
    .where(
      and(
        eq(experiences.regionSlug, current.regionSlug),
        ne(experiences.activitySlug, current.activitySlug),
        publiclyVisibleExperienceCondition(),
      ),
    )
    .limit(PER_INTENT_LIMIT)

  // Intent (c) — beginner-friendly (easy) alternatives, ordered by REAL demand
  // (the bestseller signal). We fetch the easy pool, then sort by the demand
  // count loaded below.
  const easyRows = await db
    .select(CANDIDATE_COLUMNS)
    .from(experiences)
    .where(
      and(
        eq(experiences.difficulty, 'easy'),
        publiclyVisibleExperienceCondition(),
      ),
    )
    .limit(PER_INTENT_LIMIT)

  // Demand ordering for the beginner-friendly pool (popularity = real demand).
  const demandMap = await loadExperienceBookingCountMap(
    db,
    easyRows.map((r) => r.id),
  )
  const orderedEasyRows = [...easyRows].sort(
    (a, b) => (demandMap.get(b.id) ?? 0) - (demandMap.get(a.id) ?? 0),
  )

  // Same-state-first ordering for the same-activity pool (honest "nearby").
  const orderedSameActivityRows = currentState
    ? [...sameActivityRows].sort((a, b) => {
        const aSame = getRegion(a.regionSlug)?.state === currentState ? 0 : 1
        const bSame = getRegion(b.regionSlug)?.state === currentState ? 0 : 1
        return aSame - bSame
      })
    : sameActivityRows

  // Merge in intent order, EXCLUDE the current Experience, dedupe by id (first
  // match wins), then cap.
  const merged: CandidateRow[] = []
  const seen = new Set<string>([current.id])
  for (const row of [
    ...orderedSameActivityRows,
    ...sameRegionRows,
    ...orderedEasyRows,
  ]) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    merged.push(row)
    if (merged.length >= maxItems) break
  }

  if (merged.length === 0) return []

  const coverMap = await loadExperienceCoverMap(
    db,
    merged.map((r) => r.id),
  )

  const cards: ExperienceCardData[] = merged.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    shortDescription: row.shortDescription,
    pricePerParticipantRupees: Math.floor(Number(row.pricePerPerson_1_2)),
    regionSlug: row.regionSlug,
    activitySlug: row.activitySlug,
    coverImageUrl: coverMap.get(row.id) ?? null,
    difficulty: row.difficulty,
  }))

  return enrichCardBadges(db, cards)
}
