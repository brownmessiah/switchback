import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'

import { db as prodDb } from '@/db/client'
import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { listActivities } from '@/lib/activities/registry'
import { isFixtureExperienceSlug } from '@/lib/experiences/fixture-slugs'
import { publiclyVisibleExperienceCondition } from '@/lib/experiences/public-filter'
import type { DBOrTx } from '@/lib/media/experience-images'
import { listRegions } from '@/lib/regions/registry'

import { DURATION_BAND_RANGES, type DurationBand } from './duration-band'

/**
 * Postgres-native experience search (ADR-0019, amends ADR-0013).
 *
 * Meilisearch is retired. `searchExperiences` serves the same `{ hits }` result
 * the customer `/search` page consumes, straight from Postgres:
 *   - the `q` text query → FTS (`to_tsvector` + GIN, `'english'`) over title +
 *     short_description with prefix matching, plus `pg_trgm` `word_similarity`
 *     for typo tolerance;
 *   - every facet/filter → a SQL `WHERE` clause;
 *   - every sort → an `ORDER BY`.
 *
 * Search is now exactly as available as the database the rest of the site
 * already needs — no second datastore, no index to keep in sync, no empty-result
 * fragility on an outage. The FTS expression below MUST stay byte-for-byte
 * identical to the GIN index in db/migrations/0034_postgres_native_search.sql or
 * the planner cannot use it.
 */

export type SortOption =
  | 'relevance'
  | 'price_asc'
  | 'price_desc'
  | 'newest'
  | 'duration_asc'
  | 'duration_desc'

export interface SearchExperiencesParams {
  q?: string
  activity?: string
  region?: string
  minPrice?: number
  maxPrice?: number
  sort?: SortOption
  // ADR-0017 structured facets (issue 04).
  difficulty?: string
  durationBand?: string
  /** Month (1-12) the Experience must run in — `seasonMonths` array membership. */
  seasonMonth?: number
  /** "Fits a group of N" — matches Experiences whose maxGroupSize >= N. */
  maxGroupSize?: number
  /** Activity-category rollup (water/aerial/mountain/wildlife/urban) — issue 04 follow-up. */
  category?: string
  /** Destination = Indian state (e.g. "Goa", "Himachal Pradesh") — issue 04 follow-up. */
  state?: string
  // Issue 10 trust-oriented filters — all map to REAL data (D0).
  /** Minimum published-review rating average — `ratingAvg >= N`. */
  minRating?: number
  /**
   * "Safety Checked" filter — the per-listing Safety stack signal (ADR-0015).
   * Maps to `requiresSafetyStack = true`. Only `true` is a filter; `false`
   * (the unchecked control) is an unset filter and is omitted.
   */
  safetyVerified?: boolean
  /** Flexible cancellation preset (ADR-0005) — `cancellationPreset = "flexible"`. NEVER "free". */
  cancellation?: string
}

export interface SearchExperienceHit {
  id: string
  slug: string
  title: string
  shortDescription: string | null
  activitySlug: string
  regionSlug: string
  vendorSlug: string
  pricePerPersonRupees: number
  isCombo: boolean
  // ADR-0017 — additive; surfaced for result-card display where present.
  difficulty?: string | null
  durationMinutes?: number | null
}

export interface SearchExperiencesResult {
  hits: SearchExperienceHit[]
}

/** Max hits returned to the search page (matches the prior Meili `limit`). */
const SEARCH_LIMIT = 20

/**
 * True iff the search carries any facet/sort/filter (NOT a bare `q`). Drives the
 * ADR-0013 canonical/robots rules (a filtered variant is noindex,follow and
 * canonicalises to the unfiltered /search). `q`-only is treated as unfiltered.
 */
export function isFilteredSearch(params: SearchExperiencesParams): boolean {
  return !!(
    params.activity ||
    params.region ||
    params.minPrice !== undefined ||
    params.maxPrice !== undefined ||
    params.sort ||
    params.difficulty ||
    params.durationBand ||
    params.seasonMonth !== undefined ||
    params.maxGroupSize !== undefined ||
    params.category ||
    params.state ||
    params.minRating !== undefined ||
    params.safetyVerified ||
    params.cancellation
  )
}

/** Activity slugs whose registry `category` rolls up to the given category. */
function activitySlugsForCategory(category: string): string[] {
  return listActivities()
    .filter((a) => a.category === category)
    .map((a) => a.slug)
}

/** Region slugs whose registry `state` matches the given Indian state. */
function regionSlugsForState(state: string): string[] {
  return listRegions()
    .filter((r) => r.state === state)
    .map((r) => r.slug)
}

/** FTS expression over title + short_description — identical to the 0034 GIN index. */
const FTS_EXPR = sql`to_tsvector('english', coalesce(${experiences.title}, '') || ' ' || coalesce(${experiences.shortDescription}, ''))`

/** Build a prefix tsquery string (`raft:* & water:*`) from sanitized terms. */
function prefixTsquery(q: string): string {
  return q
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter(Boolean)
    .map((t) => `${t}:*`)
    .join(' & ')
}

export async function searchExperiences(
  params: SearchExperiencesParams,
  opts: { db?: DBOrTx } = {},
): Promise<SearchExperiencesResult> {
  const dbh = opts.db ?? prodDb

  const conditions: SQL[] = [publiclyVisibleExperienceCondition()]

  if (params.activity) conditions.push(eq(experiences.activitySlug, params.activity))
  if (params.region) conditions.push(eq(experiences.regionSlug, params.region))
  if (params.minPrice !== undefined) {
    conditions.push(sql`${experiences.pricePerPerson_1_2} >= ${params.minPrice}`)
  }
  if (params.maxPrice !== undefined) {
    conditions.push(sql`${experiences.pricePerPerson_1_2} <= ${params.maxPrice}`)
  }
  // Enum columns compared as text so an unknown URL value matches nothing
  // (rather than erroring on an invalid enum label).
  if (params.difficulty) {
    conditions.push(sql`${experiences.difficulty}::text = ${params.difficulty}`)
  }
  if (params.durationBand) {
    const range = DURATION_BAND_RANGES[params.durationBand as DurationBand]
    if (range) {
      conditions.push(gte(experiences.durationMinutes, range.min))
      if (range.max !== null) conditions.push(lte(experiences.durationMinutes, range.max))
    } else {
      conditions.push(sql`false`)
    }
  }
  if (params.seasonMonth !== undefined) {
    conditions.push(sql`${params.seasonMonth} = ANY(${experiences.seasonMonths})`)
  }
  if (params.maxGroupSize !== undefined) {
    conditions.push(gte(experiences.maxGroupSize, params.maxGroupSize))
  }
  if (params.category) {
    const slugs = activitySlugsForCategory(params.category)
    conditions.push(slugs.length ? inArray(experiences.activitySlug, slugs) : sql`false`)
  }
  if (params.state) {
    const slugs = regionSlugsForState(params.state)
    conditions.push(slugs.length ? inArray(experiences.regionSlug, slugs) : sql`false`)
  }
  if (params.minRating !== undefined) {
    // Correlated published-review average (1-decimal, matching loadExperienceRatingMap).
    // COALESCE(...,0) so unrated experiences pass `minRating = 0` and fail any N>0.
    conditions.push(
      sql`coalesce((select round(avg(reviews.rating)::numeric, 1) from reviews where reviews.experience_id = ${experiences.id} and reviews.status = 'published'), 0) >= ${params.minRating}`,
    )
  }
  if (params.safetyVerified) {
    conditions.push(eq(experiences.requiresSafetyStack, true))
  }
  if (params.cancellation) {
    conditions.push(sql`${experiences.cancellationPreset}::text = ${params.cancellation}`)
  }

  // Full-text query: FTS (prefix + stemming) OR pg_trgm word-similarity (typos).
  const q = params.q?.trim()
  let relevanceRank: SQL | null = null
  if (q) {
    const tsquery = prefixTsquery(q)
    const ors: SQL[] = []
    if (tsquery) ors.push(sql`${FTS_EXPR} @@ to_tsquery('english', ${tsquery})`)
    ors.push(sql`word_similarity(${q}, ${experiences.title}) >= 0.4`)
    ors.push(sql`word_similarity(${q}, coalesce(${experiences.shortDescription}, '')) >= 0.4`)
    conditions.push(sql`(${sql.join(ors, sql` OR `)})`)
    relevanceRank = sql`(ts_rank_cd(${FTS_EXPR}, to_tsquery('english', ${tsquery || ''})) + word_similarity(${q}, ${experiences.title}))`
  }

  const orderBy: SQL[] = []
  switch (params.sort) {
    case 'price_asc':
      orderBy.push(asc(experiences.pricePerPerson_1_2))
      break
    case 'price_desc':
      orderBy.push(desc(experiences.pricePerPerson_1_2))
      break
    case 'newest':
      orderBy.push(desc(experiences.updatedAt))
      break
    case 'duration_asc':
      orderBy.push(asc(experiences.durationMinutes))
      break
    case 'duration_desc':
      orderBy.push(desc(experiences.durationMinutes))
      break
    default:
      // 'relevance' / unset: rank by text relevance when a query is present,
      // else newest-first. Deterministic id tiebreak below.
      orderBy.push(relevanceRank ? desc(relevanceRank) : desc(experiences.updatedAt))
  }
  orderBy.push(asc(experiences.id))

  try {
    const rows = await dbh
      .select({
        id: experiences.id,
        slug: experiences.slug,
        title: experiences.title,
        shortDescription: experiences.shortDescription,
        activitySlug: experiences.activitySlug,
        regionSlug: experiences.regionSlug,
        vendorSlug: vendorProfiles.slug,
        pricePerPerson_1_2: experiences.pricePerPerson_1_2,
        isCombo: experiences.isCombo,
        difficulty: experiences.difficulty,
        durationMinutes: experiences.durationMinutes,
      })
      .from(experiences)
      .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(SEARCH_LIMIT)

    // Belt-and-suspenders: the SQL already excludes fixtures via
    // publiclyVisibleExperienceCondition(); this guarantees a fixture never
    // surfaces even if that predicate is ever loosened.
    const hits: SearchExperienceHit[] = rows
      .filter((r) => !isFixtureExperienceSlug(r.slug))
      .map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        shortDescription: r.shortDescription,
        activitySlug: r.activitySlug,
        regionSlug: r.regionSlug,
        vendorSlug: r.vendorSlug,
        pricePerPersonRupees: Math.round(Number(r.pricePerPerson_1_2)),
        isCombo: r.isCombo,
        difficulty: r.difficulty,
        durationMinutes: r.durationMinutes,
      }))

    return { hits }
  } catch (err) {
    // Never crash the customer-facing search page on a DB error — degrade to an
    // empty result (the page renders its empty state). Log first so an outage is
    // observable rather than a silent "0 results".
    console.error('[search] Postgres search failed; returning empty results', err)
    return { hits: [] }
  }
}
