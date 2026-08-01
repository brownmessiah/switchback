import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { experiences } from '@/db/schema/experiences'
import { mediaAssets } from '@/db/schema/media-assets'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { executeSubmitExperienceForReview } from './submit-core'

/**
 * The `draft → pending_review` transition.
 *
 * This step did not exist. A Vendor's Experience was created as `draft`
 * (listings/new/create-core.ts) and nothing anywhere moved it on, while the
 * admin moderation queue only ever acts on `pending_review`. The publish
 * pipeline was therefore unreachable end to end: no Vendor-created listing
 * could be published by any UI.
 *
 * It is also literally half of the ADR-0007 Tier-2 gate, which requires "at
 * least one Experience submitted for admin review" — so a `phone`-tier Vendor
 * MUST be able to submit. Submitting is not publishing; the tier caps stay
 * where ADR-0007 puts them, at publish time.
 */

async function seedVendor(
  db: TestDB,
  userId: string,
  kycTier: 'phone' | 'identity' | 'business' = 'phone',
): Promise<void> {
  await db.insert(users).values({ id: userId, email: `${userId}@test.com` })
  await db.insert(vendorProfiles).values({
    userId,
    businessName: `Business ${userId}`,
    slug: `business-${userId}`,
    kycTier,
  })
}

/** A listing with every completeness-required field filled, plus one photo. */
async function seedCompleteDraft(
  db: TestDB,
  vendorUserId: string,
  overrides: { slug?: string; status?: 'draft' | 'pending_review' | 'published' } = {},
): Promise<string> {
  const [row] = await db
    .insert(experiences)
    .values({
      vendorUserId,
      slug: overrides.slug ?? 'complete-rafting',
      title: 'Ganga Rafting',
      shortDescription: 'A short teaser for the card.',
      longDescription: 'A long description for the product detail page body.',
      cancellationPreset: 'flexible',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: '1500',
      pricePerPerson_3_5: '1300',
      pricePerPerson_6_plus: '1100',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
      status: overrides.status ?? 'draft',
    })
    .returning({ id: experiences.id })

  await db.insert(mediaAssets).values({
    uploadedBy: vendorUserId,
    storageKey: `experiences/${row!.id}/1.jpg`,
    url: 'https://example.test/1.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 1024,
    entityType: 'experience',
    entityId: row!.id,
  })

  return row!.id
}

async function statusOf(db: TestDB, experienceId: string): Promise<string> {
  const [row] = await db
    .select({ status: experiences.status })
    .from(experiences)
    .where(eq(experiences.id, experienceId))
  return row!.status
}

describe('executeSubmitExperienceForReview', () => {
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
      sql`TRUNCATE TABLE audit_logs, media_assets, experiences, vendor_profiles, users CASCADE`,
    )
  })

  it('moves an owned complete draft to pending_review', async () => {
    await seedVendor(db, 'v_owner')
    const experienceId = await seedCompleteDraft(db, 'v_owner')

    const result = await executeSubmitExperienceForReview(db, 'v_owner', { experienceId })

    expect(result.ok).toBe(true)
    expect(await statusOf(db, experienceId)).toBe('pending_review')
  })

  it('lets a phone-tier Vendor submit — it is the ADR-0007 Tier-2 gate', async () => {
    await seedVendor(db, 'v_owner', 'phone')
    const experienceId = await seedCompleteDraft(db, 'v_owner')

    const result = await executeSubmitExperienceForReview(db, 'v_owner', { experienceId })

    expect(result.ok).toBe(true)
    expect(await statusOf(db, experienceId)).toBe('pending_review')
  })

  it('records the submission in the audit log', async () => {
    await seedVendor(db, 'v_owner')
    const experienceId = await seedCompleteDraft(db, 'v_owner')

    await executeSubmitExperienceForReview(db, 'v_owner', { experienceId })

    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'vendor.experience.submit'))
    expect(logs).toHaveLength(1)
    expect(logs[0]?.entityId).toBe(experienceId)
    expect(logs[0]?.actorUserId).toBe('v_owner')
  })

  it('attributes the audit row to the acting team member, not the shop', async () => {
    // Multi-seat (issue #11): ownership is keyed on the SHOP, but the audit
    // trail must name the human who actually clicked.
    await seedVendor(db, 'v_owner')
    await db.insert(users).values({ id: 'v_staff', email: 'staff@test.com' })
    const experienceId = await seedCompleteDraft(db, 'v_owner')

    await executeSubmitExperienceForReview(db, 'v_owner', { experienceId }, 'v_staff')

    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'vendor.experience.submit'))
    expect(logs[0]?.actorUserId).toBe('v_staff')
  })

  it('refuses an Experience owned by another Vendor', async () => {
    await seedVendor(db, 'v_owner')
    await seedVendor(db, 'v_attacker')
    const experienceId = await seedCompleteDraft(db, 'v_owner')

    const result = await executeSubmitExperienceForReview(db, 'v_attacker', { experienceId })

    expect(result.ok).toBe(false)
    expect(await statusOf(db, experienceId)).toBe('draft')
  })

  it('refuses an incomplete draft and names what is missing', async () => {
    await seedVendor(db, 'v_owner')
    // No photo, no descriptions — below 100% completeness.
    const [row] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'v_owner',
        slug: 'bare-draft',
        title: 'Bare Draft',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500',
        pricePerPerson_3_5: '1300',
        pricePerPerson_6_plus: '1100',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'draft',
      })
      .returning({ id: experiences.id })

    const result = await executeSubmitExperienceForReview(db, 'v_owner', {
      experienceId: row!.id,
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/complete/i)
    expect(await statusOf(db, row!.id)).toBe('draft')
  })

  it('is idempotent — resubmitting an already-queued Experience is a no-op', async () => {
    await seedVendor(db, 'v_owner')
    const experienceId = await seedCompleteDraft(db, 'v_owner', { status: 'pending_review' })

    const result = await executeSubmitExperienceForReview(db, 'v_owner', { experienceId })

    expect(result.ok).toBe(true)
    expect(await statusOf(db, experienceId)).toBe('pending_review')
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'vendor.experience.submit'))
    expect(logs).toHaveLength(0)
  })

  it('refuses to pull a published Experience back into review', async () => {
    await seedVendor(db, 'v_owner')
    const experienceId = await seedCompleteDraft(db, 'v_owner', { status: 'published' })

    const result = await executeSubmitExperienceForReview(db, 'v_owner', { experienceId })

    expect(result.ok).toBe(false)
    expect(await statusOf(db, experienceId)).toBe('published')
  })

  it('refuses an Experience that does not exist', async () => {
    await seedVendor(db, 'v_owner')

    const result = await executeSubmitExperienceForReview(db, 'v_owner', {
      experienceId: '00000000-0000-0000-0000-000000000000',
    })

    expect(result.ok).toBe(false)
  })
})
