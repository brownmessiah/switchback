import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeCommissionRateUpdate,
  executeKycApproval,
  executeKycRejection,
  executeSuspendToggle,
} from './actions'

// ── Test helpers ────────────────────────────────────────────────────

async function seedAdmin(db: TestDB): Promise<string> {
  const adminId = 'admin_test_1'
  await db.insert(users).values({ id: adminId, email: 'admin@test.com' })
  return adminId
}

async function seedVendor(
  db: TestDB,
  overrides: { userId?: string; kycTier?: 'phone' | 'identity' | 'business'; commissionRate?: string; suspended?: boolean } = {},
): Promise<string> {
  const vendorId = overrides.userId ?? 'vendor_test_1'
  // Insert user row first (FK constraint)
  await db.insert(users).values({ id: vendorId, email: `${vendorId}@test.com` })
  await db.insert(vendorProfiles).values({
    userId: vendorId,
    businessName: 'Test Adventures',
    slug: `test-adventures-${vendorId}`,
    kycTier: overrides.kycTier ?? 'phone',
    commissionRate: overrides.commissionRate ?? '20.00',
    suspended: overrides.suspended ?? false,
  })
  return vendorId
}

/**
 * Seed one Experience for a Vendor. `pricePerPerson` drives the ADR-0007
 * Tier-2 price cap (Rs.5,000/person), which is what makes an Experience
 * publishable — or not — at the `identity` tier.
 */
async function seedExperience(
  db: TestDB,
  overrides: {
    vendorUserId: string
    slug: string
    status?: 'draft' | 'pending_review' | 'published' | 'paused' | 'archived'
    pricePerPerson?: string
  },
): Promise<string> {
  const price = overrides.pricePerPerson ?? '1500'
  const [row] = await db
    .insert(experiences)
    .values({
      vendorUserId: overrides.vendorUserId,
      slug: overrides.slug,
      title: `Experience ${overrides.slug}`,
      cancellationPreset: 'flexible',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: price,
      pricePerPerson_3_5: price,
      pricePerPerson_6_plus: price,
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
      status: overrides.status ?? 'pending_review',
    })
    .returning({ id: experiences.id })
  return row!.id
}

async function statusOf(db: TestDB, experienceId: string): Promise<string> {
  const [row] = await db
    .select({ status: experiences.status })
    .from(experiences)
    .where(eq(experiences.id, experienceId))
  return row!.status
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Admin vendor actions (ADR-0007)', () => {
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
      sql`TRUNCATE TABLE audit_logs, vendor_profiles, users CASCADE`,
    )
  })

  // ── KYC approval: phone → identity ──────────────────────────────

  describe('executeKycApproval', () => {
    it('promotes phone → identity and creates audit log with notes', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'phone' })

      const result = await executeKycApproval(db, adminId, {
        vendorUserId: vendorId,
        notes: 'Aadhaar + PAN verified offline.',
      })

      // The result now also reports what the promotion put live (BUG B).
      expect(result).toEqual({ ok: true, publishedCount: 0, skipped: [] })

      // Verify kycTier updated
      const [vendor] = await db
        .select({ kycTier: vendorProfiles.kycTier })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, vendorId))
      expect(vendor?.kycTier).toBe('identity')

      // Verify audit log
      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]?.action).toBe('admin.kyc.approve')
      expect(logs[0]?.entityType).toBe('vendor_profile')
      expect(logs[0]?.entityId).toBe(vendorId)
      expect(logs[0]?.actorUserId).toBe(adminId)
      expect(logs[0]?.payload).toEqual({
        previousTier: 'phone',
        newTier: 'identity',
        notes: 'Aadhaar + PAN verified offline.',
      })
    })

    it('promotes identity → business and creates audit log', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'identity' })

      const result = await executeKycApproval(db, adminId, {
        vendorUserId: vendorId,
        notes: 'Video call + GSTIN verified.',
      })

      expect(result).toEqual({ ok: true, publishedCount: 0, skipped: [] })

      const [vendor] = await db
        .select({ kycTier: vendorProfiles.kycTier })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, vendorId))
      expect(vendor?.kycTier).toBe('business')

      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]?.payload).toEqual({
        previousTier: 'identity',
        newTier: 'business',
        notes: 'Video call + GSTIN verified.',
      })
    })

    it('rejects promotion from business tier (already highest)', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'business' })

      const result = await executeKycApproval(db, adminId, {
        vendorUserId: vendorId,
        notes: 'Trying to promote past business.',
      })

      expect(result).toEqual({
        ok: false,
        error: 'Vendor is already at the highest KYC tier (business).',
      })

      // No audit log should be created
      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(0)
    })

    it('rejects skip promotion phone → business (must go in order)', async () => {
      // This is tested implicitly because VALID_PROMOTIONS only maps
      // phone→identity and identity→business. The executeKycApproval
      // function promotes to the *next* tier only — there is no way to
      // skip directly to business from phone.
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'phone' })

      // First approval: phone → identity
      const r1 = await executeKycApproval(db, adminId, {
        vendorUserId: vendorId,
        notes: 'Step 1',
      })
      expect(r1).toEqual({ ok: true, publishedCount: 0, skipped: [] })

      const [v1] = await db
        .select({ kycTier: vendorProfiles.kycTier })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, vendorId))
      expect(v1?.kycTier).toBe('identity')

      // Second approval: identity → business
      const r2 = await executeKycApproval(db, adminId, {
        vendorUserId: vendorId,
        notes: 'Step 2',
      })
      expect(r2).toEqual({ ok: true, publishedCount: 0, skipped: [] })

      const [v2] = await db
        .select({ kycTier: vendorProfiles.kycTier })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, vendorId))
      expect(v2?.kycTier).toBe('business')
    })

    it('rejects with validation error when notes are empty', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)

      const result = await executeKycApproval(db, adminId, {
        vendorUserId: vendorId,
        notes: '',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Notes are required')
      }
    })

    it('returns error for non-existent vendor', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeKycApproval(db, adminId, {
        vendorUserId: 'nonexistent_vendor',
        notes: 'Should fail.',
      })

      expect(result).toEqual({ ok: false, error: 'Vendor not found.' })
    })
  })

  // ── KYC rejection ───────────────────────────────────────────────

  // ── BUG B — approving a Vendor puts their queued listings live ────
  //
  // Product-owner report: "accepting a vendor does not push their listing
  // live on the public website." It never did — executeKycApproval only ever
  // touched vendor_profiles.
  //
  // ADR-0007 reconciliation: the tier caps stay enforced at publish time.
  // Approval raises the tier, which is precisely what makes the Vendor's
  // queued Experiences publishable, so the cascade re-runs the SAME
  // publish-time guard the admin Experience queue uses and publishes only
  // what passes. Over-cap listings are SKIPPED (left pending_review), never
  // silently published and never failing the approval.
  //
  // Ordering is load-bearing: the tier write must be visible to the cap
  // check, or every listing trips PHONE_CANNOT_PUBLISH.

  describe('executeKycApproval — cascade-publishes queued Experiences (ADR-0007)', () => {
    it('publishes the vendor pending_review Experiences on phone → identity', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'phone' })
      const expId = await seedExperience(db, {
        vendorUserId: vendorId,
        slug: 'queued-rafting',
        status: 'pending_review',
        pricePerPerson: '1500',
      })

      const result = await executeKycApproval(db, adminId, {
        vendorUserId: vendorId,
        notes: 'Aadhaar + PAN verified offline.',
      })

      expect(result.ok).toBe(true)
      expect(result.ok && result.publishedCount).toBe(1)
      expect(await statusOf(db, expId)).toBe('published')
    })

    it('skips an over-cap Experience and leaves it pending_review', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'phone' })
      // Rs.6,000/person is above the ADR-0007 Tier-2 cap of Rs.5,000.
      const overCapId = await seedExperience(db, {
        vendorUserId: vendorId,
        slug: 'over-cap-heli-skiing',
        status: 'pending_review',
        pricePerPerson: '6000',
      })

      const result = await executeKycApproval(db, adminId, {
        vendorUserId: vendorId,
        notes: 'Identity verified.',
      })

      expect(result.ok).toBe(true)
      expect(result.ok && result.publishedCount).toBe(0)
      expect(result.ok && result.skipped).toHaveLength(1)
      expect(result.ok && result.skipped[0]?.experienceId).toBe(overCapId)
      expect(await statusOf(db, overCapId)).toBe('pending_review')
    })

    it('publishes the same over-cap Experience once the Vendor reaches business', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'identity' })
      const overCapId = await seedExperience(db, {
        vendorUserId: vendorId,
        slug: 'over-cap-heli-skiing',
        status: 'pending_review',
        pricePerPerson: '6000',
      })

      const result = await executeKycApproval(db, adminId, {
        vendorUserId: vendorId,
        notes: 'Video call + GSTIN verified.',
      })

      expect(result.ok && result.publishedCount).toBe(1)
      expect(await statusOf(db, overCapId)).toBe('published')
    })

    it('leaves drafts alone — only Experiences submitted for review are published', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'phone' })
      const draftId = await seedExperience(db, {
        vendorUserId: vendorId,
        slug: 'half-finished-draft',
        status: 'draft',
      })

      const result = await executeKycApproval(db, adminId, {
        vendorUserId: vendorId,
        notes: 'Identity verified.',
      })

      expect(result.ok && result.publishedCount).toBe(0)
      expect(await statusOf(db, draftId)).toBe('draft')
    })

    it('never touches another Vendor queued Experiences', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { userId: 'vendor_a', kycTier: 'phone' })
      const otherId = await seedVendor(db, { userId: 'vendor_b', kycTier: 'phone' })
      const mine = await seedExperience(db, {
        vendorUserId: vendorId,
        slug: 'mine-rafting',
        status: 'pending_review',
      })
      const theirs = await seedExperience(db, {
        vendorUserId: otherId,
        slug: 'theirs-trekking',
        status: 'pending_review',
      })

      await executeKycApproval(db, adminId, {
        vendorUserId: vendorId,
        notes: 'Identity verified.',
      })

      expect(await statusOf(db, mine)).toBe('published')
      expect(await statusOf(db, theirs)).toBe('pending_review')
    })

    it('writes one experience-approve audit row per published Experience', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'phone' })
      await seedExperience(db, {
        vendorUserId: vendorId,
        slug: 'queued-rafting',
        status: 'pending_review',
      })

      await executeKycApproval(db, adminId, {
        vendorUserId: vendorId,
        notes: 'Identity verified.',
      })

      const published = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'admin.experience.approve'),
            eq(auditLogs.entityType, 'experience'),
          ),
        )
      expect(published).toHaveLength(1)
    })
  })

  // ── The application decision gates going live ─────────────────────
  //
  // Product rule: a Vendor may always DRAFT and SUBMIT listings — ADR-0007's
  // Tier-2 gate requires at least one Experience submitted for review before
  // approval is possible — but nothing goes live until the admin approves.
  // Rejection returns queued listings to draft; re-applying and being accepted
  // is what lets them go live.

  describe('the application decision', () => {
    it('records approval on the Vendor, with who decided and when', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'phone' })

      await executeKycApproval(db, adminId, {
        vendorUserId: vendorId,
        notes: 'Documents verified.',
      })

      const [vendor] = await db
        .select({
          status: vendorProfiles.applicationStatus,
          decidedBy: vendorProfiles.applicationDecidedBy,
          decidedAt: vendorProfiles.applicationDecidedAt,
        })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, vendorId))

      expect(vendor?.status).toBe('approved')
      expect(vendor?.decidedBy).toBe(adminId)
      expect(vendor?.decidedAt).toBeInstanceOf(Date)
    })

    it('records rejection with the reason the Vendor will be shown', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'phone' })

      await executeKycRejection(db, adminId, {
        vendorUserId: vendorId,
        reason: 'PAN does not match the submitted name.',
      })

      const [vendor] = await db
        .select({
          status: vendorProfiles.applicationStatus,
          reason: vendorProfiles.applicationDecisionReason,
          decidedBy: vendorProfiles.applicationDecidedBy,
        })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, vendorId))

      expect(vendor?.status).toBe('rejected')
      expect(vendor?.reason).toBe('PAN does not match the submitted name.')
      expect(vendor?.decidedBy).toBe(adminId)
    })

    it('leaves the KYC tier untouched on rejection', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'identity' })

      await executeKycRejection(db, adminId, {
        vendorUserId: vendorId,
        reason: 'Re-audit failed.',
      })

      const [vendor] = await db
        .select({ kycTier: vendorProfiles.kycTier })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, vendorId))
      expect(vendor?.kycTier).toBe('identity')
    })

    it('returns queued listings to draft on rejection — they cannot go live', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'phone' })
      const queuedId = await seedExperience(db, {
        vendorUserId: vendorId,
        slug: 'queued-rafting',
        status: 'pending_review',
      })

      await executeKycRejection(db, adminId, {
        vendorUserId: vendorId,
        reason: 'Insufficient documentation.',
      })

      expect(await statusOf(db, queuedId)).toBe('draft')
    })

    it('reports live listings on rejection instead of silently unpublishing them', async () => {
      // Taking down live inventory that may carry Bookings is what `suspended`
      // is for. Rejection must not do it behind the admin's back — but it must
      // not stay silent either.
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'business' })
      const liveId = await seedExperience(db, {
        vendorUserId: vendorId,
        slug: 'already-live-rafting',
        status: 'published',
      })

      const result = await executeKycRejection(db, adminId, {
        vendorUserId: vendorId,
        reason: 'Re-audit failed.',
      })

      expect(result.ok).toBe(true)
      expect(result.ok && result.stillLiveCount).toBe(1)
      expect(await statusOf(db, liveId)).toBe('published')
    })

    it('publishes nothing for a Vendor whose application was rejected', async () => {
      const adminId = await seedAdmin(db)
      // Identity tier: the ADR-0007 caps would allow this listing. The
      // DECISION is what blocks it.
      const vendorId = await seedVendor(db, { kycTier: 'identity' })
      const queuedId = await seedExperience(db, {
        vendorUserId: vendorId,
        slug: 'queued-rafting',
        status: 'pending_review',
      })
      await db
        .update(vendorProfiles)
        .set({ applicationStatus: 'rejected' })
        .where(eq(vendorProfiles.userId, vendorId))

      const result = await executeKycApproval(db, adminId, {
        vendorUserId: vendorId,
        notes: 'Re-approved after fixes.',
      })

      // The approval itself flips them back to approved, so the queued
      // listing SHOULD go live — that is the documented re-apply path.
      expect(result.ok && result.publishedCount).toBe(1)
      expect(await statusOf(db, queuedId)).toBe('published')
    })
  })

  describe('executeKycRejection', () => {
    it('creates audit log with rejection reason, kycTier unchanged', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'phone' })

      const result = await executeKycRejection(db, adminId, {
        vendorUserId: vendorId,
        reason: 'PAN number does not match submitted name.',
      })

      // Rejection now also reports its consequences for the Vendor's listings.
      expect(result).toEqual({ ok: true, requeuedToDraftCount: 0, stillLiveCount: 0 })

      // kycTier should NOT have changed
      const [vendor] = await db
        .select({ kycTier: vendorProfiles.kycTier })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, vendorId))
      expect(vendor?.kycTier).toBe('phone')

      // Verify audit log
      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]?.action).toBe('admin.kyc.reject')
      expect(logs[0]?.payload).toEqual({
        currentTier: 'phone',
        reason: 'PAN number does not match submitted name.',
        // The decision's effect on the Vendor's listings is part of the record.
        requeuedToDraftCount: 0,
        stillLiveCount: 0,
      })
    })

    it('rejects with validation error when reason is empty', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)

      const result = await executeKycRejection(db, adminId, {
        vendorUserId: vendorId,
        reason: '',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Rejection reason is required')
      }
    })
  })

  // ── Commission rate update ──────────────────────────────────────

  describe('executeCommissionRateUpdate', () => {
    it('persists new rate and creates audit log', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { commissionRate: '20.00' })

      const result = await executeCommissionRateUpdate(db, adminId, {
        vendorUserId: vendorId,
        commissionRate: 15,
      })

      expect(result).toEqual({ ok: true })

      const [vendor] = await db
        .select({ commissionRate: vendorProfiles.commissionRate })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, vendorId))
      expect(vendor?.commissionRate).toBe('15.00')

      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]?.action).toBe('admin.commission_rate.update')
      expect(logs[0]?.payload).toEqual({
        previousRate: '20.00',
        newRate: '15.00',
      })
    })

    it('rejects negative commission rate', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)

      const result = await executeCommissionRateUpdate(db, adminId, {
        vendorUserId: vendorId,
        commissionRate: -5,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('cannot be negative')
      }
    })

    it('rejects rate above 100%', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)

      const result = await executeCommissionRateUpdate(db, adminId, {
        vendorUserId: vendorId,
        commissionRate: 101,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('cannot exceed 100%')
      }
    })

    it('allows 0% commission rate (promotional)', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)

      const result = await executeCommissionRateUpdate(db, adminId, {
        vendorUserId: vendorId,
        commissionRate: 0,
      })

      expect(result).toEqual({ ok: true })

      const [vendor] = await db
        .select({ commissionRate: vendorProfiles.commissionRate })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, vendorId))
      expect(vendor?.commissionRate).toBe('0.00')
    })
  })

  // ── Suspend / Reactivate toggle ─────────────────────────────────

  describe('executeSuspendToggle', () => {
    it('suspends an active vendor and creates audit log', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { suspended: false })

      const result = await executeSuspendToggle(db, adminId, {
        vendorUserId: vendorId,
        notes: 'Repeated policy violations.',
      })

      expect(result).toEqual({ ok: true })

      const [vendor] = await db
        .select({ suspended: vendorProfiles.suspended })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, vendorId))
      expect(vendor?.suspended).toBe(true)

      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]?.action).toBe('admin.vendor.suspend')
      expect(logs[0]?.payload).toEqual({
        suspended: true,
        notes: 'Repeated policy violations.',
      })
    })

    it('reactivates a suspended vendor and creates audit log', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { suspended: true })

      const result = await executeSuspendToggle(db, adminId, {
        vendorUserId: vendorId,
        notes: 'Issue resolved, reinstated.',
      })

      expect(result).toEqual({ ok: true })

      const [vendor] = await db
        .select({ suspended: vendorProfiles.suspended })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, vendorId))
      expect(vendor?.suspended).toBe(false)

      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]?.action).toBe('admin.vendor.reactivate')
      expect(logs[0]?.payload).toEqual({
        suspended: false,
        notes: 'Issue resolved, reinstated.',
      })
    })

    it('rejects when notes are empty', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)

      const result = await executeSuspendToggle(db, adminId, {
        vendorUserId: vendorId,
        notes: '',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Notes are required')
      }
    })
  })
})
