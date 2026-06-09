import { desc, sql } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'

import { loadCardBadgeResolver } from '@/lib/experiences/card-badges'
import { publiclyVisibleExperienceCondition } from '@/lib/experiences/public-filter'
import { loadExperienceCoverMap } from '@/lib/media/experience-images'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { listActivities } from '@/lib/activities/registry'
import { listRegions } from '@/lib/regions/registry'

/**
 * Home-page data loader. Returns the three sections rendered on
 * `/{lng}/page.tsx`:
 *
 *   featuredExperiences — newest published Experiences, capped to N.
 *   featuredDestinations — first N regions from the controlled-vocabulary
 *     registry that have at least one published Experience.
 *   featuredActivities — first N activities from the registry with at
 *     least one published Experience.
 *
 * Empty-state safe: if the DB has no published Experiences, the
 * destination/activity lists fall back to the first N registry entries
 * so the home still has content (the SEO surfaces themselves have
 * empty-state copy per Task 18).
 *
 * The query layer is its own module so the route file is pure
 * presentation — no DB types leak into the JSX.
 */

export interface FeaturedExperience {
  id: string
  slug: string
  title: string
  shortDescription: string | null
  pricePerParticipantRupees: number
  regionSlug: string
  activitySlug: string
  coverImageUrl: string | null
  difficulty: 'easy' | 'moderate' | 'challenging' | 'extreme' | null
  ratingAvg: number | null
  ratingCount: number
  highlight: 'bestseller' | 'top_rated' | null
}

export interface FeaturedDestination {
  slug: string
  displayNameEn: string
  displayNameHi: string
  state: string
  experienceCount: number
}

export interface FeaturedActivity {
  slug: string
  displayNameEn: string
  displayNameHi: string
  category: string
  experienceCount: number
}

export interface HomePageData {
  featuredExperiences: FeaturedExperience[]
  featuredDestinations: FeaturedDestination[]
  featuredActivities: FeaturedActivity[]
}

const FEATURED_EXPERIENCES_LIMIT = 6
const FEATURED_DESTINATIONS_LIMIT = 6
const FEATURED_ACTIVITIES_LIMIT = 6

export async function loadHomePageData(db: DBOrTx): Promise<HomePageData> {
  // Featured Experiences — newest published, capped.
  const expRows = await db
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
    .where(publiclyVisibleExperienceCondition())
    .orderBy(desc(experiences.createdAt))
    .limit(FEATURED_EXPERIENCES_LIMIT)

  const expIds = expRows.map((r) => r.id)
  const [coverMap, resolveBadges] = await Promise.all([
    loadExperienceCoverMap(db, expIds),
    loadCardBadgeResolver(db, expIds),
  ])
  const featuredExperiences: FeaturedExperience[] = expRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    shortDescription: row.shortDescription,
    pricePerParticipantRupees: Math.floor(Number(row.pricePerPerson_1_2)),
    regionSlug: row.regionSlug,
    activitySlug: row.activitySlug,
    coverImageUrl: coverMap.get(row.id) ?? null,
    difficulty: row.difficulty,
    ...resolveBadges(row.id),
  }))

  // Counts by region + activity over published Experiences. Two cheap
  // GROUP BYs — the home is cached at the route level so this only fires
  // on revalidation.
  const regionCounts = await db
    .select({
      regionSlug: experiences.regionSlug,
      count: sql<number>`count(*)::int`,
    })
    .from(experiences)
    .where(publiclyVisibleExperienceCondition())
    .groupBy(experiences.regionSlug)
  const regionCountMap = new Map(regionCounts.map((r) => [r.regionSlug, Number(r.count)]))

  const activityCounts = await db
    .select({
      activitySlug: experiences.activitySlug,
      count: sql<number>`count(*)::int`,
    })
    .from(experiences)
    .where(publiclyVisibleExperienceCondition())
    .groupBy(experiences.activitySlug)
  const activityCountMap = new Map(
    activityCounts.map((r) => [r.activitySlug, Number(r.count)]),
  )

  // Featured destinations: registry order, prefer regions with content,
  // fall back to first-N if nothing is published yet.
  const allRegions = listRegions()
  const populatedRegions = allRegions
    .filter((r) => regionCountMap.has(r.slug))
    .slice(0, FEATURED_DESTINATIONS_LIMIT)
    .map<FeaturedDestination>((r) => ({
      slug: r.slug,
      displayNameEn: r.displayName.en,
      displayNameHi: r.displayName.hi,
      state: r.state,
      experienceCount: regionCountMap.get(r.slug) ?? 0,
    }))
  const featuredDestinations: FeaturedDestination[] = populatedRegions.length
    ? populatedRegions
    : allRegions.slice(0, FEATURED_DESTINATIONS_LIMIT).map((r) => ({
        slug: r.slug,
        displayNameEn: r.displayName.en,
        displayNameHi: r.displayName.hi,
        state: r.state,
        experienceCount: 0,
      }))

  // Featured activities: same shape.
  const allActivities = listActivities()
  const populatedActivities = allActivities
    .filter((a) => activityCountMap.has(a.slug))
    .slice(0, FEATURED_ACTIVITIES_LIMIT)
    .map<FeaturedActivity>((a) => ({
      slug: a.slug,
      displayNameEn: a.displayName.en,
      displayNameHi: a.displayName.hi,
      category: a.category,
      experienceCount: activityCountMap.get(a.slug) ?? 0,
    }))
  const featuredActivities: FeaturedActivity[] = populatedActivities.length
    ? populatedActivities
    : allActivities.slice(0, FEATURED_ACTIVITIES_LIMIT).map((a) => ({
        slug: a.slug,
        displayNameEn: a.displayName.en,
        displayNameHi: a.displayName.hi,
        category: a.category,
        experienceCount: 0,
      }))

  return {
    featuredExperiences,
    featuredDestinations,
    featuredActivities,
  }
}
