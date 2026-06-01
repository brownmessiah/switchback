/**
 * TripGroup membership (ADR-0009): join / approve / decline / leave / remove /
 * host-transfer, plus the **women-only eligibility gate**. A `public_women_only`
 * group is joinable only by a Customer whose `customer_profiles.
 * aadhaar_gender_verified = 'female'`; the gate ships correct-but-inert until
 * Aadhaar eKYC populates that flag (an `unverified` Customer is denied, never
 * faked). Gender is read ONLY here (the eligibility check) and in admin tooling
 * — never surfaced to other Customers.
 */

import { and, eq, sql } from 'drizzle-orm'

import { customerProfiles } from '@/db/schema/customer-profiles'
import { tripGroupMembers, tripGroups } from '@/db/schema/trip-groups'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import { TripGroupError } from './errors'
import { canAdvanceToPlanning, MIN_MEMBERS_TO_PLAN } from './group-lifecycle'

/** `now()` server-side timestamp for updatedAt writes. */
function sqlNow() {
  return sql`now()`
}

type Visibility = 'private' | 'public_all' | 'public_women_only'
type MembershipRule = 'auto_accept' | 'host_approval'
type Gender = 'female' | 'male' | 'other' | 'unverified'
type GroupStatus = (typeof tripGroups.$inferSelect)['status']

export interface JoinEligibilityContext {
  visibility: Visibility
  membershipRule: MembershipRule
  gender: Gender
  status: GroupStatus
  activeMemberCount: number
  maxMembers: number
  alreadyMember: boolean
}

export type JoinEligibility =
  | { ok: true; resultingStatus: 'active' | 'pending' }
  | { ok: false; code: TripGroupError['code'] }

/**
 * Pure decision for whether `userId` may join — the single source of the
 * join rules, unit-testable without a DB.
 */
export function evaluateJoinEligibility(ctx: JoinEligibilityContext): JoinEligibility {
  if (ctx.alreadyMember) return { ok: false, code: 'ALREADY_MEMBER' }
  // Joinable only while gathering or planning — not once booking/traveling/done.
  if (ctx.status !== 'forming' && ctx.status !== 'planning') {
    return { ok: false, code: 'NOT_JOINABLE' }
  }
  // Private groups are invite-only — not joinable via the open request path.
  if (ctx.visibility === 'private') return { ok: false, code: 'INVITE_REQUIRED' }
  // Women-only gate (ADR-0009).
  if (ctx.visibility === 'public_women_only' && ctx.gender !== 'female') {
    return { ok: false, code: 'ELIGIBILITY_DENIED' }
  }
  // Capacity is measured in ACTIVE seats.
  if (ctx.activeMemberCount >= ctx.maxMembers) {
    return { ok: false, code: 'CAPACITY_FULL' }
  }
  return {
    ok: true,
    resultingStatus: ctx.membershipRule === 'auto_accept' ? 'active' : 'pending',
  }
}

// ── DB-backed helpers ───────────────────────────────────────────────

async function loadGroup(db: DBOrTx, groupId: string) {
  const [group] = await db
    .select()
    .from(tripGroups)
    .where(eq(tripGroups.id, groupId))
    .for('update')
    .limit(1)
  if (!group) throw new TripGroupError('NOT_FOUND', `trip group ${groupId} not found`)
  return group
}

async function loadGender(db: DBOrTx, userId: string): Promise<Gender> {
  const [profile] = await db
    .select({ gender: customerProfiles.aadhaarGenderVerified })
    .from(customerProfiles)
    .where(eq(customerProfiles.userId, userId))
    .limit(1)
  return profile?.gender ?? 'unverified'
}

async function countActive(db: DBOrTx, groupId: string): Promise<number> {
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

/** Auto-advance forming → planning once enough ACTIVE members have joined. */
async function maybeAdvanceToPlanning(db: DBOrTx, groupId: string): Promise<void> {
  const [group] = await db
    .select({ status: tripGroups.status })
    .from(tripGroups)
    .where(eq(tripGroups.id, groupId))
    .limit(1)
  if (group?.status !== 'forming') return
  const active = await countActive(db, groupId)
  if (canAdvanceToPlanning(active)) {
    await db
      .update(tripGroups)
      .set({ status: 'planning', updatedAt: sqlNow() })
      .where(eq(tripGroups.id, groupId))
  }
}

export interface JoinResult {
  resultingStatus: 'active' | 'pending'
}

/** Request to join (auto-accept → active; host_approval → pending). */
export async function requestToJoin(
  db: DBOrTx,
  args: { groupId: string; userId: string },
): Promise<JoinResult> {
  const group = await loadGroup(db, args.groupId)
  const [existing] = await db
    .select({ userId: tripGroupMembers.userId })
    .from(tripGroupMembers)
    .where(
      and(
        eq(tripGroupMembers.tripGroupId, args.groupId),
        eq(tripGroupMembers.userId, args.userId),
      ),
    )
    .limit(1)

  const decision = evaluateJoinEligibility({
    visibility: group.visibility,
    membershipRule: group.membershipRule,
    gender: await loadGender(db, args.userId),
    status: group.status,
    activeMemberCount: await countActive(db, args.groupId),
    maxMembers: group.maxMembers,
    alreadyMember: Boolean(existing),
  })
  if (!decision.ok) {
    throw new TripGroupError(decision.code, `cannot join group ${args.groupId}`)
  }

  await db.insert(tripGroupMembers).values({
    tripGroupId: args.groupId,
    userId: args.userId,
    role: 'member',
    status: decision.resultingStatus,
  })

  if (decision.resultingStatus === 'active') {
    await maybeAdvanceToPlanning(db, args.groupId)
  }
  return { resultingStatus: decision.resultingStatus }
}

async function assertHost(db: DBOrTx, groupId: string, hostUserId: string) {
  const group = await loadGroup(db, groupId)
  if (group.hostUserId !== hostUserId) {
    throw new TripGroupError('NOT_HOST', `user ${hostUserId} is not the host of ${groupId}`)
  }
  return group
}

/** Host approves a pending join request → active (re-checks capacity). */
export async function approveJoinRequest(
  db: DBOrTx,
  args: { groupId: string; hostUserId: string; memberUserId: string },
): Promise<void> {
  const group = await assertHost(db, args.groupId, args.hostUserId)
  const [member] = await db
    .select({ status: tripGroupMembers.status })
    .from(tripGroupMembers)
    .where(
      and(
        eq(tripGroupMembers.tripGroupId, args.groupId),
        eq(tripGroupMembers.userId, args.memberUserId),
      ),
    )
    .limit(1)
  if (!member || member.status !== 'pending') {
    throw new TripGroupError('NO_PENDING_REQUEST', 'no pending request for that user')
  }
  if ((await countActive(db, args.groupId)) >= group.maxMembers) {
    throw new TripGroupError('CAPACITY_FULL', 'group is at capacity')
  }
  await db
    .update(tripGroupMembers)
    .set({ status: 'active', updatedAt: sqlNow() })
    .where(
      and(
        eq(tripGroupMembers.tripGroupId, args.groupId),
        eq(tripGroupMembers.userId, args.memberUserId),
      ),
    )
  await maybeAdvanceToPlanning(db, args.groupId)
}

/** Host declines a pending request (deletes the row). */
export async function declineJoinRequest(
  db: DBOrTx,
  args: { groupId: string; hostUserId: string; memberUserId: string },
): Promise<void> {
  await assertHost(db, args.groupId, args.hostUserId)
  await db
    .delete(tripGroupMembers)
    .where(
      and(
        eq(tripGroupMembers.tripGroupId, args.groupId),
        eq(tripGroupMembers.userId, args.memberUserId),
        eq(tripGroupMembers.status, 'pending'),
      ),
    )
}

/** A member leaves. The host cannot leave without transferring first. */
export async function leaveGroup(
  db: DBOrTx,
  args: { groupId: string; userId: string },
): Promise<void> {
  const group = await loadGroup(db, args.groupId)
  if (group.hostUserId === args.userId) {
    throw new TripGroupError(
      'HOST_MUST_TRANSFER',
      'the host must transfer the group before leaving',
    )
  }
  const deleted = await db
    .delete(tripGroupMembers)
    .where(
      and(
        eq(tripGroupMembers.tripGroupId, args.groupId),
        eq(tripGroupMembers.userId, args.userId),
      ),
    )
    .returning({ userId: tripGroupMembers.userId })
  if (deleted.length === 0) {
    throw new TripGroupError('NOT_MEMBER', `user ${args.userId} is not a member`)
  }
}

/** Host removes a member (cannot remove themselves — use transfer/leave). */
export async function removeMember(
  db: DBOrTx,
  args: { groupId: string; hostUserId: string; memberUserId: string },
): Promise<void> {
  await assertHost(db, args.groupId, args.hostUserId)
  if (args.memberUserId === args.hostUserId) {
    throw new TripGroupError('HOST_MUST_TRANSFER', 'the host cannot remove themselves')
  }
  const deleted = await db
    .delete(tripGroupMembers)
    .where(
      and(
        eq(tripGroupMembers.tripGroupId, args.groupId),
        eq(tripGroupMembers.userId, args.memberUserId),
      ),
    )
    .returning({ userId: tripGroupMembers.userId })
  if (deleted.length === 0) {
    throw new TripGroupError('NOT_MEMBER', `user ${args.memberUserId} is not a member`)
  }
}

/** Manual host-transfer (v1): the new host must already be an ACTIVE member. */
export async function transferHost(
  db: DBOrTx,
  args: { groupId: string; currentHostUserId: string; newHostUserId: string },
): Promise<void> {
  await assertHost(db, args.groupId, args.currentHostUserId)
  const [target] = await db
    .select({ status: tripGroupMembers.status })
    .from(tripGroupMembers)
    .where(
      and(
        eq(tripGroupMembers.tripGroupId, args.groupId),
        eq(tripGroupMembers.userId, args.newHostUserId),
      ),
    )
    .limit(1)
  if (!target || target.status !== 'active') {
    throw new TripGroupError(
      'NOT_ACTIVE_MEMBER',
      'the new host must be an active member of the group',
    )
  }
  await db
    .update(tripGroups)
    .set({ hostUserId: args.newHostUserId, updatedAt: sqlNow() })
    .where(eq(tripGroups.id, args.groupId))
  await db
    .update(tripGroupMembers)
    .set({ role: 'member', updatedAt: sqlNow() })
    .where(
      and(
        eq(tripGroupMembers.tripGroupId, args.groupId),
        eq(tripGroupMembers.userId, args.currentHostUserId),
      ),
    )
  await db
    .update(tripGroupMembers)
    .set({ role: 'host', updatedAt: sqlNow() })
    .where(
      and(
        eq(tripGroupMembers.tripGroupId, args.groupId),
        eq(tripGroupMembers.userId, args.newHostUserId),
      ),
    )
}

export { MIN_MEMBERS_TO_PLAN }
