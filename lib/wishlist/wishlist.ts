import { and, eq, inArray } from 'drizzle-orm'

import { customerProfiles } from '@/db/schema/customer-profiles'
import { experiences } from '@/db/schema/experiences'

import { loadCardBadgeResolver } from '@/lib/experiences/card-badges'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Customer wishlist pure core (Issue #08).
 *
 * The store is `customer_profiles.wishlist` — a jsonb array of Experience
 * UUIDs (the column already exists; no migration). This module is the
 * single home for the toggle + resolve logic so the Server Action stays a
 * thin auth wrapper (mirroring the cancel-action split) and the test suite
 * exercises the DB-touching logic directly with a PGlite handle.
 *
 * Invariants:
 *   - toggleWishlist is idempotent and never throws on a stale id during
 *     removal; it only ADDS an id that resolves to a PUBLISHED Experience
 *     (validate-before-add), so a stale/archived id can be removed but
 *     never re-added.
 *   - getWishlistExperiences resolves stored ids to PUBLISHED rows only,
 *     dropping archived/missing ids.
 */

/** ExperienceCardData-shaped subset returned for wishlist tiles. */
export interface WishlistExperience {
  id: string
  slug: string
  title: string
  shortDescription: string | null
  pricePerParticipantRupees: number
  regionSlug: string
  activitySlug: string
  difficulty: 'easy' | 'moderate' | 'challenging' | 'extreme' | null
  ratingAvg: number | null
  ratingCount: number
  highlight: 'bestseller' | 'top_rated' | null
}

export interface ToggleWishlistResult {
  saved: boolean
  wishlist: string[]
}

/**
 * Read the raw stored wishlist id array for a Customer. Returns `[]` for an
 * unknown user (no `customer_profiles` row).
 */
export async function getWishlistIds(db: DBOrTx, userId: string): Promise<string[]> {
  const [row] = await db
    .select({ wishlist: customerProfiles.wishlist })
    .from(customerProfiles)
    .where(eq(customerProfiles.userId, userId))
    .limit(1)

  if (!row) return []
  // jsonb is typed `unknown` at the Drizzle layer — narrow to a string[].
  const stored = row.wishlist
  if (!Array.isArray(stored)) return []
  return stored.filter((id): id is string => typeof id === 'string')
}

/** Whether a given Experience id is currently in the Customer's wishlist. */
export async function isInWishlist(
  db: DBOrTx,
  userId: string,
  experienceId: string,
): Promise<boolean> {
  const ids = await getWishlistIds(db, userId)
  return ids.includes(experienceId)
}

/**
 * Toggle a single Experience id in the Customer's wishlist.
 *
 * If the id is already present it is removed (saved=false). If absent, it is
 * added (saved=true) ONLY when it resolves to a PUBLISHED Experience —
 * toggling an archived/missing id is a no-op add (saved=false) so we never
 * persist an un-resolvable id. Removal of a stale id always succeeds and
 * never throws.
 *
 * Runs the read-modify-write in a transaction so concurrent toggles for the
 * same Customer serialise on the row.
 */
export async function toggleWishlist(
  db: DBOrTx,
  userId: string,
  experienceId: string,
): Promise<ToggleWishlistResult> {
  return db.transaction(async (tx) => {
    const current = await getWishlistIds(tx, userId)
    const present = current.includes(experienceId)

    let next: string[]
    let saved: boolean

    if (present) {
      // Removal always succeeds — even for a stale/archived/missing id.
      next = current.filter((id) => id !== experienceId)
      saved = false
    } else {
      // Validate-before-add: only persist ids that resolve to a PUBLISHED
      // Experience. A non-published id is silently not added.
      const [exp] = await tx
        .select({ id: experiences.id })
        .from(experiences)
        .where(
          and(eq(experiences.id, experienceId), eq(experiences.status, 'published')),
        )
        .limit(1)

      if (exp) {
        next = [...current, experienceId]
        saved = true
      } else {
        next = current
        saved = false
      }
    }

    // Upsert the profile so an unknown-but-authenticated Customer (no profile
    // row yet) still gets a wishlist persisted.
    await tx
      .insert(customerProfiles)
      .values({ userId, wishlist: next })
      .onConflictDoUpdate({
        target: customerProfiles.userId,
        set: { wishlist: next, updatedAt: new Date() },
      })

    return { saved, wishlist: next }
  })
}

/**
 * Resolve the Customer's stored wishlist ids to their saved PUBLISHED
 * Experiences, shaped as ExperienceCardData. Archived/missing ids are
 * dropped. Order follows the stored wishlist array (most-recently-added
 * last), so the page can render newest-first if it chooses.
 */
export async function getWishlistExperiences(
  db: DBOrTx,
  userId: string,
): Promise<WishlistExperience[]> {
  const ids = await getWishlistIds(db, userId)
  if (ids.length === 0) return []

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
    .where(and(inArray(experiences.id, ids), eq(experiences.status, 'published')))

  const resolveBadges = await loadCardBadgeResolver(
    db,
    rows.map((r) => r.id),
  )

  // Index resolved rows by id, then re-order to match the stored wishlist so
  // a saved-but-unresolvable id is simply absent (dropped).
  const byId = new Map(rows.map((r) => [r.id, r]))

  return ids
    .map((id) => byId.get(id))
    .filter((r): r is (typeof rows)[number] => r !== undefined)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      shortDescription: r.shortDescription,
      pricePerParticipantRupees: Math.floor(Number(r.pricePerPerson_1_2)),
      regionSlug: r.regionSlug,
      activitySlug: r.activitySlug,
      difficulty: r.difficulty,
      ...resolveBadges(r.id),
    }))
}
