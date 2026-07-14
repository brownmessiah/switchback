import { eq } from 'drizzle-orm'

import { availabilityPatterns } from '@/db/schema/availability-patterns'
import { experiences } from '@/db/schema/experiences'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import { materializeSlots } from './slot-materializer'

/**
 * Rolling slot-materialization sweep (ADR-0020 launch dependency).
 *
 * Date-availability search only surfaces Experiences whose slots are
 * MATERIALIZED; `materializeSlots` previously ran only on vendor actions
 * and seeds, so a quiet listing's window silently shrank. This sweep runs
 * from the daily cron (app/api/cron/materialize-slots) over every
 * PUBLISHED Experience that has at least one recurring pattern, extending
 * concrete slots `daysForward` (default 90) into the future. Fully
 * idempotent — materializeSlots inserts ON CONFLICT DO NOTHING and never
 * touches existing slots (including booked ones).
 */

export interface MaterializeAllResult {
  experiencesSwept: number
  created: number
  skipped: number
  /** Experiences whose materialization threw — logged, never sweep-fatal. */
  failed: number
}

export async function materializeAllSlots(
  db: DBOrTx,
  daysForward: number = 90,
): Promise<MaterializeAllResult> {
  // Published experiences with at least one pattern — everything else has
  // nothing to materialize.
  const targets = await db
    .selectDistinct({ id: experiences.id })
    .from(experiences)
    .innerJoin(
      availabilityPatterns,
      eq(availabilityPatterns.experienceId, experiences.id),
    )
    .where(eq(experiences.status, 'published'))

  let created = 0
  let skipped = 0
  let failed = 0
  for (const target of targets) {
    try {
      const result = await materializeSlots(db, target.id, daysForward)
      created += result.created
      skipped += result.skipped
    } catch (err) {
      // One malformed pattern must not re-create the shrinking-window bug
      // for every experience after it — log, count, continue.
      failed += 1
      console.error('[materialize-slots] sweep failed for experience', target.id, err)
    }
  }

  return { experiencesSwept: targets.length, created, skipped, failed }
}
