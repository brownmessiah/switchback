import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { mediaAssets } from '@/db/schema/media-assets'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeDeleteExperienceImage,
  executeUploadExperienceImage,
} from './update-core'

/**
 * Image cores — the issue #11 §5 two-id split + the MANDATORY #18
 * image-ownership fix.
 *
 *  - Ownership of an Experience's image is keyed on the PARENT Experience's
 *    `vendorUserId` (= shop), NOT on `media_assets.uploadedBy`. Otherwise a
 *    member could only delete the owner's images and vice-versa — a real bug.
 *  - `uploadedBy` records the acting HUMAN (audit), while ownership uses the
 *    shop (scope).
 *
 * Storage is mocked: the LocalFileAdapter's `delete`/`upload` are stubbed so the
 * cores' DB authorization is exercised without touching the filesystem.
 */

vi.mock('@/lib/storage/local', () => ({
  LocalFileAdapter: class {
    async upload(_file: File, key: string) {
      return { url: `/uploads/${key}`, storageKey: key }
    }
    async delete() {
      return
    }
  },
}))

describe('image cores — #18 ownership fix + §5 audit split (issue #11)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let expA: string

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
      sql`TRUNCATE TABLE media_assets, experiences, vendor_team_members, vendor_profiles, users CASCADE`,
    )
    // Shop A owner + a Manager member who acts on shop A. Plus an unrelated shop B.
    await db.insert(users).values([
      { id: 'u_owner_a', email: 'a@test.com' },
      { id: 'u_mgr_a', email: 'mgr@test.com' },
      { id: 'u_owner_b', email: 'b@test.com' },
    ])
    await db.insert(vendorProfiles).values([
      { userId: 'u_owner_a', businessName: 'Shop A', slug: 'shop-a' },
      { userId: 'u_owner_b', businessName: 'Shop B', slug: 'shop-b' },
    ])
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_owner_a',
        slug: 'exp-a',
        title: 'Exp A',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500',
        pricePerPerson_3_5: '1300',
        pricePerPerson_6_plus: '1100',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    expA = exp!.id
  })

  function fakeImage(): File {
    return new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' })
  }

  it('upload records uploadedBy = acting human, ownership keyed on shop', async () => {
    // shop = u_owner_a, acting = the manager. Ownership passes (shop owns expA),
    // uploadedBy records the human.
    const result = await executeUploadExperienceImage(
      db,
      'u_owner_a',
      { file: fakeImage(), experienceId: expA },
      'u_mgr_a',
    )
    expect(result.ok).toBe(true)

    const [asset] = await db
      .select({ uploadedBy: mediaAssets.uploadedBy })
      .from(mediaAssets)
      .where(eq(mediaAssets.entityId, expA))
    expect(asset?.uploadedBy).toBe('u_mgr_a')
  })

  it('upload denies when the shop does NOT own the experience (cross-shop)', async () => {
    // shop = u_owner_b (does NOT own expA) → denied.
    const result = await executeUploadExperienceImage(
      db,
      'u_owner_b',
      { file: fakeImage(), experienceId: expA },
      'u_owner_b',
    )
    expect(result.ok).toBe(false)
  })

  it('#18 MANDATORY: the owner can delete an image uploaded by a MEMBER (ownership = parent experience shop, NOT uploadedBy)', async () => {
    // The Manager uploads the image (uploadedBy = u_mgr_a, ≠ the shop owner).
    const up = await executeUploadExperienceImage(
      db,
      'u_owner_a',
      { file: fakeImage(), experienceId: expA },
      'u_mgr_a',
    )
    expect(up.ok).toBe(true)
    const [asset] = await db
      .select({ id: mediaAssets.id, uploadedBy: mediaAssets.uploadedBy })
      .from(mediaAssets)
      .where(eq(mediaAssets.entityId, expA))
    expect(asset?.uploadedBy).toBe('u_mgr_a')

    // The Owner (shop = u_owner_a) deletes the MEMBER's image. The OLD code
    // keyed on `uploadedBy === userId` and would DENY this (u_mgr_a ≠ u_owner_a);
    // the fix keys on the parent experience's shop, so it succeeds.
    const del = await executeDeleteExperienceImage(db, 'u_owner_a', asset!.id)
    expect(del.ok).toBe(true)

    const remaining = await db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, asset!.id))
    expect(remaining).toHaveLength(0)
  })

  it('#18: delete denies when the acting shop does NOT own the parent experience (cross-shop)', async () => {
    const up = await executeUploadExperienceImage(
      db,
      'u_owner_a',
      { file: fakeImage(), experienceId: expA },
      'u_owner_a',
    )
    expect(up.ok).toBe(true)
    const [asset] = await db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(eq(mediaAssets.entityId, expA))

    // shop B does not own expA → delete denied.
    const del = await executeDeleteExperienceImage(db, 'u_owner_b', asset!.id)
    expect(del.ok).toBe(false)

    const remaining = await db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, asset!.id))
    expect(remaining).toHaveLength(1)
  })
})
