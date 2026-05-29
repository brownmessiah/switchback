import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'
import type { MeiliLike } from '@/lib/search/meilisearch-client'

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

  // ── Search indexing integration ──────────────────────────────────

  describe('Meilisearch indexing on moderation actions', () => {
    function spyMeili(): MeiliLike & {
      addedDocs: unknown[][]
      deletedIds: string[]
    } {
      const addedDocs: unknown[][] = []
      const deletedIds: string[] = []
      return {
        addedDocs,
        deletedIds,
        index: () => ({
          async addDocuments(docs: unknown[]) {
            addedDocs.push(docs)
            return { taskUid: null }
          },
          async deleteDocument(id: string) {
            deletedIds.push(id)
            return { taskUid: null }
          },
          async search() {
            return { hits: [] }
          },
        }),
      }
    }

    it('indexes experience after approve (pending_review → published)', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, {
        status: 'pending_review',
        slug: 'exp-index-test',
      })

      const meili = spyMeili()
      const result = await executeApproveExperience(db, adminId, {
        experienceId: expId,
      }, { searchClient: meili })

      expect(result).toEqual({ ok: true })
      expect(meili.addedDocs).toHaveLength(1)
      const indexed = meili.addedDocs[0]![0] as Record<string, unknown>
      expect(indexed['id']).toBe(expId)
      expect(indexed['slug']).toBe('exp-index-test')
      expect(indexed['title']).toBe('White Water Rafting')
    })

    it('does not index when approve fails (wrong status)', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, { status: 'draft' })

      const meili = spyMeili()
      await executeApproveExperience(db, adminId, {
        experienceId: expId,
      }, { searchClient: meili })

      expect(meili.addedDocs).toHaveLength(0)
    })

    it('deindexes experience after pause (published → paused)', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, { status: 'published' })

      const meili = spyMeili()
      const result = await executePauseExperience(db, adminId, {
        experienceId: expId,
      }, { searchClient: meili })

      expect(result).toEqual({ ok: true })
      expect(meili.deletedIds).toEqual([expId])
    })

    it('deindexes experience after archive (published → archived)', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, { status: 'published' })

      const meili = spyMeili()
      const result = await executeArchiveExperience(db, adminId, {
        experienceId: expId,
      }, { searchClient: meili })

      expect(result).toEqual({ ok: true })
      expect(meili.deletedIds).toEqual([expId])
    })

    it('deindexes experience after reject (pending_review → archived)', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, {
        status: 'pending_review',
      })

      const meili = spyMeili()
      const result = await executeRejectExperience(db, adminId, {
        experienceId: expId,
        reason: 'Safety violations.',
      }, { searchClient: meili })

      expect(result).toEqual({ ok: true })
      expect(meili.deletedIds).toEqual([expId])
    })

    it('does not deindex when pause fails (wrong status)', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, { status: 'draft' })

      const meili = spyMeili()
      await executePauseExperience(db, adminId, {
        experienceId: expId,
      }, { searchClient: meili })

      expect(meili.deletedIds).toHaveLength(0)
    })
  })

  // ── ADR-0007 Tier-2 cap enforcement at admin approve ─────────────
  describe('executeApproveExperience tier-cap enforcement (ADR-0007)', () => {
    async function addSlot(
      expId: string,
      opts: { capacity?: number; multiDay?: boolean } = {},
    ): Promise<void> {
      const startAt = new Date('2026-07-01T09:00:00.000Z')
      const endAt = opts.multiDay
        ? new Date('2026-07-04T17:00:00.000Z')
        : new Date('2026-07-01T17:00:00.000Z')
      await db.insert(availabilitySlots).values({
        experienceId: expId,
        startAt,
        endAt,
        capacity: opts.capacity ?? 8,
      })
    }

    it('approves an identity Vendor Experience within all Tier-2 caps', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, { status: 'pending_review' })
      await addSlot(expId, { capacity: 8 })

      const result = await executeApproveExperience(db, adminId, { experienceId: expId })
      expect(result).toEqual({ ok: true })

      const [exp] = await db
        .select({ status: experiences.status })
        .from(experiences)
        .where(eq(experiences.id, expId))
      expect(exp?.status).toBe('published')
    })

    it('blocks approval of an over-price Experience for an identity Vendor', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, { status: 'pending_review' })
      await db
        .update(experiences)
        .set({
          pricePerPerson_1_2: '5001.00',
          pricePerPerson_3_5: '5001.00',
          pricePerPerson_6_plus: '5001.00',
        })
        .where(eq(experiences.id, expId))

      const result = await executeApproveExperience(db, adminId, { experienceId: expId })
      expect(result.ok).toBe(false)

      // Status stays pending_review — not published.
      const [exp] = await db
        .select({ status: experiences.status })
        .from(experiences)
        .where(eq(experiences.id, expId))
      expect(exp?.status).toBe('pending_review')

      // A rejection audit row was written.
      const logs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'admin.experience.tier_cap_rejected'))
      expect(logs).toHaveLength(1)
      const payload = logs[0]?.payload as Record<string, unknown>
      expect(payload.code).toBe('PRICE_OVER_CAP')
    })

    it('blocks approval of a combo Experience for an identity Vendor', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, {
        status: 'pending_review',
      })
      await db
        .update(experiences)
        .set({
          isCombo: true,
          slug: 'combo-bundle-1',
          comboConstituents: [crypto.randomUUID(), crypto.randomUUID()],
        })
        .where(eq(experiences.id, expId))

      const result = await executeApproveExperience(db, adminId, { experienceId: expId })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/combo/i)
      }
    })

    it('blocks approval of a multi-day slot Experience for an identity Vendor', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, { status: 'pending_review' })
      await addSlot(expId, { multiDay: true })

      const result = await executeApproveExperience(db, adminId, { experienceId: expId })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/single-day|multi-day/i)
      }
    })

    it('blocks approval when a slot exceeds 8 participants for an identity Vendor', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const expId = await seedExperience(db, vendorId, { status: 'pending_review' })
      await addSlot(expId, { capacity: 9 })

      const result = await executeApproveExperience(db, adminId, { experienceId: expId })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/participants|slot/i)
      }
    })

    it('approves a business Vendor Experience regardless of caps', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      await db
        .update(vendorProfiles)
        .set({ kycTier: 'business' })
        .where(eq(vendorProfiles.userId, vendorId))
      const expId = await seedExperience(db, vendorId, {
        status: 'pending_review',
      })
      await db
        .update(experiences)
        .set({
          isCombo: true,
          slug: 'combo-mega-trek',
          comboConstituents: [crypto.randomUUID(), crypto.randomUUID()],
          pricePerPerson_1_2: '90000.00',
          pricePerPerson_3_5: '90000.00',
          pricePerPerson_6_plus: '90000.00',
        })
        .where(eq(experiences.id, expId))
      await addSlot(expId, { capacity: 40, multiDay: true })

      const result = await executeApproveExperience(db, adminId, { experienceId: expId })
      expect(result).toEqual({ ok: true })
    })
  })
})
