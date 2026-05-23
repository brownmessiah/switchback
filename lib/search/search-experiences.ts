import { getMeiliClient, type MeiliLike } from './meilisearch-client'

const EXPERIENCE_INDEX = 'experiences'

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

  const result = await client.index(EXPERIENCE_INDEX).search(params.q ?? '', {
    filter: filter || undefined,
    sort: sort.length > 0 ? sort : undefined,
    facets: ['activitySlug', 'regionSlug'],
    limit: 20,
  })

  return {
    hits: result.hits as SearchExperienceHit[],
  }
}
