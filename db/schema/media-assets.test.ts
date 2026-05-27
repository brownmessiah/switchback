import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { experiences } from './experiences'
import { mediaAssets } from './media-assets'
import { users } from './users'
import { vendorProfiles } from './vendor-profiles'

describe('media_assets schema', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    // Seed user + vendor + experience for FK chains.
    await db.insert(users).values({ id: 'u_media', email: 'media@example.com' })
    await db.insert(vendorProfiles).values({
      userId: 'u_media',
      businessName: 'Media Vendor',
      slug: 'media-vendor',
    })
    await db.insert(experiences).values({
      vendorUserId: 'u_media',
      slug: 'media-test-exp',
      title: 'Media Test Experience',
      cancellationPreset: 'flexible',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: '1000',
      pricePerPerson_3_5: '900',
      pricePerPerson_6_plus: '800',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE media_assets`)
  })

  it('creates a media asset linked to an experience', async () => {
    const [exp] = await db
      .select({ id: experiences.id })
      .from(experiences)
      .where(eq(experiences.slug, 'media-test-exp'))

    const [asset] = await db
      .insert(mediaAssets)
      .values({
        uploadedBy: 'u_media',
        storageKey: 'experiences/abc/photo.jpg',
        url: '/uploads/experiences/abc/photo.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 204800,
        entityType: 'experience',
        entityId: exp!.id,
      })
      .returning()

    expect(asset.id).toBeTruthy()
    expect(asset.uploadedBy).toBe('u_media')
    expect(asset.contentType).toBe('image/jpeg')
    expect(asset.sizeBytes).toBe(204800)
    expect(asset.entityType).toBe('experience')
    expect(asset.entityId).toBe(exp!.id)
    expect(asset.createdAt).toBeInstanceOf(Date)
    expect(asset.altText).toBeNull()
  })

  it('stores alt text when provided', async () => {
    const [exp] = await db
      .select({ id: experiences.id })
      .from(experiences)
      .where(eq(experiences.slug, 'media-test-exp'))

    const [asset] = await db
      .insert(mediaAssets)
      .values({
        uploadedBy: 'u_media',
        storageKey: 'experiences/abc/scenic.jpg',
        url: '/uploads/experiences/abc/scenic.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 102400,
        altText: 'Scenic river view during rafting',
        entityType: 'experience',
        entityId: exp!.id,
      })
      .returning()

    expect(asset.altText).toBe('Scenic river view during rafting')
  })

  it('supports multiple assets per entity', async () => {
    const [exp] = await db
      .select({ id: experiences.id })
      .from(experiences)
      .where(eq(experiences.slug, 'media-test-exp'))

    await db.insert(mediaAssets).values([
      {
        uploadedBy: 'u_media',
        storageKey: 'experiences/abc/1.jpg',
        url: '/uploads/experiences/abc/1.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 100000,
        entityType: 'experience',
        entityId: exp!.id,
      },
      {
        uploadedBy: 'u_media',
        storageKey: 'experiences/abc/2.jpg',
        url: '/uploads/experiences/abc/2.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 200000,
        entityType: 'experience',
        entityId: exp!.id,
      },
      {
        uploadedBy: 'u_media',
        storageKey: 'experiences/abc/3.png',
        url: '/uploads/experiences/abc/3.png',
        contentType: 'image/png',
        sizeBytes: 300000,
        entityType: 'experience',
        entityId: exp!.id,
      },
    ])

    const assets = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.entityId, exp!.id))

    expect(assets).toHaveLength(3)
  })

  it('supports different entity types', async () => {
    await db.insert(mediaAssets).values([
      {
        uploadedBy: 'u_media',
        storageKey: 'vendors/v1/logo.png',
        url: '/uploads/vendors/v1/logo.png',
        contentType: 'image/png',
        sizeBytes: 50000,
        entityType: 'vendor',
        entityId: 'u_media',
      },
      {
        uploadedBy: 'u_media',
        storageKey: 'blog/post1/cover.jpg',
        url: '/uploads/blog/post1/cover.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 150000,
        entityType: 'blog',
        entityId: 'post_1',
      },
    ])

    const vendorAssets = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.entityType, 'vendor'))

    const blogAssets = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.entityType, 'blog'))

    expect(vendorAssets).toHaveLength(1)
    expect(blogAssets).toHaveLength(1)
  })

  it('enforces uploaded_by FK to users', async () => {
    await expect(
      db.insert(mediaAssets).values({
        uploadedBy: 'nonexistent_user',
        storageKey: 'test/bad-fk.jpg',
        url: '/uploads/test/bad-fk.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 1000,
        entityType: 'experience',
        entityId: 'some-id',
      }),
    ).rejects.toThrow()
  })

  it('deletes a media asset by id', async () => {
    const [asset] = await db
      .insert(mediaAssets)
      .values({
        uploadedBy: 'u_media',
        storageKey: 'test/to-delete.jpg',
        url: '/uploads/test/to-delete.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 5000,
        entityType: 'experience',
        entityId: 'some-id',
      })
      .returning()

    await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id))
    const remaining = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, asset.id))

    expect(remaining).toHaveLength(0)
  })
})
