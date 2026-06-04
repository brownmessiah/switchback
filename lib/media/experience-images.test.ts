import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { mediaAssets } from '@/db/schema/media-assets'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { getActivityImage } from '@/lib/images'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  galleryTiles,
  loadExperienceCoverMap,
  loadExperienceGallery,
  resolveExperienceCover,
} from './experience-images'

describe('galleryTiles (PDP 3-tile overview, distinct fallbacks)', () => {
  it('uses the real gallery URLs when 3+ are present', () => {
    const gallery = [
      { url: 'https://cdn/a.jpg', altText: null },
      { url: 'https://cdn/b.jpg', altText: null },
      { url: 'https://cdn/c.jpg', altText: null },
      { url: 'https://cdn/d.jpg', altText: null },
    ]
    expect(galleryTiles(gallery, 'rafting')).toEqual([
      'https://cdn/a.jpg',
      'https://cdn/b.jpg',
      'https://cdn/c.jpg',
    ])
  })

  it('fills ALL three tiles with DISTINCT activity fallbacks when gallery is empty', () => {
    const tiles = galleryTiles([], 'paragliding')
    expect(tiles.length).toBe(3)
    expect(new Set(tiles).size).toBe(3) // no crop-duplicates of one photo
  })

  it('fills only the missing tiles, keeping real photos first', () => {
    const tiles = galleryTiles([{ url: 'https://cdn/real.jpg', altText: 'x' }], 'paragliding')
    expect(tiles[0]).toBe('https://cdn/real.jpg')
    expect(new Set(tiles).size).toBe(3)
  })
})

describe('resolveExperienceCover (pure fallback)', () => {
  it('returns the media URL when one is present', () => {
    expect(resolveExperienceCover('https://cdn/x.jpg', 'rafting')).toBe('https://cdn/x.jpg')
  })
  it('falls back to the activity stock image when no media URL', () => {
    expect(resolveExperienceCover(null, 'rafting')).toBe(getActivityImage('rafting'))
    expect(resolveExperienceCover(undefined, 'paragliding')).toBe(getActivityImage('paragliding'))
  })
})

describe('media_assets experience cover/gallery loaders', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let expWithMedia: string
  let expNoMedia: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values({ id: 'u_v', email: 'v@example.com' })
    await db.insert(vendorProfiles).values({ userId: 'u_v', businessName: 'V', slug: 'v', kycTier: 'business' })
    const rows = await db
      .insert(experiences)
      .values([
        { vendorUserId: 'u_v', slug: 'has-media', title: 'Has Media', cancellationPreset: 'flexible', paymentModesAllowed: ['full_upfront'], pricePerPerson_1_2: '1000', pricePerPerson_3_5: '900', pricePerPerson_6_plus: '800', regionSlug: 'goa', activitySlug: 'rafting' },
        { vendorUserId: 'u_v', slug: 'no-media', title: 'No Media', cancellationPreset: 'flexible', paymentModesAllowed: ['full_upfront'], pricePerPerson_1_2: '1000', pricePerPerson_3_5: '900', pricePerPerson_6_plus: '800', regionSlug: 'goa', activitySlug: 'trekking' },
      ])
      .returning({ id: experiences.id, slug: experiences.slug })
    expWithMedia = rows.find((r) => r.slug === 'has-media')!.id
    expNoMedia = rows.find((r) => r.slug === 'no-media')!.id

    // Insert media OUT OF ORDER so the test proves the (created_at, storage_key)
    // ordering picks the deterministic primary — not insertion order.
    await db.insert(mediaAssets).values([
      { uploadedBy: 'u_v', storageKey: 'm/b.jpg', url: 'https://cdn/b.jpg', contentType: 'image/jpeg', sizeBytes: 100, altText: 'second', entityType: 'experience', entityId: expWithMedia },
      { uploadedBy: 'u_v', storageKey: 'm/a.jpg', url: 'https://cdn/a.jpg', contentType: 'image/jpeg', sizeBytes: 100, altText: 'first', entityType: 'experience', entityId: expWithMedia },
    ])
    // A vendor-scoped asset that must NEVER appear as experience imagery.
    await db.insert(mediaAssets).values({ uploadedBy: 'u_v', storageKey: 'm/logo.jpg', url: 'https://cdn/logo.jpg', contentType: 'image/jpeg', sizeBytes: 100, entityType: 'vendor', entityId: 'u_v' })
  })

  afterAll(async () => {
    await teardown()
  })

  it('loadExperienceCoverMap returns the primary url per experience that has media', async () => {
    const map = await loadExperienceCoverMap(db, [expWithMedia, expNoMedia])
    // a.jpg sorts before b.jpg by storage_key → it is the primary cover.
    expect(map.get(expWithMedia)).toBe('https://cdn/a.jpg')
    // No media → absent from the map (caller falls back to stock).
    expect(map.has(expNoMedia)).toBe(false)
  })

  it('loadExperienceCoverMap returns an empty map for no ids', async () => {
    const map = await loadExperienceCoverMap(db, [])
    expect(map.size).toBe(0)
  })

  it('loadExperienceGallery returns ordered experience media (primary first), excluding vendor assets', async () => {
    const gallery = await loadExperienceGallery(db, expWithMedia)
    expect(gallery.map((g) => g.url)).toEqual(['https://cdn/a.jpg', 'https://cdn/b.jpg'])
    expect(gallery[0]).toMatchObject({ url: 'https://cdn/a.jpg', altText: 'first' })
  })

  it('loadExperienceGallery returns [] for an experience with no media', async () => {
    expect(await loadExperienceGallery(db, expNoMedia)).toEqual([])
  })
})
