'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'
import { TripGroupError } from '@/lib/trip-groups/errors'
import { createTripGroup } from '@/lib/trip-groups/groups'
import { addItinerarySlot, deleteItinerarySlot } from '@/lib/trip-groups/itinerary'
import { lockItinerary } from '@/lib/trip-groups/group-transitions'
import {
  approveJoinRequest,
  declineJoinRequest,
  leaveGroup,
  removeMember,
  requestToJoin,
} from '@/lib/trip-groups/membership'

export type ActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string }

function mapError(err: unknown): string {
  if (err instanceof TripGroupError) {
    switch (err.code) {
      case 'NOT_FOUND':
        return 'That trip group no longer exists.'
      case 'INVALID_INPUT':
        return err.message
      case 'NOT_HOST':
        return 'Only the host can do that.'
      case 'NOT_MEMBER':
        return 'You are not a member of this group.'
      case 'ALREADY_MEMBER':
        return 'You are already in this group.'
      case 'CAPACITY_FULL':
        return 'This group is full.'
      case 'NOT_JOINABLE':
        return 'This group is no longer open to join.'
      case 'INVITE_REQUIRED':
        return 'This group is invite-only.'
      case 'ELIGIBILITY_DENIED':
        return 'This group is open to Aadhaar-verified women only.'
      case 'HOST_MUST_TRANSFER':
        return 'Transfer the group to another member before leaving.'
      case 'NOT_ACTIVE_MEMBER':
        return 'That person must be an active member first.'
      case 'NO_PENDING_REQUEST':
        return 'There is no pending request for that person.'
      case 'EXPERIENCE_NOT_GROUNDED':
        return 'Pick a published Experience for this slot.'
      case 'INVALID_TRANSITION':
        return 'That action is not allowed for the group right now.'
      default:
        return 'Something went wrong.'
    }
  }
  return 'Something went wrong.'
}

async function requireUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user?.id ?? null
}

const createSchema = z.object({
  name: z.string().trim().min(1, 'A group name is required.').max(120),
  destinationSlugs: z.array(z.string()).max(10).optional(),
  interestTags: z.array(z.string()).max(10).optional(),
  targetDateWindowStart: z.string().optional(),
  targetDateWindowEnd: z.string().optional(),
  visibility: z.enum(['private', 'public_all', 'public_women_only']).optional(),
  membershipRule: z.enum(['auto_accept', 'host_approval']).optional(),
  maxMembers: z.number().int().min(2).max(12),
})

export async function createGroupAction(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ groupId: string }>> {
  const userId = await requireUserId()
  if (!userId) return { ok: false, error: 'Sign in to create a group.' }
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  try {
    const { id } = await prodDb.transaction((tx) =>
      createTripGroup(tx, { hostUserId: userId, ...parsed.data }),
    )
    revalidatePath('/community')
    return { ok: true, groupId: id }
  } catch (err) {
    return { ok: false, error: mapError(err) }
  }
}

export async function joinGroupAction(groupId: string): Promise<ActionResult> {
  const userId = await requireUserId()
  if (!userId) return { ok: false, error: 'Sign in to join.' }
  try {
    await prodDb.transaction((tx) => requestToJoin(tx, { groupId, userId }))
    revalidatePath(`/community/${groupId}`)
    revalidatePath('/community')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: mapError(err) }
  }
}

export async function leaveGroupAction(groupId: string): Promise<ActionResult> {
  const userId = await requireUserId()
  if (!userId) return { ok: false, error: 'Sign in.' }
  try {
    await prodDb.transaction((tx) => leaveGroup(tx, { groupId, userId }))
    revalidatePath(`/community/${groupId}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: mapError(err) }
  }
}

export async function approveMemberAction(
  groupId: string,
  memberUserId: string,
): Promise<ActionResult> {
  const hostUserId = await requireUserId()
  if (!hostUserId) return { ok: false, error: 'Sign in.' }
  try {
    await prodDb.transaction((tx) =>
      approveJoinRequest(tx, { groupId, hostUserId, memberUserId }),
    )
    revalidatePath(`/community/${groupId}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: mapError(err) }
  }
}

export async function declineMemberAction(
  groupId: string,
  memberUserId: string,
): Promise<ActionResult> {
  const hostUserId = await requireUserId()
  if (!hostUserId) return { ok: false, error: 'Sign in.' }
  try {
    await prodDb.transaction((tx) =>
      declineJoinRequest(tx, { groupId, hostUserId, memberUserId }),
    )
    revalidatePath(`/community/${groupId}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: mapError(err) }
  }
}

export async function removeMemberAction(
  groupId: string,
  memberUserId: string,
): Promise<ActionResult> {
  const hostUserId = await requireUserId()
  if (!hostUserId) return { ok: false, error: 'Sign in.' }
  try {
    await prodDb.transaction((tx) =>
      removeMember(tx, { groupId, hostUserId, memberUserId }),
    )
    revalidatePath(`/community/${groupId}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: mapError(err) }
  }
}

export async function lockItineraryAction(groupId: string): Promise<ActionResult> {
  const hostUserId = await requireUserId()
  if (!hostUserId) return { ok: false, error: 'Sign in.' }
  try {
    await prodDb.transaction((tx) => lockItinerary(tx, { groupId, hostUserId }))
    revalidatePath(`/community/${groupId}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: mapError(err) }
  }
}

const addSlotSchema = z.object({
  groupId: z.string().uuid(),
  dayOffset: z.number().int().min(0).max(60),
  timeBand: z.string().trim().min(1).max(40),
  experienceId: z.string().uuid().optional().nullable(),
  freeText: z.string().trim().max(280).optional().nullable(),
})

export async function addSlotAction(
  input: z.infer<typeof addSlotSchema>,
): Promise<ActionResult> {
  const userId = await requireUserId()
  if (!userId) return { ok: false, error: 'Sign in.' }
  const parsed = addSlotSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  try {
    await prodDb.transaction((tx) => addItinerarySlot(tx, { ...parsed.data, userId }))
    revalidatePath(`/community/${parsed.data.groupId}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: mapError(err) }
  }
}

export async function deleteSlotAction(
  slotId: string,
  groupId: string,
): Promise<ActionResult> {
  const userId = await requireUserId()
  if (!userId) return { ok: false, error: 'Sign in.' }
  try {
    await prodDb.transaction((tx) => deleteItinerarySlot(tx, slotId))
    revalidatePath(`/community/${groupId}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: mapError(err) }
  }
}
