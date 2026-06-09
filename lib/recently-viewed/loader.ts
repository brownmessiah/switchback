import { and, inArray } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'
import type { ExperienceCardData } from '@/components/experience-card'
import { enrichCardBadges } from '@/lib/experiences/card-badges'
import { publiclyVisibleExperienceCondition } from '@/lib/experiences/public-filter'
import { loadExperienceCoverMap } from '@/lib/media/experience-images'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Server loader for the recently-viewed rail.
 *
 * The input `slugs` come from the visitor's localStorage (most-recent-first)
 * and are therefore UNTRUSTED — a slug may be stale (now draft / paused /
 * archived), may be an admin/E2E fixture, or may not exist at all. This loader
 * is the gate: it fetches only the slugs that are publicly visible
 * (`publiclyVisibleExperienceCondition` — `status='published'` AND non-fixture,
 * the single source of truth in `lib/experiences/public-filter`), so the rail
 * can NEVER surface a fixture / unpublished listing even with a stale slug in
 * storage (guardrail D0).
 *
 * The DB returns rows in arbitrary order; we re-sort to match the caller's
 * recency order so the rail reads newest-first. Cards are enriched with the
 * shared rating / social-proof / trust-badge fields (`enrichCardBadges`) so the
 * rail's tiles are identical to the home / search grids.
 */

/** Default number of cards the rail renders (a single row at desktop widths). */
export const RECENTLY_VIEWED_RAIL_MAX = 8

export async function loadRecentlyViewedCards(
  db: DBOrTx,
  slugs: readonly string[],
  maxItems: number = RECENTLY_VIEWED_RAIL_MAX,
): Promise<ExperienceCardData[]> {
  if (slugs.length === 0) return []

  // De-dupe defensively (storage already dedupes, but the loader must not
  // double-render if a malformed list slips a repeat through) while keeping the
  // first (most-recent) occurrence's position.
  const orderedSlugs = slugs.filter((slug, i) => slugs.indexOf(slug) === i)

  const rows = await db
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
    .where(
      and(
        inArray(experiences.slug, [...orderedSlugs]),
        publiclyVisibleExperienceCondition(),
      ),
    )

  if (rows.length === 0) return []

  const coverMap = await loadExperienceCoverMap(
    db,
    rows.map((r) => r.id),
  )

  const cardsBySlug = new Map<string, ExperienceCardData>(
    rows.map((row) => [
      row.slug,
      {
        id: row.id,
        slug: row.slug,
        title: row.title,
        shortDescription: row.shortDescription,
        pricePerParticipantRupees: Math.floor(Number(row.pricePerPerson_1_2)),
        regionSlug: row.regionSlug,
        activitySlug: row.activitySlug,
        coverImageUrl: coverMap.get(row.id) ?? null,
        difficulty: row.difficulty,
      },
    ]),
  )

  // Re-order to match the visitor's recency order (most-recent-first), drop
  // slugs that did not resolve (stale / gated), then cap to the rail size.
  const ordered = orderedSlugs
    .map((slug) => cardsBySlug.get(slug))
    .filter((card): card is ExperienceCardData => card !== undefined)
    .slice(0, maxItems)

  return enrichCardBadges(db, ordered)
}
