import { and, count, desc, eq } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'
import { loadCardBadgeResolver } from '@/lib/experiences/card-badges'
import { publiclyVisibleExperienceCondition } from '@/lib/experiences/public-filter'
import { getRegionImage } from '@/lib/images'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import {
  type RegionMeta,
  getRegion,
  isRegionSlug,
  listRegions,
} from '@/lib/regions/registry'

/**
 * Destinations landing loaders (Issue 04).
 *
 * Powers the `/{lng}/destinations` index and the
 * `/{lng}/destinations/{region}` region landings. Region vocabulary is
 * sourced exclusively from `lib/regions/registry.ts` — there is no
 * parallel region list. Like the activity-city loader, only `published`
 * Experiences surface; a region with no published Experiences still
 * renders (the SEO value is in the editorial + JSON-LD scaffolding).
 *
 * Order: createdAt DESC for now — mirrors the activity-city loader's
 * recency placeholder until Meilisearch ranking lands.
 */

export interface RegionLandingExperience {
  id: string
  slug: string
  title: string
  pricePerParticipantRupees: number
  shortDescription: string | null
  activitySlug: string
  regionSlug: string
  difficulty: 'easy' | 'moderate' | 'challenging' | 'extreme' | null
  ratingAvg: number | null
  ratingCount: number
  highlight: 'bestseller' | 'top_rated' | null
}

export interface RegionLandingData {
  region: RegionMeta
  experiences: RegionLandingExperience[]
}

export interface LoadRegionLandingArgs {
  /** Maximum number of Experiences to return. Defaults to 24. */
  topN?: number
}

export interface RegionWithCount {
  region: RegionMeta
  experienceCount: number
  imageUrl: string
}

const DEFAULT_TOP_N = 24

/**
 * Load a single region landing: the region metadata (from the registry)
 * plus its published Experiences. Returns null when the slug is not a
 * registered region — the page routes to 404 on null.
 */
export async function loadRegionLanding(
  db: DBOrTx,
  regionSlug: string,
  args: LoadRegionLandingArgs = {},
): Promise<RegionLandingData | null> {
  if (!isRegionSlug(regionSlug)) return null
  const region = getRegion(regionSlug)
  if (!region) return null

  const limit = Math.max(1, args.topN ?? DEFAULT_TOP_N)

  const rows = await db
    .select({
      id: experiences.id,
      slug: experiences.slug,
      title: experiences.title,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      shortDescription: experiences.shortDescription,
      activitySlug: experiences.activitySlug,
      regionSlug: experiences.regionSlug,
      difficulty: experiences.difficulty,
    })
    .from(experiences)
    .where(
      and(
        eq(experiences.regionSlug, regionSlug),
        publiclyVisibleExperienceCondition(),
      ),
    )
    .orderBy(desc(experiences.createdAt))
    .limit(limit)

  const resolveBadges = await loadCardBadgeResolver(
    db,
    rows.map((r) => r.id),
  )

  return {
    region,
    experiences: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      pricePerParticipantRupees: Math.floor(Number(row.pricePerPerson_1_2)),
      shortDescription: row.shortDescription,
      activitySlug: row.activitySlug,
      regionSlug: row.regionSlug,
      difficulty: row.difficulty,
      ...resolveBadges(row.id),
    })),
  }
}

/**
 * List every region from the registry with its published-Experience count
 * and hero imagery. Powers the `/destinations` index grid — the registry
 * is the source of truth for which regions exist, so regions with zero
 * published Experiences still appear (count 0).
 */
export async function listRegionsWithCounts(
  db: DBOrTx,
): Promise<RegionWithCount[]> {
  const rows = await db
    .select({
      regionSlug: experiences.regionSlug,
      experienceCount: count(),
    })
    .from(experiences)
    .where(publiclyVisibleExperienceCondition())
    .groupBy(experiences.regionSlug)

  const countsBySlug = new Map<string, number>(
    rows.map((row) => [row.regionSlug, Number(row.experienceCount)]),
  )

  return listRegions().map((region) => ({
    region,
    experienceCount: countsBySlug.get(region.slug) ?? 0,
    imageUrl: getRegionImage(region.slug),
  }))
}
