import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import {
  experiencePricingVariations,
  type ExperiencePricingVariation,
} from '@/db/schema/experience-pricing-variations'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Named per-Experience pricing variations write path (ADR-0011 revision
 * 2026-06-16, issue #08). The read + ownership-safe upsert helpers used by the
 * Experience create/edit cores. The money-path resolution lives in
 * `lib/payments/pricing-resolver.ts`; this module only authors the rows.
 *
 * `price_per_person` is numeric(12,2) carried as a STRING — never a JS float.
 *
 * Both helpers accept a `DBOrTx` so they participate in the caller's
 * transaction. `replacePricingVariations` is an ownership-scoped upsert: insert
 * new (no id), update existing (by id AND experienceId — a foreign id is never
 * trusted), delete the rows the form dropped. The caller wraps it in
 * `db.transaction(...)` alongside the parent `experiences` write (same contract
 * as `replaceItinerary`).
 */

/** Per-variation field bounds — shared by the create + edit Zod schemas. */
export const pricingVariationInputSchema = z.object({
  /** Existing-row id (edit). Absent → a new row is inserted. */
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Variation name is required').max(120),
  description: z.string().trim().max(600).nullable().optional(),
  /** numeric(12,2) as a string; a positive amount. */
  pricePerPerson: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Price must be a number')
    .refine((v) => Number(v) > 0, 'Price must be positive'),
  /** Optional per-variation duration override (minutes). */
  durationMinutes: z.number().int().positive().max(43200).nullable().optional(),
  isActive: z.boolean(),
})

export type PricingVariationInput = z.infer<typeof pricingVariationInputSchema>

/** The array schema reused by both action schemas (defaults to empty). */
export const pricingVariationsSchema = z
  .array(pricingVariationInputSchema)
  .max(20, 'At most 20 pricing variations are allowed')

/**
 * Load an Experience's pricing variations, ordered by creation (stable) so the
 * edit form round-trips them in a deterministic order. Returns `[]` when none.
 */
export async function loadPricingVariations(
  db: DBOrTx,
  experienceId: string,
): Promise<ExperiencePricingVariation[]> {
  return db
    .select()
    .from(experiencePricingVariations)
    .where(eq(experiencePricingVariations.experienceId, experienceId))
    .orderBy(asc(experiencePricingVariations.createdAt))
}

/**
 * Ownership-safe replace of an Experience's pricing variations:
 *
 *  - rows with NO id → inserted for this Experience.
 *  - rows WITH an id that ALREADY belongs to this Experience → updated in place.
 *  - rows WITH an id that does NOT belong to this Experience → treated as new
 *    (the foreign id is dropped and a fresh row is inserted) — a client can
 *    never hijack another Experience's variation id.
 *  - existing rows of this Experience NOT present in the input → deleted.
 *
 * Runs delete + update + insert sequentially on the provided handle; the caller
 * owns the transaction.
 */
export async function replacePricingVariations(
  db: DBOrTx,
  experienceId: string,
  variations: ReadonlyArray<PricingVariationInput>,
): Promise<void> {
  // The set of variation ids that genuinely belong to this Experience today.
  const existing = await db
    .select({ id: experiencePricingVariations.id })
    .from(experiencePricingVariations)
    .where(eq(experiencePricingVariations.experienceId, experienceId))
  const ownedIds = new Set(existing.map((r) => r.id))

  // Partition the input. An id is honoured ONLY when it is already owned by
  // this Experience; any other id (foreign / unknown) is discarded and the row
  // is inserted fresh, so a client id is never trusted to target a row.
  const toUpdate = variations.filter((v) => v.id !== undefined && ownedIds.has(v.id))
  const toInsert = variations.filter((v) => v.id === undefined || !ownedIds.has(v.id))
  const keptIds = new Set(toUpdate.map((v) => v.id as string))

  // Delete the owned rows the form dropped (every owned id not kept).
  const removedIds = [...ownedIds].filter((id) => !keptIds.has(id))
  if (removedIds.length > 0) {
    await db
      .delete(experiencePricingVariations)
      .where(
        and(
          eq(experiencePricingVariations.experienceId, experienceId),
          inArray(experiencePricingVariations.id, removedIds),
        ),
      )
  }

  // Update the kept rows in place — scoped to this Experience so the WHERE can
  // never touch a foreign row even if the id set were tampered with.
  for (const v of toUpdate) {
    await db
      .update(experiencePricingVariations)
      .set({
        name: v.name,
        description: v.description ?? null,
        pricePerPerson: v.pricePerPerson,
        durationMinutes: v.durationMinutes ?? null,
        isActive: v.isActive,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(experiencePricingVariations.id, v.id as string),
          eq(experiencePricingVariations.experienceId, experienceId),
        ),
      )
  }

  // Insert the new rows (and any row whose foreign id we discarded).
  if (toInsert.length > 0) {
    await db.insert(experiencePricingVariations).values(
      toInsert.map((v) => ({
        experienceId,
        name: v.name,
        description: v.description ?? null,
        pricePerPerson: v.pricePerPerson,
        durationMinutes: v.durationMinutes ?? null,
        isActive: v.isActive,
      })),
    )
  }
}
