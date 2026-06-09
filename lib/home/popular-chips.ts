import { sql } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'
import { getActivity } from '@/lib/activities/registry'
import { publiclyVisibleExperienceCondition } from '@/lib/experiences/public-filter'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { getRegion } from '@/lib/regions/registry'
import { buildHomeSearchQuery } from '@/lib/search/home-query'

/**
 * Popular search chips for the home hero (issue 09 / DECISION D0).
 *
 * The hero offers a handful of high-intent (Destination × Activity) shortcuts —
 * "Rishikesh Rafting", "Bir Billing Paragliding", "Goa Scuba" — that deep-link
 * into a pre-filtered `/search`. A chip is shown ONLY if its exact
 * (region_slug, activity_slug) pair has REAL published, non-fixture inventory.
 * A chip pointing at empty results would be a dead link (0 results + noindex
 * under ADR-0013), which the issue forbids — so we never hardcode chips, we gate
 * the curated candidate list against the live published-count query (the shared
 * `publiclyVisibleExperienceCondition`, same gate every public list-query uses).
 *
 * The candidate pairs use the controlled-vocabulary registry slugs (NOT free
 * text): region slugs from `lib/regions/registry`, activity slugs from
 * `lib/activities/registry`. The label + i18n-key shaping mirrors
 * `lib/search/facet-options` so the chips localise across all 13 locales.
 */

/** Camelise a (possibly hyphenated) registry slug → an i18n key suffix. */
function slugToI18nKey(slug: string): string {
  return slug.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

interface CandidatePair {
  readonly regionSlug: string
  readonly activitySlug: string
}

/**
 * Curated (Destination × Activity) candidate pairs (issue 09). Each slug is a
 * real registry slug; the pair only surfaces as a chip if it has live
 * inventory. Order here is the display order.
 */
const CANDIDATE_PAIRS: readonly CandidatePair[] = [
  { regionSlug: 'rishikesh', activitySlug: 'rafting' },
  { regionSlug: 'bir-billing', activitySlug: 'paragliding' },
  { regionSlug: 'goa', activitySlug: 'scuba-diving' },
  { regionSlug: 'leh-ladakh', activitySlug: 'trekking' },
  { regionSlug: 'rishikesh', activitySlug: 'bungee-jumping' },
  { regionSlug: 'kasol', activitySlug: 'camping' },
]

export interface PopularSearchChip {
  readonly regionSlug: string
  readonly activitySlug: string
  /** English region display name (registry). */
  readonly regionNameEn: string
  /** English activity display name (registry). */
  readonly activityNameEn: string
  /** i18n key suffix under `SearchPage.regions`. */
  readonly regionI18nKey: string
  /** i18n key suffix under `SearchPage.activities`. */
  readonly activityI18nKey: string
  /** Pre-filtered `/search` URL for the pair (built via `buildHomeSearchQuery`). */
  readonly href: string
}

/**
 * Return the popular chips whose (region, activity) pair has live published
 * inventory, in curated display order. Empty list when no candidate pair has
 * any inventory (the hero then renders no chip section).
 *
 * One GROUP BY over published Experiences (the home is route-cached, so this
 * only fires on revalidation), intersected in-memory with the curated set.
 */
export async function loadPopularSearchChips(
  db: DBOrTx,
): Promise<PopularSearchChip[]> {
  const rows = await db
    .select({
      regionSlug: experiences.regionSlug,
      activitySlug: experiences.activitySlug,
      count: sql<number>`count(*)::int`,
    })
    .from(experiences)
    .where(publiclyVisibleExperienceCondition())
    .groupBy(experiences.regionSlug, experiences.activitySlug)

  const live = new Set(
    rows
      .filter((r) => Number(r.count) > 0)
      .map((r) => `${r.regionSlug}:${r.activitySlug}`),
  )

  const chips: PopularSearchChip[] = []
  for (const pair of CANDIDATE_PAIRS) {
    if (!live.has(`${pair.regionSlug}:${pair.activitySlug}`)) continue

    const region = getRegion(pair.regionSlug)
    const activity = getActivity(pair.activitySlug)
    // A candidate pair must reference real registry entries; skip defensively
    // if a slug ever drifts out of the controlled vocabulary.
    if (!region || !activity) continue

    chips.push({
      regionSlug: pair.regionSlug,
      activitySlug: pair.activitySlug,
      regionNameEn: region.displayName.en,
      activityNameEn: activity.displayName.en,
      regionI18nKey: slugToI18nKey(pair.regionSlug),
      activityI18nKey: slugToI18nKey(pair.activitySlug),
      href: buildHomeSearchQuery({
        destination: pair.regionSlug,
        activity: pair.activitySlug,
      }),
    })
  }

  return chips
}
