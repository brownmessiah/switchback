/**
 * Booking linkage (ADR-0009). The group NEVER books on a member's behalf —
 * each member makes a regular Booking (via the existing booking-create path)
 * carrying `bookings.trip_group_id`. This module only:
 *   - validates that a member MAY tag a Booking to a group (active member; the
 *     group is in a bookable phase; the Experience is in the agreed itinerary), and
 *   - reads per-slot booking progress.
 *
 * Payment / refund / KYC / liability isolation is structural: one member's
 * Booking row is independent; cancelling or failing one never touches another.
 */

import { and, eq, inArray } from 'drizzle-orm'

import { bookings } from '@/db/schema/bookings'
import {
  tripGroupItinerarySlots,
  tripGroupMembers,
  tripGroups,
} from '@/db/schema/trip-groups'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import { TripGroupError } from './errors'

/** Phases in which a member may book an itinerary seat. */
const BOOKABLE_GROUP_STATUSES = ['booking', 'traveling'] as const

/** Booking states that count as "this member has a live seat" on a slot. */
const ACTIVE_BOOKING_STATES = [
  'pending_payment',
  'confirmed',
  'awaiting_completion',
  'completed',
] as const

/**
 * Guard the checkout path: throws unless `userId` is an ACTIVE member of a
 * group that is open for booking, and `experienceId` is part of the group's
 * locked itinerary. On success the caller passes `trip_group_id` to
 * createBooking — this module does not create the Booking itself.
 */
export async function assertCanBookForGroup(
  db: DBOrTx,
  args: { groupId: string; userId: string; experienceId: string },
): Promise<void> {
  const [group] = await db
    .select({ status: tripGroups.status })
    .from(tripGroups)
    .where(eq(tripGroups.id, args.groupId))
    .limit(1)
  if (!group) {
    throw new TripGroupError('NOT_FOUND', `trip group ${args.groupId} not found`)
  }

  const [member] = await db
    .select({ status: tripGroupMembers.status })
    .from(tripGroupMembers)
    .where(
      and(
        eq(tripGroupMembers.tripGroupId, args.groupId),
        eq(tripGroupMembers.userId, args.userId),
      ),
    )
    .limit(1)
  if (!member || member.status !== 'active') {
    throw new TripGroupError('NOT_MEMBER', `user ${args.userId} is not an active member`)
  }

  if (!BOOKABLE_GROUP_STATUSES.includes(group.status as never)) {
    throw new TripGroupError(
      'INVALID_TRANSITION',
      `group ${args.groupId} is not open for booking (status ${group.status})`,
    )
  }

  const [slot] = await db
    .select({ id: tripGroupItinerarySlots.id })
    .from(tripGroupItinerarySlots)
    .where(
      and(
        eq(tripGroupItinerarySlots.tripGroupId, args.groupId),
        eq(tripGroupItinerarySlots.experienceId, args.experienceId),
      ),
    )
    .limit(1)
  if (!slot) {
    throw new TripGroupError(
      'EXPERIENCE_NOT_GROUNDED',
      `experience ${args.experienceId} is not in group ${args.groupId}'s itinerary`,
    )
  }
}

export interface SlotBookingProgress {
  slotId: string
  experienceId: string
  bookedByUserIds: string[]
}

/**
 * For every itinerary slot grounded on a real Experience, which members hold a
 * live Booking (tagged with this group) on that Experience. Cancelled /
 * no-show Bookings are excluded — isolation means a member's cancellation
 * simply drops them from the slot's booked list, affecting no one else.
 */
export async function getSlotBookingProgress(
  db: DBOrTx,
  groupId: string,
): Promise<SlotBookingProgress[]> {
  const slots = await db
    .select({
      id: tripGroupItinerarySlots.id,
      experienceId: tripGroupItinerarySlots.experienceId,
    })
    .from(tripGroupItinerarySlots)
    .where(eq(tripGroupItinerarySlots.tripGroupId, groupId))

  const grounded = slots.filter(
    (s): s is { id: string; experienceId: string } => s.experienceId != null,
  )
  if (grounded.length === 0) return []

  const groupBookings = await db
    .select({
      experienceId: bookings.experienceId,
      customerUserId: bookings.customerUserId,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.tripGroupId, groupId),
        inArray(bookings.state, ACTIVE_BOOKING_STATES),
      ),
    )

  const byExperience = new Map<string, string[]>()
  for (const b of groupBookings) {
    const list = byExperience.get(b.experienceId) ?? []
    if (!list.includes(b.customerUserId)) list.push(b.customerUserId)
    byExperience.set(b.experienceId, list)
  }

  return grounded.map((s) => ({
    slotId: s.id,
    experienceId: s.experienceId,
    bookedByUserIds: byExperience.get(s.experienceId) ?? [],
  }))
}
