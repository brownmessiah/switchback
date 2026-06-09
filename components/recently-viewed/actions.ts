'use server'

import type { ExperienceCardData } from '@/components/experience-card'
import { db } from '@/db/client'
import { loadRecentlyViewedCards } from '@/lib/recently-viewed/loader'

/**
 * Server Action backing the recently-viewed rail (home / search / PDP).
 *
 * The rail (a client component) reads the visitor's slugs from localStorage and
 * passes them here. This action resolves them to publicly-visible card data via
 * `loadRecentlyViewedCards`, which gates everything through
 * `lib/experiences/public-filter` (no fixture / unpublished leak) and preserves
 * the most-recent-first order. Guest-friendly — no session is read, no write is
 * performed; the slugs are the only input.
 */
export async function loadRecentlyViewedCardsAction(
  slugs: string[],
): Promise<ExperienceCardData[]> {
  return loadRecentlyViewedCards(db, slugs)
}
