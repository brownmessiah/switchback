import { isFixtureExperienceSlug } from '@/lib/experiences/fixture-slugs'

import { ensureExperienceIndexSettings } from './indexer'
import { getMeiliClient, type MeiliLike } from './meilisearch-client'

const EXPERIENCE_INDEX = 'experiences'

// The one-shot settings guard lives in `indexer.ts` so the search READ path
// and the index WRITE path share a single process-level guard. Re-export the
// test reset from there.
export { _resetSettingsGuardForTests } from './indexer'

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

export function buildMeiliFilter(params: Omit<SearchExperiencesParams, 'q' | 'sort'>): string {
  const parts: string[] = []

  if (params.activity) {
    parts.push(`activitySlug = "${params.activity}"`)
  }
  if (params.region) {
    parts.push(`regionSlug = "${params.region}"`)
  }
  if (params.minPrice !== undefined) {
    parts.push(`pricePerPersonRupees >= ${params.minPrice}`)
  }
  if (params.maxPrice !== undefined) {
    parts.push(`pricePerPersonRupees <= ${params.maxPrice}`)
  }
  // ADR-0017 structured facets (issue 04). String values quoted, numerics
  // bare — matching the existing quoting style. `seasonMonths = N` is array
  // membership; `maxGroupSize >= N` is a "fits a group of N" lower bound.
  if (params.difficulty) {
    parts.push(`difficulty = "${params.difficulty}"`)
  }
  if (params.durationBand) {
    parts.push(`durationBand = "${params.durationBand}"`)
  }
  if (params.seasonMonth !== undefined) {
    parts.push(`seasonMonths = ${params.seasonMonth}`)
  }
  if (params.maxGroupSize !== undefined) {
    parts.push(`maxGroupSize >= ${params.maxGroupSize}`)
  }
  // Category (activity rollup) + Destination=State facets (issue 04 follow-up).
  // String values quoted, matching the existing style. Both are DERIVED index
  // attributes — a doc with an unknown activity/region slug carries null and so
  // never matches these filters (correct).
  if (params.category) {
    parts.push(`category = "${params.category}"`)
  }
  if (params.state) {
    parts.push(`state = "${params.state}"`)
  }
  // Issue 10 trust-oriented filters — all map to REAL index data (D0).
  // `minRating` is a numeric lower-bound; 0 is a legitimate value (unrated docs
  // index ratingAvg = 0) so we check `!== undefined`, not truthiness, and a
  // "rating ≥ 0" filter matches every doc. `safetyVerified` only filters when
  // TRUE (the per-listing Safety Checked signal, ADR-0015); `false` is unset.
  // `cancellation` is the Flexible preset (ADR-0005) — string, quoted; NEVER
  // "free".
  if (params.minRating !== undefined) {
    parts.push(`ratingAvg >= ${params.minRating}`)
  }
  if (params.safetyVerified) {
    parts.push('requiresSafetyStack = true')
  }
  if (params.cancellation) {
    parts.push(`cancellationPreset = "${params.cancellation}"`)
  }

  return parts.join(' AND ')
}

function meiliSort(sort: SortOption | undefined): string[] {
  switch (sort) {
    case 'price_asc':
      return ['pricePerPersonRupees:asc']
    case 'price_desc':
      return ['pricePerPersonRupees:desc']
    case 'newest':
      return ['publishedAtEpochMs:desc']
    case 'duration_asc':
      return ['durationMinutes:asc']
    case 'duration_desc':
      return ['durationMinutes:desc']
    default:
      return []
  }
}

export function isFilteredSearch(params: SearchExperiencesParams): boolean {
  return !!(
    params.activity ||
    params.region ||
    params.minPrice !== undefined ||
    params.maxPrice !== undefined ||
    params.sort ||
    // ADR-0017 structured facets (issue 04) — a filtered variant for the
    // noindex/canonical rules (ADR-0013) just as much as the legacy facets.
    params.difficulty ||
    params.durationBand ||
    params.seasonMonth !== undefined ||
    params.maxGroupSize !== undefined ||
    // Category + Destination=State facets (issue 04 follow-up).
    params.category ||
    params.state ||
    // Issue 10 trust-oriented filters. `minRating` checked with `!== undefined`
    // (0 is a real value); `safetyVerified` only when TRUE (unchecked is unset).
    params.minRating !== undefined ||
    params.safetyVerified ||
    params.cancellation
  )
}

export async function searchExperiences(
  params: SearchExperiencesParams,
  opts: { client?: MeiliLike } = {},
): Promise<SearchExperiencesResult> {
  const client = opts.client ?? getMeiliClient()
  const filter = buildMeiliFilter(params)
  const sort = meiliSort(params.sort)

  try {
    // Self-heal the index's filter/sort settings before the first query so a
    // Customer applying a filter never hits a 400 (ADR-0013). The guard is
    // process-level one-shot (shared with the index write path). Inside the try
    // so even a settings failure degrades gracefully rather than crashing.
    await ensureExperienceIndexSettings({ client })

    const result = await client.index(EXPERIENCE_INDEX).search(params.q ?? '', {
      filter: filter || undefined,
      sort: sort.length > 0 ? sort : undefined,
      facets: ['activitySlug', 'regionSlug', 'category', 'difficulty', 'durationBand'],
      limit: 20,
    })

    // Issue 04 leak hardening: defensively drop any admin/E2E fixture hit.
    // Fixtures are never indexed (the index write path + reindex script both
    // route through the shared public-filter), but a stale index from before
    // this gate must never surface one to a Customer.
    const hits = (result.hits as SearchExperienceHit[]).filter(
      (hit) => !isFixtureExperienceSlug(hit.slug),
    )

    return { hits }
  } catch (err) {
    // Never crash the customer-facing search page on a Meilisearch error —
    // degrade to an empty result set (the page renders its empty state). Log
    // server-side first so a full Meilisearch outage is observable rather than
    // silently rendering "0 results" indefinitely.
    console.error('[search] Meilisearch query failed; returning empty results', err)
    return { hits: [] }
  }
}
