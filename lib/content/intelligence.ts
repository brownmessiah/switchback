import { and, desc, eq, max, min, sql } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'
import {
  type CardBadgeFields,
  loadCardBadgeResolver,
} from '@/lib/experiences/card-badges'
import { publiclyVisibleExperienceCondition } from '@/lib/experiences/public-filter'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { getActivity, isActivitySlug } from '@/lib/activities/registry'
import { getRegion, isRegionSlug, listRegions } from '@/lib/regions/registry'

/**
 * Data-derived destination / activity intelligence (issue 22, DECISION D8 —
 * DATA half only).
 *
 * Every section here is derived PURELY from published, non-fixture inventory
 * (gated through `publiclyVisibleExperienceCondition()` — D0) plus the static
 * region/activity registries. There is NO prose, AI-generated text, or
 * fabricated geo: "nearby" is honest same-state co-location (issue 16), and a
 * surface with no inventory yields null/empty sections so the page hides them.
 *
 * The AI-assisted prose half (best-time, how-to-reach, weather, tips, FAQ) is
 * issue #23 and is intentionally NOT implemented here.
 */

export type Difficulty = 'easy' | 'moderate' | 'challenging' | 'extreme'

/** Canonical difficulty order so the spread reads easy → extreme. */
const DIFFICULTY_ORDER: readonly Difficulty[] = [
  'easy',
  'moderate',
  'challenging',
  'extreme',
]

/** Min/max "From ₹X to ₹Y" derived from the published price brackets. */
export interface PriceRange {
  minRupees: number
  maxRupees: number
}

export interface ActivityCount {
  slug: string
  count: number
}

export interface RegionCount {
  slug: string
  count: number
}

export interface DifficultyCount {
  difficulty: Difficulty
  count: number
}

/** A featured card — the shared experience-card shape plus social proof. */
export interface FeaturedExperience extends CardBadgeFields {
  id: string
  slug: string
  title: string
  shortDescription: string | null
  pricePerParticipantRupees: number
  regionSlug: string
  activitySlug: string
  difficulty: Difficulty | null
}

export interface RegionIntelligence {
  priceRange: PriceRange | null
  /** Activities with published inventory in this region, ranked by count. */
  topActivities: ActivityCount[]
  /** OTHER same-state regions that have published inventory (no distance). */
  nearbyRegions: RegionCount[]
  difficultySpread: DifficultyCount[]
  featured: FeaturedExperience[]
}

export interface ActivityIntelligence {
  priceRange: PriceRange | null
  /** Destinations with published inventory for this activity, ranked by count. */
  topRegions: RegionCount[]
  difficultySpread: DifficultyCount[]
  featured: FeaturedExperience[]
}

/** Lowest of the three group-size brackets is the genuine "from" price. */
const lowestBracket = sql<string>`LEAST(${experiences.pricePerPerson_1_2}, ${experiences.pricePerPerson_3_5}, ${experiences.pricePerPerson_6_plus})`
/** Highest bracket across the inventory is the "up to" ceiling. */
const highestBracket = sql<string>`GREATEST(${experiences.pricePerPerson_1_2}, ${experiences.pricePerPerson_3_5}, ${experiences.pricePerPerson_6_plus})`

const MAX_FEATURED = 6

/** How many featured ids to consider before ranking (keeps the query bounded). */
const FEATURED_POOL = 24

async function derivePriceRange(
  db: DBOrTx,
  scope: ReturnType<typeof eq>,
): Promise<PriceRange | null> {
  const [row] = await db
    .select({
      min: min(lowestBracket),
      max: max(highestBracket),
    })
    .from(experiences)
    .where(and(scope, publiclyVisibleExperienceCondition()))

  if (!row || row.min === null || row.max === null) return null
  return {
    minRupees: Math.floor(Number(row.min)),
    maxRupees: Math.floor(Number(row.max)),
  }
}

async function deriveDifficultySpread(
  db: DBOrTx,
  scope: ReturnType<typeof eq>,
): Promise<DifficultyCount[]> {
  const rows = await db
    .select({
      difficulty: experiences.difficulty,
      count: sql<number>`count(*)::int`,
    })
    .from(experiences)
    .where(
      and(
        scope,
        sql`${experiences.difficulty} IS NOT NULL`,
        publiclyVisibleExperienceCondition(),
      ),
    )
    .groupBy(experiences.difficulty)

  const counts = new Map<Difficulty, number>()
  for (const r of rows) {
    if (r.difficulty) counts.set(r.difficulty, Number(r.count))
  }
  return DIFFICULTY_ORDER.filter((d) => counts.has(d)).map((d) => ({
    difficulty: d,
    count: counts.get(d)!,
  }))
}

/** Featured = top published non-fixture cards by real demand (then recency). */
async function deriveFeatured(
  db: DBOrTx,
  scope: ReturnType<typeof eq>,
): Promise<FeaturedExperience[]> {
  const rows = await db
    .select({
      id: experiences.id,
      slug: experiences.slug,
      title: experiences.title,
      shortDescription: experiences.shortDescription,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      regionSlug: experiences.regionSlug,
      activitySlug: experiences.activitySlug,
      difficulty: experiences.difficulty,
    })
    .from(experiences)
    .where(and(scope, publiclyVisibleExperienceCondition()))
    .orderBy(desc(experiences.createdAt))
    .limit(FEATURED_POOL)

  if (rows.length === 0) return []

  const resolveBadges = await loadCardBadgeResolver(
    db,
    rows.map((r) => r.id),
  )

  const enriched: FeaturedExperience[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    shortDescription: row.shortDescription,
    pricePerParticipantRupees: Math.floor(Number(row.pricePerPerson_1_2)),
    regionSlug: row.regionSlug,
    activitySlug: row.activitySlug,
    difficulty: row.difficulty,
    ...resolveBadges(row.id),
  }))

  // Rank by real demand signal: a highlighted (bestseller/top_rated) card
  // ranks above a bare one; ratingCount breaks ties; recency (the original
  // createdAt-DESC order) is the final, stable key.
  const score = (e: FeaturedExperience): number => {
    if (e.highlight === 'bestseller') return 2
    if (e.highlight === 'top_rated') return 1
    return 0
  }
  const ranked = enriched
    .map((exp, index) => ({ exp, index }))
    .sort((a, b) => {
      const s = score(b.exp) - score(a.exp)
      if (s !== 0) return s
      const rc = b.exp.ratingCount - a.exp.ratingCount
      if (rc !== 0) return rc
      return a.index - b.index
    })

  return ranked.slice(0, MAX_FEATURED).map(({ exp }) => exp)
}

/**
 * Derive the data-backed intelligence for a destination (region) page.
 * Returns null when the slug is not a registered region (the page 404s); an
 * empty-but-valid object (null/empty sections) when the region has no
 * published inventory so the page hides those sections.
 */
export async function deriveRegionIntelligence(
  db: DBOrTx,
  regionSlug: string,
): Promise<RegionIntelligence | null> {
  if (!isRegionSlug(regionSlug)) return null
  const region = getRegion(regionSlug)
  if (!region) return null

  const scope = eq(experiences.regionSlug, regionSlug)

  const [priceRange, topActivities, difficultySpread, featured] =
    await Promise.all([
      derivePriceRange(db, scope),
      deriveTopActivities(db, regionSlug),
      deriveDifficultySpread(db, scope),
      deriveFeatured(db, scope),
    ])

  const nearbyRegions = await deriveNearbyRegions(db, region.slug, region.state)

  return { priceRange, topActivities, nearbyRegions, difficultySpread, featured }
}

/** Activities with published inventory in a region, ranked by count desc. */
async function deriveTopActivities(
  db: DBOrTx,
  regionSlug: string,
): Promise<ActivityCount[]> {
  const rows = await db
    .select({
      slug: experiences.activitySlug,
      count: sql<number>`count(*)::int`,
    })
    .from(experiences)
    .where(
      and(eq(experiences.regionSlug, regionSlug), publiclyVisibleExperienceCondition()),
    )
    .groupBy(experiences.activitySlug)

  return rows
    .map((r) => ({ slug: r.slug, count: Number(r.count) }))
    .filter((r) => isActivitySlug(r.slug))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug))
}

/** Destinations with published inventory for an activity, ranked by count. */
async function deriveTopRegions(
  db: DBOrTx,
  activitySlug: string,
): Promise<RegionCount[]> {
  const rows = await db
    .select({
      slug: experiences.regionSlug,
      count: sql<number>`count(*)::int`,
    })
    .from(experiences)
    .where(
      and(eq(experiences.activitySlug, activitySlug), publiclyVisibleExperienceCondition()),
    )
    .groupBy(experiences.regionSlug)

  return rows
    .map((r) => ({ slug: r.slug, count: Number(r.count) }))
    .filter((r) => isRegionSlug(r.slug))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug))
}

/**
 * Nearby = OTHER registered regions in the SAME Indian state that have
 * published inventory. NO distance/coords are fabricated (issue 16 honesty).
 */
async function deriveNearbyRegions(
  db: DBOrTx,
  regionSlug: string,
  state: string,
): Promise<RegionCount[]> {
  const sameStateSlugs = listRegions()
    .filter((r) => r.state === state && r.slug !== regionSlug)
    .map((r) => r.slug)
  if (sameStateSlugs.length === 0) return []

  const rows = await db
    .select({
      slug: experiences.regionSlug,
      count: sql<number>`count(*)::int`,
    })
    .from(experiences)
    .where(
      and(
        sql`${experiences.regionSlug} IN (${sql.join(
          sameStateSlugs.map((s) => sql`${s}`),
          sql`, `,
        )})`,
        publiclyVisibleExperienceCondition(),
      ),
    )
    .groupBy(experiences.regionSlug)

  return rows
    .map((r) => ({ slug: r.slug, count: Number(r.count) }))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug))
}

/**
 * Derive the data-backed intelligence for an activity page. The analogue of
 * "top activities" is "top destinations" for the activity. Returns null when
 * the slug is not a registered activity.
 */
export async function deriveActivityIntelligence(
  db: DBOrTx,
  activitySlug: string,
): Promise<ActivityIntelligence | null> {
  if (!isActivitySlug(activitySlug)) return null
  if (!getActivity(activitySlug)) return null

  const scope = eq(experiences.activitySlug, activitySlug)

  const [priceRange, topRegions, difficultySpread, featured] =
    await Promise.all([
      derivePriceRange(db, scope),
      deriveTopRegions(db, activitySlug),
      deriveDifficultySpread(db, scope),
      deriveFeatured(db, scope),
    ])

  return { priceRange, topRegions, difficultySpread, featured }
}
