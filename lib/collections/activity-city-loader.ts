import { and, desc, eq } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'
import {
  type ActivityMeta,
  getActivity,
  isActivitySlug,
} from '@/lib/activities/registry'
import { loadExperienceCoverMap } from '@/lib/media/experience-images'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import {
  type RegionMeta,
  getRegion,
  isRegionSlug,
} from '@/lib/regions/registry'

/**
 * Activity-city collection loader per ADR-0013.
 *
 * Loads the data the `/{lng}/adventure/{slug}` page renders:
 *   - The activity + region metadata (display names per locale).
 *   - The top-N published Experiences matching the activity_slug and
 *     region_slug combination.
 *
 * Slug parsing is non-trivial because both sides can contain hyphens
 * ('scuba-diving-in-bir-billing'). We resolve ambiguity by checking
 * every possible `-in-` split point against the controlled-vocabulary
 * registries — only one split satisfies both `isActivitySlug` and
 * `isRegionSlug`. Returns null when no split resolves; the page
 * routes to 404 on null.
 *
 * Order: createdAt DESC for M2. M3 brings in response-time SLA score
 * + Meilisearch ranking; the SQL here is a placeholder ordered by
 * recency until that lands.
 */

export interface ActivityCityCollectionExperience {
  id: string
  slug: string
  title: string
  pricePerParticipantRupees: number
  shortDescription: string | null
  coverImageUrl: string | null
}

export interface ActivityCityCollectionData {
  lng: string
  activity: ActivityMeta
  region: RegionMeta
  experiences: ActivityCityCollectionExperience[]
}

export interface LoadActivityCityCollectionArgs {
  lng: string
  slug: string
  /** Maximum number of Experiences to return. Defaults to 12. */
  topN?: number
}

const DEFAULT_TOP_N = 12
const SEPARATOR = '-in-'

/**
 * Try every possible `-in-` split and return the first pair where both
 * sides are registered slugs. Returns null otherwise.
 */
export function parseActivityCitySlug(
  slug: string,
): { activitySlug: string; regionSlug: string } | null {
  if (!slug) return null

  let searchFrom = 0
  for (;;) {
    const index = slug.indexOf(SEPARATOR, searchFrom)
    if (index === -1) return null
    const activitySlug = slug.slice(0, index)
    const regionSlug = slug.slice(index + SEPARATOR.length)
    if (isActivitySlug(activitySlug) && isRegionSlug(regionSlug)) {
      return { activitySlug, regionSlug }
    }
    searchFrom = index + 1
  }
}

export async function loadActivityCityCollection(
  db: DBOrTx,
  args: LoadActivityCityCollectionArgs,
): Promise<ActivityCityCollectionData | null> {
  const parsed = parseActivityCitySlug(args.slug)
  if (!parsed) return null

  const activity = getActivity(parsed.activitySlug)
  const region = getRegion(parsed.regionSlug)
  if (!activity || !region) return null

  const limit = Math.max(1, args.topN ?? DEFAULT_TOP_N)

  const rows = await db
    .select({
      id: experiences.id,
      slug: experiences.slug,
      title: experiences.title,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      shortDescription: experiences.shortDescription,
    })
    .from(experiences)
    .where(
      and(
        eq(experiences.activitySlug, parsed.activitySlug),
        eq(experiences.regionSlug, parsed.regionSlug),
        eq(experiences.status, 'published'),
      ),
    )
    .orderBy(desc(experiences.createdAt))
    .limit(limit)

  const coverMap = await loadExperienceCoverMap(db, rows.map((r) => r.id))

  return {
    lng: args.lng,
    activity,
    region,
    experiences: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      pricePerParticipantRupees: Math.floor(Number(row.pricePerPerson_1_2)),
      shortDescription: row.shortDescription,
      coverImageUrl: coverMap.get(row.id) ?? null,
    })),
  }
}
