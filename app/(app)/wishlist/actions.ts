'use server'

import { headers } from 'next/headers'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { toggleWishlist } from '@/lib/wishlist/wishlist'

/**
 * Customer wishlist toggle Server Action (Issue #08).
 *
 * Mirrors the auth + pure-core split used by the cancel action
 * (app/(app)/bookings/[id]/cancel/actions.ts): this action only resolves
 * the session and defers the read-modify-write to the pure `toggleWishlist`
 * core (exercised directly with PGlite in lib/wishlist/wishlist.test.ts).
 *
 * Returns a discriminated result so the client can branch without
 * try/catch: an `unauthenticated` result tells the WishlistButton to route
 * the Customer to /sign-in.
 */
export type ToggleWishlistActionResult =
  | { ok: true; saved: boolean }
  | { ok: false; error: 'unauthenticated' }

export async function toggleWishlistAction(
  experienceId: string,
): Promise<ToggleWishlistActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'unauthenticated' }
  }

  const { saved } = await toggleWishlist(db, session.user.id, experienceId)
  return { ok: true, saved }
}
