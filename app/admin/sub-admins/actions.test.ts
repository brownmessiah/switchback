import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { adminProfiles } from '@/db/schema/admin-profiles'
import { auditLogs } from '@/db/schema/audit-logs'
import { subAdminInvites } from '@/db/schema/sub-admin-invites'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeInviteSubAdmin,
  executeEditPermissions,
  executeRevokeSubAdmin,
} from './actions'

// ── Test helpers ────────────────────────────────────────────────────

async function seedAdmin(db: TestDB, id: string, email: string): Promise<string> {
  await db.insert(users).values({ id, email })
  await db.insert(adminProfiles).values({
    userId: id,
    permissions: [
      'overview', 'analytics', 'vendors', 'experiences', 'bookings',
      'payouts', 'refunds', 'commission', 'region_closures', 'reviews',
      'support', 'blog', 'site_builder', 'audit', 'sub_admins', 'reports',
    ],
  })
  return id
}

async function seedUser(db: TestDB, id: string, email: string): Promise<string> {
  await db.insert(users).values({ id, email })
  return id
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Sub-admin management actions', () => {
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
      sql`TRUNCATE TABLE audit_logs, sub_admin_invites, admin_profiles, users CASCADE`,
    )
  })

  // ── Create sub-admin ──────────────────────────────────────────────

  describe('executeInviteSubAdmin', () => {
    it('creates admin_profiles row with specified permissions for existing user', async () => {
      const adminId = await seedAdmin(db, 'admin_1', 'admin@test.com')
      await seedUser(db, 'user_target', 'sub@test.com')

      const result = await executeInviteSubAdmin(db, adminId, {
        email: 'sub@test.com',
        permissions: ['vendors', 'bookings'],
      })

      expect(result.ok).toBe(true)

      // Verify admin_profiles row created
      const [profile] = await db
        .select()
        .from(adminProfiles)
        .where(eq(adminProfiles.userId, 'user_target'))

      expect(profile).toBeDefined()
      expect(profile!.permissions).toEqual(['vendors', 'bookings'])
      expect(profile!.invitedByUserId).toBe(adminId)
    })

    it('creates invite record marked as accepted for existing user', async () => {
      const adminId = await seedAdmin(db, 'admin_2', 'admin2@test.com')
      await seedUser(db, 'user_2', 'sub2@test.com')

      await executeInviteSubAdmin(db, adminId, {
        email: 'sub2@test.com',
        permissions: ['vendors'],
      })

      const invites = await db.select().from(subAdminInvites)
      expect(invites).toHaveLength(1)
      expect(invites[0]!.status).toBe('accepted')
      expect(invites[0]!.acceptedAt).not.toBeNull()
      expect(invites[0]!.email).toBe('sub2@test.com')
    })

    it('creates pending invite for non-existent user', async () => {
      const adminId = await seedAdmin(db, 'admin_3', 'admin3@test.com')

      const result = await executeInviteSubAdmin(db, adminId, {
        email: 'newuser@test.com',
        permissions: ['vendors', 'experiences'],
      })

      expect(result.ok).toBe(true)

      const invites = await db.select().from(subAdminInvites)
      expect(invites).toHaveLength(1)
      expect(invites[0]!.status).toBe('pending')
      expect(invites[0]!.acceptedAt).toBeNull()

      // No admin_profiles row for non-existent user
      const profiles = await db.select().from(adminProfiles).where(
        eq(adminProfiles.invitedByUserId, adminId),
      )
      // Only the inviting admin's own profile should exist
      expect(profiles).toHaveLength(0)
    })

    it('writes audit log on sub-admin creation', async () => {
      const adminId = await seedAdmin(db, 'admin_4', 'admin4@test.com')
      await seedUser(db, 'user_4', 'sub4@test.com')

      await executeInviteSubAdmin(db, adminId, {
        email: 'sub4@test.com',
        permissions: ['vendors'],
      })

      const logs = await db.select().from(auditLogs)
      const createLog = logs.find((l) => l.action === 'admin.sub_admin.create')
      expect(createLog).toBeDefined()
      expect(createLog!.actorUserId).toBe(adminId)
      expect(createLog!.entityType).toBe('admin_profile')
    })

    it('rejects duplicate admin access', async () => {
      const adminId = await seedAdmin(db, 'admin_5', 'admin5@test.com')
      await seedUser(db, 'user_5', 'sub5@test.com')
      await db.insert(adminProfiles).values({
        userId: 'user_5',
        permissions: ['vendors'],
      })

      const result = await executeInviteSubAdmin(db, adminId, {
        email: 'sub5@test.com',
        permissions: ['bookings'],
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('already has admin access')
      }
    })

    it('rejects empty permissions', async () => {
      const adminId = await seedAdmin(db, 'admin_6', 'admin6@test.com')

      const result = await executeInviteSubAdmin(db, adminId, {
        email: 'sub6@test.com',
        permissions: [],
      })

      expect(result.ok).toBe(false)
    })

    it('rejects invalid permission values', async () => {
      const adminId = await seedAdmin(db, 'admin_7', 'admin7@test.com')

      const result = await executeInviteSubAdmin(db, adminId, {
        email: 'sub7@test.com',
        permissions: ['vendors', 'nonexistent_perm'],
      })

      expect(result.ok).toBe(false)
    })

    it('rejects invalid email', async () => {
      const adminId = await seedAdmin(db, 'admin_8', 'admin8@test.com')

      const result = await executeInviteSubAdmin(db, adminId, {
        email: 'not-an-email',
        permissions: ['vendors'],
      })

      expect(result.ok).toBe(false)
    })
  })

  // ── Edit permissions ──────────────────────────────────────────────

  describe('executeEditPermissions', () => {
    it('updates permissions array', async () => {
      const adminId = await seedAdmin(db, 'admin_e1', 'admin-e1@test.com')
      await seedUser(db, 'user_e1', 'sub-e1@test.com')
      await db.insert(adminProfiles).values({
        userId: 'user_e1',
        permissions: ['vendors'],
        invitedByUserId: adminId,
      })

      const result = await executeEditPermissions(db, adminId, {
        userId: 'user_e1',
        permissions: ['vendors', 'bookings', 'payouts'],
      })

      expect(result.ok).toBe(true)

      const [updated] = await db
        .select()
        .from(adminProfiles)
        .where(eq(adminProfiles.userId, 'user_e1'))

      expect(updated!.permissions).toEqual(['vendors', 'bookings', 'payouts'])
    })

    it('permission edit persists and is verifiable', async () => {
      const adminId = await seedAdmin(db, 'admin_e2', 'admin-e2@test.com')
      await seedUser(db, 'user_e2', 'sub-e2@test.com')
      await db.insert(adminProfiles).values({
        userId: 'user_e2',
        permissions: ['vendors', 'bookings'],
        invitedByUserId: adminId,
      })

      // Edit to remove bookings, add payouts
      await executeEditPermissions(db, adminId, {
        userId: 'user_e2',
        permissions: ['vendors', 'payouts'],
      })

      const [profile] = await db
        .select()
        .from(adminProfiles)
        .where(eq(adminProfiles.userId, 'user_e2'))

      expect(profile!.permissions).toEqual(['vendors', 'payouts'])
      expect(profile!.permissions).not.toContain('bookings')
    })

    it('writes audit log with previous and new permissions', async () => {
      const adminId = await seedAdmin(db, 'admin_e3', 'admin-e3@test.com')
      await seedUser(db, 'user_e3', 'sub-e3@test.com')
      await db.insert(adminProfiles).values({
        userId: 'user_e3',
        permissions: ['vendors'],
        invitedByUserId: adminId,
      })

      await executeEditPermissions(db, adminId, {
        userId: 'user_e3',
        permissions: ['vendors', 'bookings'],
      })

      const logs = await db.select().from(auditLogs)
      const editLog = logs.find((l) => l.action === 'admin.sub_admin.edit_permissions')
      expect(editLog).toBeDefined()
      expect(editLog!.payload).toMatchObject({
        previousPermissions: ['vendors'],
        newPermissions: ['vendors', 'bookings'],
      })
    })

    it('returns error for non-existent admin profile', async () => {
      const adminId = await seedAdmin(db, 'admin_e4', 'admin-e4@test.com')

      const result = await executeEditPermissions(db, adminId, {
        userId: 'ghost_user',
        permissions: ['vendors'],
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('not found')
      }
    })
  })

  // ── Revoke access ─────────────────────────────────────────────────

  describe('executeRevokeSubAdmin', () => {
    it('removes admin_profiles row', async () => {
      const adminId = await seedAdmin(db, 'admin_r1', 'admin-r1@test.com')
      await seedUser(db, 'user_r1', 'sub-r1@test.com')
      await db.insert(adminProfiles).values({
        userId: 'user_r1',
        permissions: ['vendors', 'bookings'],
        invitedByUserId: adminId,
      })

      const result = await executeRevokeSubAdmin(db, adminId, 'user_r1')

      expect(result.ok).toBe(true)

      const profiles = await db
        .select()
        .from(adminProfiles)
        .where(eq(adminProfiles.userId, 'user_r1'))

      expect(profiles).toHaveLength(0)
    })

    it('updates related invite records to revoked', async () => {
      const adminId = await seedAdmin(db, 'admin_r2', 'admin-r2@test.com')
      await seedUser(db, 'user_r2', 'sub-r2@test.com')
      await db.insert(adminProfiles).values({
        userId: 'user_r2',
        permissions: ['vendors'],
        invitedByUserId: adminId,
      })
      await db.insert(subAdminInvites).values({
        email: 'sub-r2@test.com',
        permissions: ['vendors'],
        invitedByAdminId: adminId,
        token: 'test-token-r2',
        status: 'accepted',
        acceptedAt: new Date(),
      })

      await executeRevokeSubAdmin(db, adminId, 'user_r2')

      const invites = await db.select().from(subAdminInvites)
      expect(invites).toHaveLength(1)
      expect(invites[0]!.status).toBe('revoked')
    })

    it('writes audit log on revocation', async () => {
      const adminId = await seedAdmin(db, 'admin_r3', 'admin-r3@test.com')
      await seedUser(db, 'user_r3', 'sub-r3@test.com')
      await db.insert(adminProfiles).values({
        userId: 'user_r3',
        permissions: ['vendors'],
        invitedByUserId: adminId,
      })

      await executeRevokeSubAdmin(db, adminId, 'user_r3')

      const logs = await db.select().from(auditLogs)
      const revokeLog = logs.find((l) => l.action === 'admin.sub_admin.revoke')
      expect(revokeLog).toBeDefined()
      expect(revokeLog!.entityId).toBe('user_r3')
      expect(revokeLog!.payload).toMatchObject({
        previousPermissions: ['vendors'],
      })
    })

    it('prevents self-revocation', async () => {
      const adminId = await seedAdmin(db, 'admin_r4', 'admin-r4@test.com')

      const result = await executeRevokeSubAdmin(db, adminId, adminId)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('your own')
      }
    })

    it('returns error for non-existent admin profile', async () => {
      const adminId = await seedAdmin(db, 'admin_r5', 'admin-r5@test.com')

      const result = await executeRevokeSubAdmin(db, adminId, 'ghost_user')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('not found')
      }
    })
  })

  // ── Permission check: sub-admin blocked from unauthorized routes ──

  describe('Permission enforcement', () => {
    it('sub-admin with [vendors] cannot access payouts', async () => {
      // This test imports requirePermission directly to prove the
      // permission enforcement path works with sub-admin data.
      const { requirePermission } = await import('@/lib/auth/permissions')

      await seedUser(db, 'user_p1', 'sub-p1@test.com')
      await db.insert(adminProfiles).values({
        userId: 'user_p1',
        permissions: ['vendors'],
      })

      // Should pass for 'vendors'
      await expect(
        requirePermission(db, 'user_p1', 'vendors'),
      ).resolves.not.toThrow()

      // Should throw for 'payouts'
      await expect(
        requirePermission(db, 'user_p1', 'payouts'),
      ).rejects.toThrow()
    })

    it('sub-admin with [vendors, bookings, support] blocked from audit, sub_admins, reports', async () => {
      const { requirePermission } = await import('@/lib/auth/permissions')

      await seedUser(db, 'user_p2', 'sub-p2@test.com')
      await db.insert(adminProfiles).values({
        userId: 'user_p2',
        permissions: ['vendors', 'bookings', 'support'],
      })

      // Should pass
      await expect(requirePermission(db, 'user_p2', 'vendors')).resolves.not.toThrow()
      await expect(requirePermission(db, 'user_p2', 'bookings')).resolves.not.toThrow()
      await expect(requirePermission(db, 'user_p2', 'support')).resolves.not.toThrow()

      // Should block
      await expect(requirePermission(db, 'user_p2', 'audit')).rejects.toThrow()
      await expect(requirePermission(db, 'user_p2', 'sub_admins')).rejects.toThrow()
      await expect(requirePermission(db, 'user_p2', 'reports')).rejects.toThrow()
    })
  })
})
