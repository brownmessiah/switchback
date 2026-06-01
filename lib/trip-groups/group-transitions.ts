/**
 * Host- and system-driven TripGroup lifecycle DB transitions (ADR-0009),
 * each guarded by the pure machine in group-lifecycle.ts:
 *   - lockItinerary   planning  → booking   (host; requires ≥1 itinerary slot)
 *   - markTraveling   booking   → traveling (host)
 *   - markCompleted   traveling → completed (host)
 *   - archiveGroup    any non-terminal → archived (host)
 *   - sweepAutoArchive  the cleanup job: 30d-stale-forming + 60d-post-completed
 */

import { and, eq, lt, or, sql } from 'drizzle-orm'

import { tripGroupItinerarySlots, tripGroups } from '@/db/schema/trip-groups'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import { TripGroupError } from './errors'
import {
  canTransitionGroup,
  POST_COMPLETED_ARCHIVE_DAYS,
  STALE_FORMING_DAYS,
  type TripGroupStatus,
} from './group-lifecycle'

function sqlNow() {
  return sql`now()`
}

async function loadHostGroup(db: DBOrTx, groupId: string, hostUserId: string) {
  const [group] = await db
    .select({ id: tripGroups.id, status: tripGroups.status, hostUserId: tripGroups.hostUserId })
    .from(tripGroups)
    .where(eq(tripGroups.id, groupId))
    .for('update')
    .limit(1)
  if (!group) throw new TripGroupError('NOT_FOUND', `trip group ${groupId} not found`)
  if (group.hostUserId !== hostUserId) {
    throw new TripGroupError('NOT_HOST', `user ${hostUserId} is not the host`)
  }
  return group
}

async function transitionByHost(
  db: DBOrTx,
  groupId: string,
  hostUserId: string,
  to: TripGroupStatus,
): Promise<void> {
  const group = await loadHostGroup(db, groupId, hostUserId)
  if (!canTransitionGroup(group.status, to)) {
    throw new TripGroupError(
      'INVALID_TRANSITION',
      `cannot move group ${groupId} from ${group.status} to ${to}`,
    )
  }
  await db
    .update(tripGroups)
    .set({ status: to, updatedAt: sqlNow() })
    .where(eq(tripGroups.id, groupId))
}

/** Host locks the itinerary: planning → booking. Requires ≥1 itinerary slot. */
export async function lockItinerary(
  db: DBOrTx,
  args: { groupId: string; hostUserId: string },
): Promise<void> {
  const group = await loadHostGroup(db, args.groupId, args.hostUserId)
  if (!canTransitionGroup(group.status, 'booking')) {
    throw new TripGroupError(
      'INVALID_TRANSITION',
      `cannot lock itinerary from ${group.status}`,
    )
  }
  const [slot] = await db
    .select({ id: tripGroupItinerarySlots.id })
    .from(tripGroupItinerarySlots)
    .where(eq(tripGroupItinerarySlots.tripGroupId, args.groupId))
    .limit(1)
  if (!slot) {
    throw new TripGroupError('INVALID_INPUT', 'cannot lock an empty itinerary')
  }
  await db
    .update(tripGroups)
    .set({ status: 'booking', updatedAt: sqlNow() })
    .where(eq(tripGroups.id, args.groupId))
}

export async function markTraveling(
  db: DBOrTx,
  args: { groupId: string; hostUserId: string },
): Promise<void> {
  await transitionByHost(db, args.groupId, args.hostUserId, 'traveling')
}

export async function markCompleted(
  db: DBOrTx,
  args: { groupId: string; hostUserId: string },
): Promise<void> {
  await transitionByHost(db, args.groupId, args.hostUserId, 'completed')
}

export async function archiveGroup(
  db: DBOrTx,
  args: { groupId: string; hostUserId: string },
): Promise<void> {
  await transitionByHost(db, args.groupId, args.hostUserId, 'archived')
}

/**
 * Auto-archive cleanup (cron): groups stuck in `forming` ≥ 30d OR `completed`
 * ≥ 60d. Returns the number archived. Uses `created_at` for the forming clock
 * (never advanced since creation) and `updated_at` for the completed clock
 * (set when the group reached `completed`).
 */
export async function sweepAutoArchive(db: DBOrTx, now: Date): Promise<number> {
  const formingCutoff = new Date(now.getTime() - STALE_FORMING_DAYS * 86_400_000)
  const completedCutoff = new Date(
    now.getTime() - POST_COMPLETED_ARCHIVE_DAYS * 86_400_000,
  )
  const archived = await db
    .update(tripGroups)
    .set({ status: 'archived', updatedAt: sqlNow() })
    .where(
      or(
        and(eq(tripGroups.status, 'forming'), lt(tripGroups.createdAt, formingCutoff)),
        and(eq(tripGroups.status, 'completed'), lt(tripGroups.updatedAt, completedCutoff)),
      ),
    )
    .returning({ id: tripGroups.id })
  return archived.length
}
