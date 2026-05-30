import { ensureExperienceIndexSettings } from './indexer'
import { getMeiliClient, type MeiliLike } from './meilisearch-client'

const EXPERIENCE_INDEX = 'experiences'

/**
 * One-shot guard so the search page configures the index's filter/sort
 * settings at most once per server process. A freshly provisioned (or
 * pre-existing but unconfigured) Meilisearch index has EMPTY filterable +
 * sortable attributes, which makes every filtered/sorted query 400 and
 * crash the search page (ADR-0013). We self-heal on the first search.
 */
let settingsEnsured: Promise<void> | null = null

async function ensureSettingsOnce(client: MeiliLike): Promise<void> {
  if (!settingsEnsured) {
    settingsEnsured = ensureExperienceIndexSettings({ client }).catch((err) => {
      // Reset so a transient failure can retry on the next search.
      settingsEnsured = null
      throw err
    })
  }
  await settingsEnsured
}

/** Test-only — clear the one-shot settings guard between cases. */
export function _resetSettingsGuardForTests(): void {
  settingsEnsured = null
}

export type SortOption = 'relevance' | 'price_asc' | 'price_desc' | 'newest'

export interface SearchExperiencesParams {
  q?: string
  activity?: string
  region?: string
  minPrice?: number
  maxPrice?: number
  sort?: SortOption
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
    params.sort
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
    // Customer applying a filter never hits a 400 (ADR-0013). Inside the try so
    // even a settings failure degrades gracefully rather than crashing the page.
    await ensureSettingsOnce(client)

    const result = await client.index(EXPERIENCE_INDEX).search(params.q ?? '', {
      filter: filter || undefined,
      sort: sort.length > 0 ? sort : undefined,
      facets: ['activitySlug', 'regionSlug'],
      limit: 20,
    })

    return {
      hits: result.hits as SearchExperienceHit[],
    }
  } catch {
    // Never crash the customer-facing search page on a Meilisearch error —
    // degrade to an empty result set (the page renders its empty state).
    return { hits: [] }
  }
}
