import { and, eq, notInArray, type SQL } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'

import { FIXTURE_EXPERIENCE_SLUGS, isFixtureExperienceSlug } from './fixture-slugs'

/**
 * Single source of truth for "publicly visible Experience".
 *
 * An Experience is publicly visible on a human-facing surface iff it is
 * `published` AND its slug is not an admin/E2E fixture (lib/experiences/
 * fixture-slugs.ts). This is the union of the two gates that, taken
 * together, keep draft / pending_review / paused / archived listings AND
 * the published-but-fixture rows (the refund-queue / payout-queue /
 * commission-scope / review-moderation fixtures) off every public list:
 * homepage rails, /search, destination + activity landings, the
 * activity-city collections, vendor storefronts, the sitemap, and search
 * indexing.
 *
 * Per RECONCILIATION §1E this lives in the `experience_status` enum + the
 * fixture-slug list — NOT in a new isPublished/isApproved/isTest boolean
 * column (that approach is explicitly REJECTED). Route EVERY public
 * list-query through this module so the rule has exactly one definition.
 *
 * The module serves both query styles:
 *   - `publiclyVisibleExperienceCondition()` — a Drizzle WHERE condition for
 *     DB queries (compose with `and(...)` alongside region/activity filters).
 *   - `isPubliclyVisibleExperience({ status, slug })` — an in-memory predicate
 *     for post-fetch array filtering / Meilisearch result filtering.
 */

/** The five Experience lifecycle states (db/schema/experiences.ts). */
export type ExperienceStatus =
  | 'draft'
  | 'pending_review'
  | 'published'
  | 'paused'
  | 'archived'

/** The status that makes an Experience eligible for public surfaces. */
const PUBLIC_STATUS: ExperienceStatus = 'published'

/**
 * In-memory predicate: true iff the Experience may appear on a human-facing
 * surface — `published` AND not a fixture slug. Use for post-fetch array
 * filtering and Meilisearch result filtering (where a SQL WHERE is not
 * available).
 */
export function isPubliclyVisibleExperience(experience: {
  status: ExperienceStatus
  slug: string
}): boolean {
  return experience.status === PUBLIC_STATUS && !isFixtureExperienceSlug(experience.slug)
}

/**
 * Drizzle WHERE condition: `status = 'published' AND slug NOT IN (fixtures)`.
 * Compose with other predicates via `and(...)`:
 *
 *   .where(and(eq(experiences.regionSlug, slug), publiclyVisibleExperienceCondition()))
 *
 * Always non-null (both gates are always present), so it is safe to use as
 * the sole `.where(...)` argument too.
 */
export function publiclyVisibleExperienceCondition(): SQL {
  return and(
    eq(experiences.status, PUBLIC_STATUS),
    notInArray(experiences.slug, FIXTURE_EXPERIENCE_SLUGS),
  ) as SQL
}
