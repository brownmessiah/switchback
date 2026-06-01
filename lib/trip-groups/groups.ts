/**
 * TripGroup creation + read (ADR-0009). Creating a group also seats the host
 * as the first ACTIVE member (role `host`). Creating a `public_women_only`
 * group requires the host to be Aadhaar-verified female — you cannot convene a
 * women-only cohort you would not be eligible to join.
 */

import { and, eq } from 'drizzle-orm'

import { customerProfiles } from '@/db/schema/customer-profiles'
import { tripGroupMembers, tripGroups } from '@/db/schema/trip-groups'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import { TripGroupError } from './errors'

const PLATFORM_MAX_MEMBERS = 12

export interface CreateTripGroupInput {
  hostUserId: string
  name: string
  destinationSlugs?: string[]
  targetDateWindowStart?: string | null
  targetDateWindowEnd?: string | null
  budgetRange?: { minRupees?: number; maxRupees?: number } | null
  interestTags?: string[]
  visibility?: 'private' | 'public_all' | 'public_women_only'
  membershipRule?: 'auto_accept' | 'host_approval'
  maxMembers: number
}

export interface TripGroupRosterMember {
  userId: string
  role: 'host' | 'member'
  status: 'pending' | 'active'
  joinedAt: Date
}

/**
 * Create a TripGroup + seat the host. Caller should wrap in a transaction;
 * the function uses the passed `db` (a tx) for atomicity of group + host row.
 */
export async function createTripGroup(
  db: DBOrTx,
  input: CreateTripGroupInput,
): Promise<{ id: string }> {
  const name = input.name.trim()
  if (!name) {
    throw new TripGroupError('INVALID_INPUT', 'group name is required')
  }
  if (
    !Number.isInteger(input.maxMembers) ||
    input.maxMembers < 2 ||
    input.maxMembers > PLATFORM_MAX_MEMBERS
  ) {
    throw new TripGroupError(
      'INVALID_INPUT',
      `maxMembers must be an integer in 2..${PLATFORM_MAX_MEMBERS}`,
    )
  }

  const visibility = input.visibility ?? 'public_all'

  // Women-only host eligibility — the host must be a verified woman.
  if (visibility === 'public_women_only') {
    const [profile] = await db
      .select({ gender: customerProfiles.aadhaarGenderVerified })
      .from(customerProfiles)
      .where(eq(customerProfiles.userId, input.hostUserId))
      .limit(1)
    if (profile?.gender !== 'female') {
      throw new TripGroupError(
        'ELIGIBILITY_DENIED',
        'only an Aadhaar-verified female host can create a women-only group',
      )
    }
  }

  const [group] = await db
    .insert(tripGroups)
    .values({
      hostUserId: input.hostUserId,
      name,
      destinationSlugs: input.destinationSlugs ?? [],
      targetDateWindowStart: input.targetDateWindowStart ?? null,
      targetDateWindowEnd: input.targetDateWindowEnd ?? null,
      budgetRange: input.budgetRange ?? null,
      interestTags: input.interestTags ?? [],
      visibility,
      membershipRule: input.membershipRule ?? 'auto_accept',
      maxMembers: input.maxMembers,
      // status defaults to 'forming'
    })
    .returning({ id: tripGroups.id })

  if (!group) {
    throw new Error('trip_groups insert returned no row (unreachable)')
  }

  await db.insert(tripGroupMembers).values({
    tripGroupId: group.id,
    userId: input.hostUserId,
    role: 'host',
    status: 'active',
  })

  return { id: group.id }
}

/** Group header + full roster (host + members, pending + active). */
export async function getTripGroupWithRoster(
  db: DBOrTx,
  groupId: string,
): Promise<{
  group: typeof tripGroups.$inferSelect
  roster: TripGroupRosterMember[]
}> {
  const [group] = await db
    .select()
    .from(tripGroups)
    .where(eq(tripGroups.id, groupId))
    .limit(1)
  if (!group) {
    throw new TripGroupError('NOT_FOUND', `trip group ${groupId} not found`)
  }

  const roster = await db
    .select({
      userId: tripGroupMembers.userId,
      role: tripGroupMembers.role,
      status: tripGroupMembers.status,
      joinedAt: tripGroupMembers.joinedAt,
    })
    .from(tripGroupMembers)
    .where(eq(tripGroupMembers.tripGroupId, groupId))

  return { group, roster }
}

/** Count of ACTIVE members in a group (host + active joiners). */
export async function countActiveMembers(
  db: DBOrTx,
  groupId: string,
): Promise<number> {
  const rows = await db
    .select({ userId: tripGroupMembers.userId })
    .from(tripGroupMembers)
    .where(
      and(
        eq(tripGroupMembers.tripGroupId, groupId),
        eq(tripGroupMembers.status, 'active'),
      ),
    )
  return rows.length
}
