import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { executeCreateVendorProfile } from './onboarding-core'

describe('executeCreateVendorProfile', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_onb_new', email: 'onb-new@test.com', name: 'New Vendor' },
      { id: 'u_onb_pan', email: 'onb-pan@test.com', name: 'PAN Vendor' },
      { id: 'u_onb_existing', email: 'onb-existing@test.com', name: 'Existing Vendor' },
      { id: 'u_onb_conflict', email: 'onb-conflict@test.com', name: 'Conflict Vendor' },
      { id: 'u_onb_reopen', email: 'onb-reopen@test.com', name: 'Reopening Vendor' },
    ])

    // A vendor that already holds the slug we will test the conflict against.
    await db.insert(vendorProfiles).values({
      userId: 'u_onb_existing',
      businessName: 'Existing Co',
      slug: 'taken-slug',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    // Remove any profiles created by the happy-path / PAN tests so each
    // test runs against a clean "no profile yet" state for u_onb_new / _pan.
    await db.delete(vendorProfiles).where(eq(vendorProfiles.userId, 'u_onb_new'))
    await db.delete(vendorProfiles).where(eq(vendorProfiles.userId, 'u_onb_pan'))
    await db.delete(vendorProfiles).where(eq(vendorProfiles.userId, 'u_onb_conflict'))
  })

  // ── Happy path ────────────────────────────────────────────────────
  it('creates a vendor profile at kyc_tier="phone" with required fields', async () => {
    const result = await executeCreateVendorProfile(db, 'u_onb_new', {
      businessName: 'Himalayan Adventures',
      slug: 'himalayan-adventures',
      pan: null,
      about: null,
    })

    expect(result).toEqual({ ok: true })

    const [row] = await db
      .select()
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_onb_new'))
      .limit(1)

    expect(row).toBeDefined()
    expect(row.businessName).toBe('Himalayan Adventures')
    expect(row.slug).toBe('himalayan-adventures')
    // ADR-0007: a freshly-onboarded vendor is ALWAYS phone tier.
    expect(row.kycTier).toBe('phone')
  })

  // ── Defect regression: PAN must NOT self-promote to identity ────────
  it('stays at kyc_tier="phone" even when a PAN is supplied (no self-promotion)', async () => {
    // ADR-0007: Tier 2 (identity) requires Aadhaar OTP + PAN + an Experience
    // submitted AND admin manual review. Submitting a PAN string at onboarding
    // must NOT bypass that and self-promote the vendor.
    const result = await executeCreateVendorProfile(db, 'u_onb_pan', {
      businessName: 'PAN Tester',
      slug: 'pan-tester',
      pan: 'ABCDE1234F',
      about: null,
    })

    expect(result).toEqual({ ok: true })

    const [row] = await db
      .select()
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_onb_pan'))
      .limit(1)

    expect(row.kycTier).toBe('phone')
    // The PAN is still captured as evidence for the later admin review.
    expect(row.pan).toBe('ABCDE1234F')
  })

  // ── Field-specific validation ───────────────────────────────────────
  it('rejects a missing business name with a field-specific error', async () => {
    const result = await executeCreateVendorProfile(db, 'u_onb_new', {
      businessName: '   ',
      slug: 'some-slug',
      pan: null,
      about: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/business name/i)
    }
  })

  it('rejects a missing slug with a field-specific error', async () => {
    const result = await executeCreateVendorProfile(db, 'u_onb_new', {
      businessName: 'Valid Name',
      slug: '',
      pan: null,
      about: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/slug|profile url/i)
    }
  })

  it('rejects an invalid slug format with a slug-specific error', async () => {
    const result = await executeCreateVendorProfile(db, 'u_onb_new', {
      businessName: 'Valid Name',
      slug: 'Has Spaces & Caps',
      pan: null,
      about: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/slug/i)
    }
  })

  it('rejects an invalid PAN format with a PAN-specific error', async () => {
    const result = await executeCreateVendorProfile(db, 'u_onb_new', {
      businessName: 'Valid Name',
      slug: 'valid-name',
      pan: 'not-a-pan',
      about: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/pan/i)
    }
  })

  // ── Slug uniqueness ─────────────────────────────────────────────────
  it('rejects a duplicate slug with a slug-taken error', async () => {
    const result = await executeCreateVendorProfile(db, 'u_onb_conflict', {
      businessName: 'Another Co',
      slug: 'taken-slug',
      pan: null,
      about: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/taken|already/i)
    }

    // No partial row should be written for the conflicting vendor.
    const rows = await db
      .select()
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_onb_conflict'))

    expect(rows).toHaveLength(0)
  })

  // ── Reactivation (issue 06 — honors reversible soft-close) ──────────
  it('re-onboarding a closed vendor clears closedAt and restores access', async () => {
    // A previously-closed Vendor (closed_at + reason set). Re-onboarding must
    // reactivate the existing row keyed by userId, NOT violate the PK / fail.
    await db.insert(vendorProfiles).values({
      userId: 'u_onb_reopen',
      businessName: 'Old Business',
      slug: 'reopen-slug',
      closedAt: new Date(),
      closureReason: 'took a break',
    })

    const result = await executeCreateVendorProfile(db, 'u_onb_reopen', {
      businessName: 'Reopened Business',
      slug: 'reopen-slug',
      pan: null,
      about: 'Back in business.',
    })

    expect(result).toEqual({ ok: true })

    const [row] = await db
      .select()
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_onb_reopen'))
      .limit(1)

    // Reactivated: closed_at + reason cleared so requireVendorProfile passes again.
    expect(row.closedAt).toBeNull()
    expect(row.closureReason).toBeNull()
    // The new business details overwrite the old ones on reactivation.
    expect(row.businessName).toBe('Reopened Business')
    expect(row.about).toBe('Back in business.')
  })
})
