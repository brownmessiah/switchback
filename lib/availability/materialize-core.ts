import { eq } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import { materializeSlots, type MaterializeResult } from './slot-materializer'

/**
 * Ownership-gated materialize CORE (issue #03 review, FIX 3).
 *
 * db-injected, auth-free, integration-testable. NOT in the `'use server'`
 * module — a core taking an arbitrary `experienceId` without an ownership check
 * would be a cross-vendor write bypass (IDOR). The thin Server Action wrapper in
 * `app/vendor/(dashboard)/listings/[id]/availability/actions.ts` derives the
 * acting Vendor identity from the session, gates `availability:manage`, and
 * delegates here with the GATE-RESOLVED userId (never client input).
 *
 * Mirrors `executeBlockDate`/`executeUnblockDate`: verify the acting user owns
 * the Experience FIRST, then delegate to the pure `materializeSlots`. If the
 * Experience is missing or owned by someone else, NO slots are written.
 */
export type MaterializeActionResult =
  | ({ ok: true } & MaterializeResult)
  | { ok: false; error: string }

export async function executeMaterializeSlots(
  db: DBOrTx,
  userId: string,
  experienceId: string,
  daysForward?: number,
): Promise<MaterializeActionResult> {
  // Ownership pre-check: the acting Vendor must own this Experience.
  const [exp] = await db
    .select({ vendorUserId: experiences.vendorUserId })
    .from(experiences)
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (!exp || exp.vendorUserId !== userId) {
    return { ok: false, error: 'Experience not found or not owned by you.' }
  }

  const result =
    daysForward === undefined
      ? await materializeSlots(db, experienceId)
      : await materializeSlots(db, experienceId, daysForward)

  return { ok: true, ...result }
}
