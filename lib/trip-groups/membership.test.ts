import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { customerProfiles } from '@/db/schema/customer-profiles'
import { tripGroupMembers, tripGroups } from '@/db/schema/trip-groups'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { createTripGroup } from './groups'
import {
  approveJoinRequest,
  declineJoinRequest,
  evaluateJoinEligibility,
  leaveGroup,
  removeMember,
  requestToJoin,
  transferHost,
} from './membership'

describe('trip-group membership (ADR-0009)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
    await db.insert(users).values([
      { id: 'u_host', email: 'host@t.com', name: 'Host' },
      { id: 'u_female', email: 'f@t.com', name: 'Fem' },
      { id: 'u_male', email: 'm@t.com', name: 'Male' },
      { id: 'u_female2', email: 'f2@t.com', name: 'Fem2' },
      { id: 'u_a', email: 'a@t.com', name: 'A' },
      { id: 'u_b', email: 'b@t.com', name: 'B' },
    ])
    await db.insert(customerProfiles).values([
      { userId: 'u_host', aadhaarGenderVerified: 'female' },
      { userId: 'u_female', aadhaarGenderVerified: 'female' },
      { userId: 'u_female2', aadhaarGenderVerified: 'female' },
      { userId: 'u_male', aadhaarGenderVerified: 'male' },
      // u_a, u_b: no profile rows ⇒ treated as 'unverified'
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE trip_group_members, trip_groups CASCADE`)
  })

  // ── evaluateJoinEligibility (pure) ────────────────────────────────
  describe('evaluateJoinEligibility', () => {
    const base = {
      visibility: 'public_all' as const,
      membershipRule: 'auto_accept' as const,
      gender: 'unverified' as const,
      status: 'forming' as const,
      activeMemberCount: 1,
      maxMembers: 6,
      alreadyMember: false,
    }
    it('auto_accept → active; host_approval → pending', () => {
      expect(evaluateJoinEligibility(base)).toEqual({ ok: true, resultingStatus: 'active' })
      expect(evaluateJoinEligibility({ ...base, membershipRule: 'host_approval' })).toEqual({
        ok: true,
        resultingStatus: 'pending',
      })
    })
    it('blocks already-member, full, non-joinable status, private', () => {
      expect(evaluateJoinEligibility({ ...base, alreadyMember: true }).ok).toBe(false)
      expect(evaluateJoinEligibility({ ...base, activeMemberCount: 6 })).toEqual({
        ok: false,
        code: 'CAPACITY_FULL',
      })
      expect(evaluateJoinEligibility({ ...base, status: 'booking' })).toEqual({
        ok: false,
        code: 'NOT_JOINABLE',
      })
      expect(evaluateJoinEligibility({ ...base, visibility: 'private' })).toEqual({
        ok: false,
        code: 'INVITE_REQUIRED',
      })
    })
    it('women-only: female allowed, male/unverified denied', () => {
      const wo = { ...base, visibility: 'public_women_only' as const }
      expect(evaluateJoinEligibility({ ...wo, gender: 'female' }).ok).toBe(true)
      expect(evaluateJoinEligibility({ ...wo, gender: 'male' })).toEqual({
        ok: false,
        code: 'ELIGIBILITY_DENIED',
      })
      expect(evaluateJoinEligibility({ ...wo, gender: 'unverified' })).toEqual({
        ok: false,
        code: 'ELIGIBILITY_DENIED',
      })
    })
  })

  // ── create ────────────────────────────────────────────────────────
  it('creates a group + seats the host as an active host member', async () => {
    const { id } = await createTripGroup(db, {
      hostUserId: 'u_host',
      name: 'Rishikesh Oct',
      maxMembers: 6,
    })
    const roster = await db
      .select()
      .from(tripGroupMembers)
      .where(eq(tripGroupMembers.tripGroupId, id))
    expect(roster).toHaveLength(1)
    expect(roster[0]?.role).toBe('host')
    expect(roster[0]?.status).toBe('active')
  })

  it('rejects a women-only group created by a non-female host', async () => {
    await expect(
      createTripGroup(db, {
        hostUserId: 'u_male',
        name: 'WO',
        maxMembers: 6,
        visibility: 'public_women_only',
      }),
    ).rejects.toMatchObject({ code: 'ELIGIBILITY_DENIED' })
    // female host is allowed
    await expect(
      createTripGroup(db, {
        hostUserId: 'u_female',
        name: 'WO',
        maxMembers: 6,
        visibility: 'public_women_only',
      }),
    ).resolves.toBeDefined()
  })

  // ── join ────────────────────────────────────────────────────────--
  it('auto_accept join makes the joiner active and advances forming→planning at 2 members', async () => {
    const { id } = await createTripGroup(db, { hostUserId: 'u_host', name: 'G', maxMembers: 6 })
    const res = await requestToJoin(db, { groupId: id, userId: 'u_a' })
    expect(res.resultingStatus).toBe('active')
    const [g] = await db.select({ status: tripGroups.status }).from(tripGroups).where(eq(tripGroups.id, id))
    expect(g?.status).toBe('planning') // host (1) + u_a (2) ⇒ min reached
  })

  it('host_approval join is pending until approved; approval advances the group', async () => {
    const { id } = await createTripGroup(db, {
      hostUserId: 'u_host',
      name: 'G',
      maxMembers: 6,
      membershipRule: 'host_approval',
    })
    const res = await requestToJoin(db, { groupId: id, userId: 'u_a' })
    expect(res.resultingStatus).toBe('pending')
    let [g] = await db.select({ status: tripGroups.status }).from(tripGroups).where(eq(tripGroups.id, id))
    expect(g?.status).toBe('forming') // pending doesn't count

    await approveJoinRequest(db, { groupId: id, hostUserId: 'u_host', memberUserId: 'u_a' })
    const [m] = await db
      .select({ status: tripGroupMembers.status })
      .from(tripGroupMembers)
      .where(and(eq(tripGroupMembers.tripGroupId, id), eq(tripGroupMembers.userId, 'u_a')))
    expect(m?.status).toBe('active')
    ;[g] = await db.select({ status: tripGroups.status }).from(tripGroups).where(eq(tripGroups.id, id))
    expect(g?.status).toBe('planning')
  })

  it('women-only join: female joins, male is denied at the DB layer', async () => {
    const { id } = await createTripGroup(db, {
      hostUserId: 'u_female',
      name: 'WO',
      maxMembers: 6,
      visibility: 'public_women_only',
    })
    // A verified-female non-member joins fine.
    const ok = await requestToJoin(db, { groupId: id, userId: 'u_female2' })
    expect(ok.resultingStatus).toBe('active')
    await expect(requestToJoin(db, { groupId: id, userId: 'u_male' })).rejects.toMatchObject({
      code: 'ELIGIBILITY_DENIED',
    })
    await expect(requestToJoin(db, { groupId: id, userId: 'u_a' })).rejects.toMatchObject({
      code: 'ELIGIBILITY_DENIED', // unverified
    })
    await expect(requestToJoin(db, { groupId: id, userId: 'u_female' })).rejects.toMatchObject({
      code: 'ALREADY_MEMBER', // host is already a member
    })
  })

  it('enforces capacity on join', async () => {
    const { id } = await createTripGroup(db, { hostUserId: 'u_host', name: 'G', maxMembers: 2 })
    await requestToJoin(db, { groupId: id, userId: 'u_a' }) // active → 2/2
    await expect(requestToJoin(db, { groupId: id, userId: 'u_b' })).rejects.toMatchObject({
      code: 'CAPACITY_FULL',
    })
  })

  it('declines a pending request', async () => {
    const { id } = await createTripGroup(db, {
      hostUserId: 'u_host',
      name: 'G',
      maxMembers: 6,
      membershipRule: 'host_approval',
    })
    await requestToJoin(db, { groupId: id, userId: 'u_a' })
    await declineJoinRequest(db, { groupId: id, hostUserId: 'u_host', memberUserId: 'u_a' })
    const rows = await db
      .select()
      .from(tripGroupMembers)
      .where(and(eq(tripGroupMembers.tripGroupId, id), eq(tripGroupMembers.userId, 'u_a')))
    expect(rows).toHaveLength(0)
  })

  // ── leave / remove / transfer ─────────────────────────────────────
  it('a member can leave; the host cannot leave without transferring', async () => {
    const { id } = await createTripGroup(db, { hostUserId: 'u_host', name: 'G', maxMembers: 6 })
    await requestToJoin(db, { groupId: id, userId: 'u_a' })
    await leaveGroup(db, { groupId: id, userId: 'u_a' })
    const rows = await db
      .select()
      .from(tripGroupMembers)
      .where(and(eq(tripGroupMembers.tripGroupId, id), eq(tripGroupMembers.userId, 'u_a')))
    expect(rows).toHaveLength(0)
    await expect(leaveGroup(db, { groupId: id, userId: 'u_host' })).rejects.toMatchObject({
      code: 'HOST_MUST_TRANSFER',
    })
  })

  it('host removes a member but not themselves', async () => {
    const { id } = await createTripGroup(db, { hostUserId: 'u_host', name: 'G', maxMembers: 6 })
    await requestToJoin(db, { groupId: id, userId: 'u_a' })
    await removeMember(db, { groupId: id, hostUserId: 'u_host', memberUserId: 'u_a' })
    expect(
      (await db.select().from(tripGroupMembers).where(eq(tripGroupMembers.tripGroupId, id))).length,
    ).toBe(1)
    await expect(
      removeMember(db, { groupId: id, hostUserId: 'u_host', memberUserId: 'u_host' }),
    ).rejects.toMatchObject({ code: 'HOST_MUST_TRANSFER' })
    // a non-host cannot remove
    await expect(
      removeMember(db, { groupId: id, hostUserId: 'u_a', memberUserId: 'u_host' }),
    ).rejects.toMatchObject({ code: 'NOT_HOST' })
  })

  it('transfers host to an active member and swaps roles', async () => {
    const { id } = await createTripGroup(db, { hostUserId: 'u_host', name: 'G', maxMembers: 6 })
    await requestToJoin(db, { groupId: id, userId: 'u_a' })
    await transferHost(db, { groupId: id, currentHostUserId: 'u_host', newHostUserId: 'u_a' })
    const [g] = await db.select({ host: tripGroups.hostUserId }).from(tripGroups).where(eq(tripGroups.id, id))
    expect(g?.host).toBe('u_a')
    const roles = Object.fromEntries(
      (
        await db
          .select({ u: tripGroupMembers.userId, r: tripGroupMembers.role })
          .from(tripGroupMembers)
          .where(eq(tripGroupMembers.tripGroupId, id))
      ).map((r) => [r.u, r.r]),
    )
    expect(roles['u_a']).toBe('host')
    expect(roles['u_host']).toBe('member')
    // cannot transfer to a non-member
    await expect(
      transferHost(db, { groupId: id, currentHostUserId: 'u_a', newHostUserId: 'u_b' }),
    ).rejects.toMatchObject({ code: 'NOT_ACTIVE_MEMBER' })
  })
})
