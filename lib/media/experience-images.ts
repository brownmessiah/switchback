import { and, asc, eq, inArray } from 'drizzle-orm'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import * as schema from '@/db/schema'
import { mediaAssets } from '@/db/schema/media-assets'
import { getActivityImage } from '@/lib/images'

/**
 * Accept either the top-level db handle, a transaction, or the PGlite test
 * handle — all extend drizzle's PgDatabase base type.
 */
export type DBOrTx = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

/**
 * Resolve the image to show for an Experience: the real per-listing
 * `media_assets` cover when present, otherwise the activity stock photo from
 * `lib/images.ts` (so cards/PDPs are never blank when an Experience has no
 * uploaded media).
 */
export function resolveExperienceCover(
  mediaUrl: string | null | undefined,
  activitySlug: string,
): string {
  return mediaUrl ?? getActivityImage(activitySlug)
}

/**
 * Batch-load the PRIMARY (cover) `media_assets` URL for a set of Experiences,
 * keyed by experience id. Only Experiences that actually HAVE media appear in
 * the map — callers resolve the rest via `resolveExperienceCover`.
 *
 * `media_assets` has no explicit primary/sort-order column, so the cover is
 * the earliest asset by `(created_at, storage_key)` — a stable, deterministic
 * "first uploaded" ordering. One query for the whole page avoids N+1.
 */
export async function loadExperienceCoverMap(
  db: DBOrTx,
  experienceIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (experienceIds.length === 0) return map

  const rows = await db
    .select({
      entityId: mediaAssets.entityId,
      url: mediaAssets.url,
    })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.entityType, 'experience'),
        inArray(mediaAssets.entityId, experienceIds),
      ),
    )
    .orderBy(asc(mediaAssets.createdAt), asc(mediaAssets.storageKey))

  // Rows are globally ordered; the first row seen per entity is its cover.
  for (const r of rows) {
    if (!map.has(r.entityId)) map.set(r.entityId, r.url)
  }
  return map
}

export interface GalleryImage {
  url: string
  altText: string | null
}

/**
 * The three image URLs for the PDP "overview" gallery (1 large + 2 small). Real
 * `media_assets` come first; any missing tile is filled with a DISTINCT activity
 * fallback (variant 0/1/2) so a bare listing shows three different photos rather
 * than one photo cropped three ways.
 */
export function galleryTiles(
  gallery: GalleryImage[],
  activitySlug: string,
): [string, string, string] {
  return [
    gallery[0]?.url ?? getActivityImage(activitySlug, 0),
    gallery[1]?.url ?? getActivityImage(activitySlug, 1),
    gallery[2]?.url ?? getActivityImage(activitySlug, 2),
  ]
}

/**
 * Load the ordered gallery (cover first) for a single Experience's
 * `media_assets`. Returns `[]` when the Experience has no uploaded media.
 */
export async function loadExperienceGallery(
  db: DBOrTx,
  experienceId: string,
): Promise<GalleryImage[]> {
  return db
    .select({ url: mediaAssets.url, altText: mediaAssets.altText })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.entityType, 'experience'),
        eq(mediaAssets.entityId, experienceId),
      ),
    )
    .orderBy(asc(mediaAssets.createdAt), asc(mediaAssets.storageKey))
}
