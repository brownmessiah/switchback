/**
 * Collaborative itinerary slots (ADR-0009). A slot plans either a real
 * PUBLISHED Experience (Experience-ID grounding, mirroring ADR-0010 — a slot's
 * experience_id must resolve to a published Experience, never a draft/archived/
 * missing one) or a free-text plan. Conflict resolution is last-write-wins per
 * slot (no operational-transform in v1); every write stamps updatedByUserId.
 *
 * Membership/permission is enforced by the Server Action layer (only members
 * co-edit); these domain functions are permission-agnostic + PGlite-testable.
 */

import { asc, eq, sql } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'
import { tripGroupItinerarySlots } from '@/db/schema/trip-groups'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import { TripGroupError } from './errors'

function sqlNow() {
  return sql`now()`
}

export interface SlotContentInput {
  experienceId?: string | null
  freeText?: string | null
}

async function assertGrounded(db: DBOrTx, input: SlotContentInput): Promise<void> {
  const hasExperience = Boolean(input.experienceId)
  const hasFreeText = Boolean(input.freeText && input.freeText.trim())
  if (!hasExperience && !hasFreeText) {
    throw new TripGroupError(
      'INVALID_INPUT',
      'an itinerary slot needs an experience_id or free_text',
    )
  }
  if (input.experienceId) {
    const [exp] = await db
      .select({ status: experiences.status })
      .from(experiences)
      .where(eq(experiences.id, input.experienceId))
      .limit(1)
    if (!exp || exp.status !== 'published') {
      throw new TripGroupError(
        'EXPERIENCE_NOT_GROUNDED',
        `experience ${input.experienceId} is not a published Experience`,
      )
    }
  }
}

export async function addItinerarySlot(
  db: DBOrTx,
  args: {
    groupId: string
    dayOffset: number
    timeBand: string
    experienceId?: string | null
    freeText?: string | null
    sortOrder?: number
    userId: string
  },
): Promise<{ id: string }> {
  await assertGrounded(db, args)
  const [slot] = await db
    .insert(tripGroupItinerarySlots)
    .values({
      tripGroupId: args.groupId,
      dayOffset: args.dayOffset,
      timeBand: args.timeBand,
      experienceId: args.experienceId ?? null,
      freeText: args.freeText ?? null,
      sortOrder: args.sortOrder ?? 0,
      updatedByUserId: args.userId,
    })
    .returning({ id: tripGroupItinerarySlots.id })
  if (!slot) throw new Error('itinerary slot insert returned no row (unreachable)')
  return { id: slot.id }
}

/**
 * Last-write-wins overwrite of a slot's content. Whatever this writer submits
 * replaces the slot's plan; updatedByUserId records the winner.
 */
export async function updateItinerarySlot(
  db: DBOrTx,
  args: {
    slotId: string
    dayOffset?: number
    timeBand?: string
    experienceId?: string | null
    freeText?: string | null
    sortOrder?: number
    userId: string
  },
): Promise<void> {
  const [existing] = await db
    .select({
      experienceId: tripGroupItinerarySlots.experienceId,
      freeText: tripGroupItinerarySlots.freeText,
    })
    .from(tripGroupItinerarySlots)
    .where(eq(tripGroupItinerarySlots.id, args.slotId))
    .limit(1)
  if (!existing) {
    throw new TripGroupError('NOT_FOUND', `itinerary slot ${args.slotId} not found`)
  }

  // Resolve the post-write content to validate grounding (LWW: provided values
  // win, otherwise keep existing).
  const nextExperienceId =
    args.experienceId !== undefined ? args.experienceId : existing.experienceId
  const nextFreeText = args.freeText !== undefined ? args.freeText : existing.freeText
  await assertGrounded(db, { experienceId: nextExperienceId, freeText: nextFreeText })

  await db
    .update(tripGroupItinerarySlots)
    .set({
      ...(args.dayOffset !== undefined ? { dayOffset: args.dayOffset } : {}),
      ...(args.timeBand !== undefined ? { timeBand: args.timeBand } : {}),
      ...(args.experienceId !== undefined ? { experienceId: args.experienceId } : {}),
      ...(args.freeText !== undefined ? { freeText: args.freeText } : {}),
      ...(args.sortOrder !== undefined ? { sortOrder: args.sortOrder } : {}),
      updatedByUserId: args.userId,
      updatedAt: sqlNow(),
    })
    .where(eq(tripGroupItinerarySlots.id, args.slotId))
}

export async function deleteItinerarySlot(
  db: DBOrTx,
  slotId: string,
): Promise<void> {
  await db
    .delete(tripGroupItinerarySlots)
    .where(eq(tripGroupItinerarySlots.id, slotId))
}

export interface ItinerarySlotView {
  id: string
  dayOffset: number
  timeBand: string
  experienceId: string | null
  freeText: string | null
  sortOrder: number
  updatedByUserId: string | null
}

export async function listItinerary(
  db: DBOrTx,
  groupId: string,
): Promise<ItinerarySlotView[]> {
  return db
    .select({
      id: tripGroupItinerarySlots.id,
      dayOffset: tripGroupItinerarySlots.dayOffset,
      timeBand: tripGroupItinerarySlots.timeBand,
      experienceId: tripGroupItinerarySlots.experienceId,
      freeText: tripGroupItinerarySlots.freeText,
      sortOrder: tripGroupItinerarySlots.sortOrder,
      updatedByUserId: tripGroupItinerarySlots.updatedByUserId,
    })
    .from(tripGroupItinerarySlots)
    .where(eq(tripGroupItinerarySlots.tripGroupId, groupId))
    .orderBy(
      asc(tripGroupItinerarySlots.dayOffset),
      asc(tripGroupItinerarySlots.sortOrder),
    )
}
