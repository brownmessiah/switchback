/**
 * TripGroup lifecycle state machine (ADR-0009). Pure — no DB. The action
 * functions (membership, itinerary lock, booking linkage, the auto-archive
 * job) consult these guards; mutation lives there.
 *
 *   forming   → planning   (>= MIN_MEMBERS_TO_PLAN active members)
 *   planning  → booking    (host locks the itinerary)
 *   booking   → traveling  (members have booked their seats)
 *   traveling → completed  (all member Bookings reach Completion, ADR-0003)
 *   * (non-terminal) → archived  (host-initiated, or the auto-archive job:
 *                                 30d stale in forming / 60d after completed)
 */

import { tripGroupStatusEnum } from '@/db/schema/trip-groups'

export type TripGroupStatus = (typeof tripGroupStatusEnum.enumValues)[number]

export const TRIP_GROUP_STATES: readonly TripGroupStatus[] =
  tripGroupStatusEnum.enumValues

/** Minimum ACTIVE members before a group can leave `forming`. */
export const MIN_MEMBERS_TO_PLAN = 2
/** A group that never leaves `forming` for this many days is auto-archived. */
export const STALE_FORMING_DAYS = 30
/** A `completed` group is archived this many days after completion. */
export const POST_COMPLETED_ARCHIVE_DAYS = 60

export const TRIP_GROUP_TRANSITIONS: Record<
  TripGroupStatus,
  readonly TripGroupStatus[]
> = {
  forming: ['planning', 'archived'],
  planning: ['booking', 'archived'],
  booking: ['traveling', 'archived'],
  traveling: ['completed', 'archived'],
  completed: ['archived'],
  archived: [],
}

export function canTransitionGroup(
  from: TripGroupStatus,
  to: TripGroupStatus,
): boolean {
  return TRIP_GROUP_TRANSITIONS[from].includes(to)
}

export function isTerminalGroupState(status: TripGroupStatus): boolean {
  return TRIP_GROUP_TRANSITIONS[status].length === 0
}

/** A group may advance out of `forming` once enough members are active. */
export function canAdvanceToPlanning(activeMemberCount: number): boolean {
  return activeMemberCount >= MIN_MEMBERS_TO_PLAN
}

function daysBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000)
}

/** True if a still-`forming` group has been stale ≥ STALE_FORMING_DAYS. */
export function isStaleForming(
  status: TripGroupStatus,
  createdAt: Date,
  now: Date,
): boolean {
  return status === 'forming' && daysBetween(createdAt, now) >= STALE_FORMING_DAYS
}

/** True if a `completed` group is past the POST_COMPLETED_ARCHIVE_DAYS window. */
export function isArchivableAfterCompletion(
  status: TripGroupStatus,
  completedAt: Date,
  now: Date,
): boolean {
  return (
    status === 'completed' &&
    daysBetween(completedAt, now) >= POST_COMPLETED_ARCHIVE_DAYS
  )
}
