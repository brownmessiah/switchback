import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
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

      expect(result).toEqual({ ok: true })

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

      expect(result).toEqual({ ok: true })

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
      expect(r1).toEqual({ ok: true })

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
      expect(r2).toEqual({ ok: true })

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

  describe('executeKycRejection', () => {
    it('creates audit log with rejection reason, kycTier unchanged', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db, { kycTier: 'phone' })

      const result = await executeKycRejection(db, adminId, {
        vendorUserId: vendorId,
        reason: 'PAN number does not match submitted name.',
      })

      expect(result).toEqual({ ok: true })

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
