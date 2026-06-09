import { and, desc, eq, inArray } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'
import { loadCardBadgeResolver } from '@/lib/experiences/card-badges'
import {
  type CardTrustFields,
  loadTrustBadgeFieldResolver,
} from '@/lib/trust-badges/card-trust-fields'
import { publiclyVisibleExperienceCondition } from '@/lib/experiences/public-filter'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import {
  type ActivityCategory,
  type ActivityMeta,
  getActivity,
  isActivitySlug,
  listActivities,
} from './registry'

/**
 * Cross-region activity + category landing-page loaders.
 *
 * These COMPLEMENT the activity-in-city collection (lib/collections/
 * activity-city-loader.ts, `/adventure/{slug}`):
 *   - `/activities/{slug}` — one activity across ALL regions.
 *   - `/category/{slug}`  — a category rollup (all published Experiences
 *     whose activity's `category` matches).
 *
 * Slugs are sourced from the controlled-vocabulary activity registry
 * (lib/activities/registry.ts) — there is no parallel list here. The
 * registry has no category helper, so the distinct categories (those with
 * ≥1 activity) and category validation are derived from `listActivities()`.
 *
 * Order: createdAt DESC for M2, mirroring the activity-city loader until
 * the M3 ranking lands.
 */

const DEFAULT_TOP_N = 24

/** Distinct categories that have at least one activity in the registry. */
export function listCategories(): readonly ActivityCategory[] {
  const seen = new Set<ActivityCategory>()
  const result: ActivityCategory[] = []
  for (const activity of listActivities()) {
    if (!seen.has(activity.category)) {
      seen.add(activity.category)
      result.push(activity.category)
    }
  }
  return result
}

/** True when `value` is a category with ≥1 activity in the registry. */
export function isCategorySlug(value: unknown): value is ActivityCategory {
  if (typeof value !== 'string' || value === '') return false
  return (listCategories() as readonly string[]).includes(value)
}

export interface LandingExperience extends CardTrustFields {
  id: string
  slug: string
  title: string
  pricePerParticipantRupees: number
  shortDescription: string | null
  regionSlug: string
  activitySlug: string
  difficulty: 'easy' | 'moderate' | 'challenging' | 'extreme' | null
  ratingAvg: number | null
  ratingCount: number
  highlight: 'bestseller' | 'top_rated' | null
}

export interface ActivityLandingData {
  activity: ActivityMeta
  experiences: LandingExperience[]
}

export interface CategoryLandingData {
  category: ActivityCategory
  /** The activities that roll up into this category, for editorial context. */
  activities: readonly ActivityMeta[]
  experiences: LandingExperience[]
}

interface LandingQueryRow {
  id: string
  slug: string
  title: string
  pricePerPerson_1_2: string
  shortDescription: string | null
  regionSlug: string
  activitySlug: string
  difficulty: 'easy' | 'moderate' | 'challenging' | 'extreme' | null
}

/**
 * Map query rows → card-ready `LandingExperience[]`, enriching rating +
 * social-proof from the DB in one batch (shared by the activity + category
 * landings so both surfaces stay DRY).
 */
async function toLandingExperiences(
  db: DBOrTx,
  rows: LandingQueryRow[],
): Promise<LandingExperience[]> {
  const ids = rows.map((r) => r.id)
  const [resolveBadges, resolveTrust] = await Promise.all([
    loadCardBadgeResolver(db, ids),
    loadTrustBadgeFieldResolver(db, ids),
  ])
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    pricePerParticipantRupees: Math.floor(Number(row.pricePerPerson_1_2)),
    shortDescription: row.shortDescription,
    regionSlug: row.regionSlug,
    activitySlug: row.activitySlug,
    difficulty: row.difficulty,
    ...resolveBadges(row.id),
    ...resolveTrust(row.id),
  }))
}

/**
 * Load published Experiences for a single activity across ALL regions.
 * Returns null when the slug is not a registered activity.
 */
export async function loadActivityLanding(
  db: DBOrTx,
  activitySlug: string,
  options?: { topN?: number },
): Promise<ActivityLandingData | null> {
  if (!isActivitySlug(activitySlug)) return null
  const activity = getActivity(activitySlug)
  if (!activity) return null

  const limit = Math.max(1, options?.topN ?? DEFAULT_TOP_N)

  const rows = await db
    .select({
      id: experiences.id,
      slug: experiences.slug,
      title: experiences.title,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      shortDescription: experiences.shortDescription,
      regionSlug: experiences.regionSlug,
      activitySlug: experiences.activitySlug,
      difficulty: experiences.difficulty,
    })
    .from(experiences)
    .where(
      and(
        eq(experiences.activitySlug, activitySlug),
        publiclyVisibleExperienceCondition(),
      ),
    )
    .orderBy(desc(experiences.createdAt))
    .limit(limit)

  return {
    activity,
    experiences: await toLandingExperiences(db, rows),
  }
}

/**
 * Load published Experiences for every activity in a category.
 * Returns null when the category is invalid or has no activities (e.g. urban).
 */
export async function loadCategoryLanding(
  db: DBOrTx,
  categorySlug: string,
  options?: { topN?: number },
): Promise<CategoryLandingData | null> {
  if (!isCategorySlug(categorySlug)) return null

  const activities = listActivities().filter((a) => a.category === categorySlug)
  if (activities.length === 0) return null

  const limit = Math.max(1, options?.topN ?? DEFAULT_TOP_N)
  const activitySlugs = activities.map((a) => a.slug)

  const rows = await db
    .select({
      id: experiences.id,
      slug: experiences.slug,
      title: experiences.title,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      shortDescription: experiences.shortDescription,
      regionSlug: experiences.regionSlug,
      activitySlug: experiences.activitySlug,
      difficulty: experiences.difficulty,
    })
    .from(experiences)
    .where(
      and(
        inArray(experiences.activitySlug, activitySlugs),
        publiclyVisibleExperienceCondition(),
      ),
    )
    .orderBy(desc(experiences.createdAt))
    .limit(limit)

  return {
    category: categorySlug,
    activities,
    experiences: await toLandingExperiences(db, rows),
  }
}
