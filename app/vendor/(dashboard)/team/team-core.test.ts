import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { vendorTeamMembers } from '@/db/schema/vendor-team-members'
import { hasVendorAccess, resolveVendorRole } from '@/lib/auth/permissions'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeDeactivateTeamMember,
  executeEditTeamMemberRole,
  executeInviteTeamMember,
  executeRemoveTeamMember,
  loadVendorTeam,
} from './team-core'

/**
 * Integration tests (PGlite) for the Vendor team-member backend (issue #04).
 * Proves the invite create-or-link semantics, role/status mutations, removal,
 * Owner protection, and that an invited member's permissions resolve through
 * the issue-03 gate immediately.
 */

async function seedVendor(db: TestDB, vendorUserId: string): Promise<void> {
  await db.insert(users).values({ id: vendorUserId, email: `${vendorUserId}@test.com` })
  await db.insert(vendorProfiles).values({
    userId: vendorUserId,
    businessName: 'Test Vendor',
    slug: `slug-${vendorUserId}`,
  })
}

describe('executeInviteTeamMember', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, vendor_team_members, vendor_profiles, users CASCADE`,
    )
  })

  it('creates a NEW auth user and a membership row when the email is unknown', async () => {
    await seedVendor(db, 'u_owner')

    const result = await executeInviteTeamMember(db, 'u_owner', {
      fullName: 'Asha Rao',
      email: 'asha@new.com',
      phone: '+919000000001',
      role: 'manager',
    })

    expect(result.ok).toBe(true)

    const [createdUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'asha@new.com'))
      .limit(1)
    expect(createdUser).toBeDefined()
    expect(createdUser!.name).toBe('Asha Rao')
    expect(createdUser!.phoneNumber).toBe('+919000000001')
    expect(createdUser!.emailVerified).toBe(false)

    const [membership] = await db
      .select()
      .from(vendorTeamMembers)
      .where(eq(vendorTeamMembers.memberUserId, createdUser!.id))
      .limit(1)
    expect(membership).toBeDefined()
    expect(membership!.vendorUserId).toBe('u_owner')
    expect(membership!.role).toBe('manager')
    expect(membership!.status).toBe('active')
    expect(membership!.invitedAt).not.toBeNull()
  })

  it('LINKS an existing auth user (does not create a duplicate) when the email is known', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_existing', email: 'known@person.com', name: 'Known' })

    const result = await executeInviteTeamMember(db, 'u_owner', {
      email: 'known@person.com',
      role: 'guide',
    })

    expect(result.ok).toBe(true)

    const allUsersWithEmail = await db
      .select()
      .from(users)
      .where(eq(users.email, 'known@person.com'))
    expect(allUsersWithEmail).toHaveLength(1)
    expect(allUsersWithEmail[0]!.id).toBe('u_existing')

    const [membership] = await db
      .select()
      .from(vendorTeamMembers)
      .where(eq(vendorTeamMembers.memberUserId, 'u_existing'))
      .limit(1)
    expect(membership!.role).toBe('guide')
  })

  it('errors when re-inviting someone already an ACTIVE member of this vendor', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_m', email: 'dup@person.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_m',
      role: 'guide',
      status: 'active',
    })

    const result = await executeInviteTeamMember(db, 'u_owner', {
      email: 'dup@person.com',
      role: 'manager',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/already on your team/i)
    }
  })

  it("rejects the role 'owner' as an assignable role", async () => {
    await seedVendor(db, 'u_owner')

    const result = await executeInviteTeamMember(db, 'u_owner', {
      email: 'evil@person.com',
      // @ts-expect-error — 'owner' is intentionally not an assignable role
      role: 'owner',
    })

    expect(result.ok).toBe(false)
  })

  it("rejects inviting the Owner's own email as a member", async () => {
    await seedVendor(db, 'u_owner')

    const result = await executeInviteTeamMember(db, 'u_owner', {
      email: 'u_owner@test.com',
      role: 'manager',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/owner/i)
    }
  })

  it('rejects an invalid email', async () => {
    await seedVendor(db, 'u_owner')

    const result = await executeInviteTeamMember(db, 'u_owner', {
      email: 'not-an-email',
      role: 'manager',
    })

    expect(result.ok).toBe(false)
  })

  it('writes an audit log on a successful invite', async () => {
    await seedVendor(db, 'u_owner')

    await executeInviteTeamMember(db, 'u_owner', {
      email: 'audit@person.com',
      role: 'accountant',
    })

    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'vendor.team.invite'))
    expect(logs).toHaveLength(1)
  })

  it("an invited member's role is immediately enforced by the issue-03 gate", async () => {
    await seedVendor(db, 'u_owner')

    await executeInviteTeamMember(db, 'u_owner', {
      email: 'mgr@person.com',
      role: 'manager',
    })

    const [member] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, 'mgr@person.com'))
      .limit(1)

    expect(await resolveVendorRole(db, 'u_owner', member!.id)).toBe('manager')
    expect(await hasVendorAccess(db, member!.id, 'experiences:manage', 'u_owner')).toBe(true)
    expect(await hasVendorAccess(db, member!.id, 'team:manage', 'u_owner')).toBe(false)
  })
})

describe('executeEditTeamMemberRole', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, vendor_team_members, vendor_profiles, users CASCADE`,
    )
  })

  it('changes a member role and the gate reflects the new role immediately', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_m', email: 'm@person.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_m',
      role: 'guide',
      status: 'active',
    })

    const result = await executeEditTeamMemberRole(db, 'u_owner', {
      memberUserId: 'u_m',
      role: 'manager',
    })

    expect(result.ok).toBe(true)
    expect(await resolveVendorRole(db, 'u_owner', 'u_m')).toBe('manager')
    expect(await hasVendorAccess(db, 'u_m', 'analytics:read', 'u_owner')).toBe(true)
  })

  it('returns not-found for a non-member target', async () => {
    await seedVendor(db, 'u_owner')

    const result = await executeEditTeamMemberRole(db, 'u_owner', {
      memberUserId: 'u_ghost',
      role: 'manager',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/not found/i)
    }
  })

  it("rejects editing a role to 'owner'", async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_m', email: 'm@person.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_m',
      role: 'guide',
      status: 'active',
    })

    const result = await executeEditTeamMemberRole(db, 'u_owner', {
      memberUserId: 'u_m',
      // @ts-expect-error — 'owner' is not assignable
      role: 'owner',
    })

    expect(result.ok).toBe(false)
  })

  it('does not edit a member of a DIFFERENT vendor account', async () => {
    await seedVendor(db, 'u_owner')
    await seedVendor(db, 'u_other')
    await db.insert(users).values({ id: 'u_m', email: 'm@person.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_other',
      memberUserId: 'u_m',
      role: 'guide',
      status: 'active',
    })

    // u_owner tries to edit u_m, who belongs to u_other.
    const result = await executeEditTeamMemberRole(db, 'u_owner', {
      memberUserId: 'u_m',
      role: 'manager',
    })

    expect(result.ok).toBe(false)
    // The original row is untouched.
    const [row] = await db
      .select({ role: vendorTeamMembers.role })
      .from(vendorTeamMembers)
      .where(eq(vendorTeamMembers.memberUserId, 'u_m'))
      .limit(1)
    expect(row!.role).toBe('guide')
  })
})

describe('executeDeactivateTeamMember', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, vendor_team_members, vendor_profiles, users CASCADE`,
    )
  })

  it('flips status to inactive and the gate then DENIES that member', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_m', email: 'm@person.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_m',
      role: 'manager',
      status: 'active',
    })

    // Sanity: active manager is allowed before deactivation.
    expect(await hasVendorAccess(db, 'u_m', 'experiences:manage', 'u_owner')).toBe(true)

    const result = await executeDeactivateTeamMember(db, 'u_owner', {
      memberUserId: 'u_m',
      status: 'inactive',
    })

    expect(result.ok).toBe(true)
    expect(await resolveVendorRole(db, 'u_owner', 'u_m')).toBeNull()
    expect(await hasVendorAccess(db, 'u_m', 'experiences:manage', 'u_owner')).toBe(false)
  })

  it('can re-activate a previously deactivated member', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_m', email: 'm@person.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_m',
      role: 'manager',
      status: 'inactive',
    })

    const result = await executeDeactivateTeamMember(db, 'u_owner', {
      memberUserId: 'u_m',
      status: 'active',
    })

    expect(result.ok).toBe(true)
    expect(await resolveVendorRole(db, 'u_owner', 'u_m')).toBe('manager')
  })

  it('returns not-found for a non-member target', async () => {
    await seedVendor(db, 'u_owner')

    const result = await executeDeactivateTeamMember(db, 'u_owner', {
      memberUserId: 'u_ghost',
      status: 'inactive',
    })

    expect(result.ok).toBe(false)
  })
})

describe('executeRemoveTeamMember', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, vendor_team_members, vendor_profiles, users CASCADE`,
    )
  })

  it('deletes the membership row (member is no longer resolvable)', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_m', email: 'm@person.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_m',
      role: 'manager',
      status: 'active',
    })

    const result = await executeRemoveTeamMember(db, 'u_owner', { memberUserId: 'u_m' })

    expect(result.ok).toBe(true)

    const rows = await db
      .select()
      .from(vendorTeamMembers)
      .where(eq(vendorTeamMembers.memberUserId, 'u_m'))
    expect(rows).toHaveLength(0)
    expect(await resolveVendorRole(db, 'u_owner', 'u_m')).toBeNull()
  })

  it('does NOT delete the underlying auth user (only the membership)', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_m', email: 'm@person.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_m',
      role: 'manager',
      status: 'active',
    })

    await executeRemoveTeamMember(db, 'u_owner', { memberUserId: 'u_m' })

    const [stillThere] = await db
      .select()
      .from(users)
      .where(eq(users.id, 'u_m'))
      .limit(1)
    expect(stillThere).toBeDefined()
  })

  it('returns not-found for a non-member target', async () => {
    await seedVendor(db, 'u_owner')

    const result = await executeRemoveTeamMember(db, 'u_owner', { memberUserId: 'u_ghost' })

    expect(result.ok).toBe(false)
  })

  it('does not remove a member belonging to a DIFFERENT vendor account', async () => {
    await seedVendor(db, 'u_owner')
    await seedVendor(db, 'u_other')
    await db.insert(users).values({ id: 'u_m', email: 'm@person.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_other',
      memberUserId: 'u_m',
      role: 'guide',
      status: 'active',
    })

    const result = await executeRemoveTeamMember(db, 'u_owner', { memberUserId: 'u_m' })

    expect(result.ok).toBe(false)
    const rows = await db
      .select()
      .from(vendorTeamMembers)
      .where(eq(vendorTeamMembers.memberUserId, 'u_m'))
    expect(rows).toHaveLength(1)
  })
})

describe('loadVendorTeam', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, vendor_team_members, vendor_profiles, users CASCADE`,
    )
  })

  it('returns joined name/email/role/status/invitedAt/lastActiveAt for each member', async () => {
    await seedVendor(db, 'u_owner')
    const invitedAt = new Date('2026-01-01T00:00:00Z')
    const lastActiveAt = new Date('2026-02-01T00:00:00Z')
    await db.insert(users).values({
      id: 'u_m',
      email: 'm@person.com',
      name: 'Member One',
    })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_m',
      role: 'booking_staff',
      status: 'active',
      invitedAt,
      lastActiveAt,
    })

    const team = await loadVendorTeam(db, 'u_owner')

    expect(team).toHaveLength(1)
    expect(team[0]).toMatchObject({
      memberUserId: 'u_m',
      name: 'Member One',
      email: 'm@person.com',
      role: 'booking_staff',
      status: 'active',
    })
    expect(team[0]!.invitedAt).toEqual(invitedAt)
    expect(team[0]!.lastActiveAt).toEqual(lastActiveAt)
  })

  it('returns only members of the requested vendor account', async () => {
    await seedVendor(db, 'u_owner')
    await seedVendor(db, 'u_other')
    await db.insert(users).values({ id: 'u_mine', email: 'mine@person.com' })
    await db.insert(users).values({ id: 'u_theirs', email: 'theirs@person.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_mine',
      role: 'guide',
      status: 'active',
    })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_other',
      memberUserId: 'u_theirs',
      role: 'guide',
      status: 'active',
    })

    const team = await loadVendorTeam(db, 'u_owner')
    expect(team).toHaveLength(1)
    expect(team[0]!.memberUserId).toBe('u_mine')
  })

  it('includes inactive members (they are shown, just denied by the gate)', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_m', email: 'm@person.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_m',
      role: 'guide',
      status: 'inactive',
    })

    const team = await loadVendorTeam(db, 'u_owner')
    expect(team).toHaveLength(1)
    expect(team[0]!.status).toBe('inactive')
  })

  it('returns an empty list for a vendor with no members', async () => {
    await seedVendor(db, 'u_owner')
    expect(await loadVendorTeam(db, 'u_owner')).toEqual([])
  })
})
