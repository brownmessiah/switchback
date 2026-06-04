import { getActivityPhotoIds } from '@/lib/images'

/**
 * Stable 32-bit FNV-1a hash of a string. Used to pick a deterministic rotation
 * offset per listing so the seeds produce a fixed (re-runnable) gallery that
 * still differs from sibling listings of the same activity.
 */
function hashKey(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Deterministic per-listing gallery: the curated activity pool rotated by a
 * hash of `key` (use the listing slug), so the seed is re-runnable AND two
 * same-activity listings get different covers instead of repeating one photo.
 *
 * Returns `count` distinct `photo-…` IDs (the pool has 6). Seeds turn these
 * into Unsplash URLs via `IMG(id, …)`.
 */
export function galleryFor(activitySlug: string, key: string, count = 6): string[] {
  const pool = getActivityPhotoIds(activitySlug)
  if (pool.length === 0) return []
  const start = hashKey(`${activitySlug}:${key}`) % pool.length
  const rotated = pool.slice(start).concat(pool.slice(0, start))
  return rotated.slice(0, Math.min(count, pool.length))
}
