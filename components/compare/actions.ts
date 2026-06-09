'use server'

import { db } from '@/db/client'
import { buildComparisonDataset, type ComparisonRow } from '@/lib/compare/dataset'

/**
 * Server Action backing the dedicated `/compare` page (DECISION D10).
 *
 * The compare view (a client component) reads the visitor's compare-selected
 * slugs from localStorage and passes them here. This action resolves them to
 * comparison rows via `buildComparisonDataset`, which gates everything through
 * `lib/experiences/public-filter` (no fixture / unpublished leak) and preserves
 * the visitor's selection order. Guest-friendly — no session is read, no write
 * is performed; the slugs are the only input.
 */
export async function loadComparisonDatasetAction(
  slugs: string[],
): Promise<ComparisonRow[]> {
  return buildComparisonDataset(db, slugs)
}
