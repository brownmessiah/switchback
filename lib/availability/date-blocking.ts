import { and, eq, gte, lt, sql } from 'drizzle-orm'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { experiences } from '@/db/schema/experiences'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

type BlockResult =
  | { ok: true; affected: number }
  | { ok: false; error: string }

/**
 * Verify ownership of an experience.
 */
async function verifyOwnership(
  db: DBOrTx,
  experienceId: string,
  userId: string,
): Promise<string | null> {
  const [exp] = await db
    .select({ id: experiences.id, vendorUserId: experiences.vendorUserId })
    .from(experiences)
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (!exp) return 'Experience not found.'
  if (exp.vendorUserId !== userId) return 'You do not own this experience.'
  return null
}

/**
 * Block a specific date for an experience. Sets all slots on that date
 * to 'closed' status. Does not affect slots that have bookings
 * (capacity_taken > 0) — those remain as-is to preserve booking integrity.
 *
 * @param date - ISO date string "YYYY-MM-DD" in UTC
 */
export async function executeBlockDate(
  db: DBOrTx,
  userId: string,
  experienceId: string,
  date: string,
): Promise<BlockResult> {
  const ownershipError = await verifyOwnership(db, experienceId, userId)
  if (ownershipError) return { ok: false, error: ownershipError }

  const dayStart = new Date(`${date}T00:00:00.000Z`)
  const dayEnd = new Date(`${date}T23:59:59.999Z`)

  const result = await db
    .update(availabilitySlots)
    .set({ status: 'closed', updatedAt: new Date() })
    .where(
      and(
        eq(availabilitySlots.experienceId, experienceId),
        gte(availabilitySlots.startAt, dayStart),
        lt(availabilitySlots.startAt, new Date(dayEnd.getTime() + 1)),
        eq(availabilitySlots.status, 'open'),
      ),
    )
    .returning({ id: availabilitySlots.id })

  return { ok: true, affected: result.length }
}

/**
 * Unblock a specific date for an experience. Sets all 'closed' slots
 * on that date back to 'open' status.
 *
 * @param date - ISO date string "YYYY-MM-DD" in UTC
 */
export async function executeUnblockDate(
  db: DBOrTx,
  userId: string,
  experienceId: string,
  date: string,
): Promise<BlockResult> {
  const ownershipError = await verifyOwnership(db, experienceId, userId)
  if (ownershipError) return { ok: false, error: ownershipError }

  const dayStart = new Date(`${date}T00:00:00.000Z`)
  const dayEnd = new Date(`${date}T23:59:59.999Z`)

  const result = await db
    .update(availabilitySlots)
    .set({ status: 'open', updatedAt: new Date() })
    .where(
      and(
        eq(availabilitySlots.experienceId, experienceId),
        gte(availabilitySlots.startAt, dayStart),
        lt(availabilitySlots.startAt, new Date(dayEnd.getTime() + 1)),
        eq(availabilitySlots.status, 'closed'),
      ),
    )
    .returning({ id: availabilitySlots.id })

  return { ok: true, affected: result.length }
}
