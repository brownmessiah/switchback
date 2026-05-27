import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeApproveExperience,
  executeArchiveExperience,
  executePauseExperience,
  executeRejectExperience,
} from './actions'

// ── Test helpers ────────────────────────────────────────────────────

async function seedAdmin(db: TestDB): Promise<string> {
  const adminId = 'admin_exp_1'
  await db.insert(users).values({ id: adminId, email: 'admin-exp@test.com' })
  return adminId
}

async function seedVendor(db: TestDB): Promise<string> {
  const vendorId = 'vendor_exp_1'
  await db.insert(users).values({ id: vendorId, email: 'vendor-exp@test.com' })
  await db.insert(vendorProfiles).values({
    userId: vendorId,
    businessName: 'River Rafting Co',
    slug: 'river-rafting-co',
    kycTier: 'identity',
    commissionRate: '20.00',
  })
  return vendorId
}

async function seedExperience(
  db: TestDB,
  vendorId: string,
  overrides: {
    id?: string
    status?: 'draft' | 'pending_review' | 'published' | 'paused' | 'archived'
    slug?: string
  } = {},
): Promise<string> {
  const expId = overrides.id ?? crypto.randomUUID()
  await db.insert(experiences).values({
    id: expId,
    vendorUserId: vendorId,
    slug: overrides.slug ?? `exp-${expId.slice(0, 8)}`,
    title: 'White Water Rafting',
    status: overrides.status ?? 'draft',
    cancellationPreset: 'moderate',
    paymentModesAllowed: ['full_upfront'],
    pricePerPerson_1_2: '2500.00',
    pricePerPerson_3_5: '2000.00',
    pricePerPerson_6_plus: '1800.00',
    regionSlug: 'rishikesh',
    activitySlug: 'rafting',
  })
  return expId
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Admin experience moderation actions', () => {
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
      sql`TRUNCATE TABLE audit_logs, experiences, vendor_profiles, users CASCADE`,
    )
  })

  // ── Approve: pending_review → published ──────────────────────────

  describe('executeApproveExperience', () => {
    it('transitions pending_review → published and creates audit log', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, {
        status: 'pending_review',
      })

      const result = await executeApproveExperience(db, adminId, {
        experienceId: expId,
      })

      expect(result).toEqual({ ok: true })

      // Verify status updated
      const [exp] = await db
        .select({ status: experiences.status })
        .from(experiences)
        .where(eq(experiences.id, expId))
      expect(exp?.status).toBe('published')

      // Verify audit log
      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]?.action).toBe('admin.experience.approve')
      expect(logs[0]?.entityType).toBe('experience')
      expect(logs[0]?.entityId).toBe(expId)
      expect(logs[0]?.actorUserId).toBe(adminId)
      expect(logs[0]?.payload).toEqual({
        previousStatus: 'pending_review',
        newStatus: 'published',
      })
    })

    it('rejects approval of non-pending_review experience (draft)', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, { status: 'draft' })

      const result = await executeApproveExperience(db, adminId, {
        experienceId: expId,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('pending_review')
      }

      // Status should remain draft
      const [exp] = await db
        .select({ status: experiences.status })
        .from(experiences)
        .where(eq(experiences.id, expId))
      expect(exp?.status).toBe('draft')

      // No audit log
      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(0)
    })

    it('returns error for non-existent experience', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeApproveExperience(db, adminId, {
        experienceId: '00000000-0000-0000-0000-000000000000',
      })

      expect(result).toEqual({ ok: false, error: 'Experience not found.' })
    })
  })

  // ── Reject: pending_review → archived with reason ────────────────

  describe('executeRejectExperience', () => {
    it('transitions pending_review → archived with reason and creates audit log', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, {
        status: 'pending_review',
      })

      const result = await executeRejectExperience(db, adminId, {
        experienceId: expId,
        reason: 'Description contains misleading safety claims.',
      })

      expect(result).toEqual({ ok: true })

      // Verify status updated
      const [exp] = await db
        .select({ status: experiences.status })
        .from(experiences)
        .where(eq(experiences.id, expId))
      expect(exp?.status).toBe('archived')

      // Verify audit log
      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]?.action).toBe('admin.experience.reject')
      expect(logs[0]?.entityType).toBe('experience')
      expect(logs[0]?.entityId).toBe(expId)
      expect(logs[0]?.payload).toEqual({
        previousStatus: 'pending_review',
        newStatus: 'archived',
        reason: 'Description contains misleading safety claims.',
      })
    })

    it('requires reason text (rejects empty string)', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, {
        status: 'pending_review',
      })

      const result = await executeRejectExperience(db, adminId, {
        experienceId: expId,
        reason: '',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Reason is required')
      }

      // Status unchanged
      const [exp] = await db
        .select({ status: experiences.status })
        .from(experiences)
        .where(eq(experiences.id, expId))
      expect(exp?.status).toBe('pending_review')
    })

    it('rejects rejection of draft experience', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, { status: 'draft' })

      const result = await executeRejectExperience(db, adminId, {
        experienceId: expId,
        reason: 'Some reason.',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('pending_review')
      }
    })
  })

  // ── Pause: published → paused ────────────────────────────────────

  describe('executePauseExperience', () => {
    it('transitions published → paused and creates audit log', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, {
        status: 'published',
      })

      const result = await executePauseExperience(db, adminId, {
        experienceId: expId,
      })

      expect(result).toEqual({ ok: true })

      const [exp] = await db
        .select({ status: experiences.status })
        .from(experiences)
        .where(eq(experiences.id, expId))
      expect(exp?.status).toBe('paused')

      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]?.action).toBe('admin.experience.pause')
      expect(logs[0]?.payload).toEqual({
        previousStatus: 'published',
        newStatus: 'paused',
      })
    })

    it('rejects pause of draft experience', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, { status: 'draft' })

      const result = await executePauseExperience(db, adminId, {
        experienceId: expId,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('published')
      }
    })
  })

  // ── Archive: published → archived ────────────────────────────────

  describe('executeArchiveExperience', () => {
    it('transitions published → archived and creates audit log', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, {
        status: 'published',
      })

      const result = await executeArchiveExperience(db, adminId, {
        experienceId: expId,
      })

      expect(result).toEqual({ ok: true })

      const [exp] = await db
        .select({ status: experiences.status })
        .from(experiences)
        .where(eq(experiences.id, expId))
      expect(exp?.status).toBe('archived')

      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]?.action).toBe('admin.experience.archive')
      expect(logs[0]?.payload).toEqual({
        previousStatus: 'published',
        newStatus: 'archived',
      })
    })

    it('also allows archiving a paused experience', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, { status: 'paused' })

      const result = await executeArchiveExperience(db, adminId, {
        experienceId: expId,
      })

      expect(result).toEqual({ ok: true })

      const [exp] = await db
        .select({ status: experiences.status })
        .from(experiences)
        .where(eq(experiences.id, expId))
      expect(exp?.status).toBe('archived')
    })

    it('rejects archiving a draft experience', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, { status: 'draft' })

      const result = await executeArchiveExperience(db, adminId, {
        experienceId: expId,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('published')
      }
    })
  })
})
