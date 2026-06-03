import { asc, eq } from 'drizzle-orm'

import {
  experienceItinerarySteps,
  type ExperienceItineraryStep,
} from '@/db/schema/experience-itinerary-steps'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Vendor-authored, per-Experience structured itinerary (ADR-0017). DISTINCT
 * from the Customer-led `trip_group_itinerary_slots` (ADR-0009) — do not
 * conflate.
 *
 * Both helpers accept a `DBOrTx` so they participate in the caller's
 * transaction. `replaceItinerary` is a delete-then-insert; the Vendor form
 * action and the dev seed wrap it in `db.transaction(...)` for atomicity
 * (same contract as the booking-create / refund-flow write helpers).
 */

/** A single step to write. `stepOrder` is assigned by array index by the loader. */
export interface ItineraryStepInput {
  title: string
  description?: string | null
  dayOffset?: number | null
  durationMinutes?: number | null
}

/**
 * Load the steps of an Experience's itinerary, ordered by `stepOrder` ascending.
 * Returns `[]` when the Experience has no steps.
 */
export async function loadItinerary(
  db: DBOrTx,
  experienceId: string,
): Promise<ExperienceItineraryStep[]> {
  return db
    .select()
    .from(experienceItinerarySteps)
    .where(eq(experienceItinerarySteps.experienceId, experienceId))
    .orderBy(asc(experienceItinerarySteps.stepOrder))
}

/**
 * Idempotently replace an Experience's itinerary: delete every existing step
 * for the Experience, then insert the provided steps with `stepOrder` assigned
 * by array index (0-based). Passing `[]` clears the itinerary.
 *
 * Runs delete + insert sequentially on the provided handle. The caller wraps
 * this in `db.transaction(...)` for atomicity (e.g. the Vendor form action,
 * which also updates the parent `experiences` row in the same tx).
 */
export async function replaceItinerary(
  db: DBOrTx,
  experienceId: string,
  steps: ItineraryStepInput[],
): Promise<void> {
  await db
    .delete(experienceItinerarySteps)
    .where(eq(experienceItinerarySteps.experienceId, experienceId))

  if (steps.length === 0) return

  await db.insert(experienceItinerarySteps).values(
    steps.map((step, index) => ({
      experienceId,
      stepOrder: index,
      title: step.title,
      description: step.description ?? null,
      dayOffset: step.dayOffset ?? null,
      durationMinutes: step.durationMinutes ?? null,
    })),
  )
}
