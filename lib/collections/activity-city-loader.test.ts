import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { mediaAssets } from '@/db/schema/media-assets'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  loadActivityCityCollection,
  parseActivityCitySlug,
} from './activity-city-loader'

describe('activity-city loader (ADR-0013)', () => {
  describe('parseActivityCitySlug', () => {
    it('parses a simple slug into activity + region', () => {
      expect(parseActivityCitySlug('rafting-in-rishikesh')).toEqual({
        activitySlug: 'rafting',
        regionSlug: 'rishikesh',
      })
    })

    it('parses a multi-token activity (scuba-diving) correctly', () => {
      expect(parseActivityCitySlug('scuba-diving-in-goa')).toEqual({
        activitySlug: 'scuba-diving',
        regionSlug: 'goa',
      })
    })

    it('parses a multi-token region (bir-billing) correctly', () => {
      expect(parseActivityCitySlug('paragliding-in-bir-billing')).toEqual({
        activitySlug: 'paragliding',
        regionSlug: 'bir-billing',
      })
    })

    it('returns null when neither side resolves to a registered slug', () => {
      expect(parseActivityCitySlug('chess-boxing-in-atlantis')).toBeNull()
    })

    it('returns null when the slug lacks the -in- separator', () => {
      expect(parseActivityCitySlug('rafting-rishikesh')).toBeNull()
    })

    it('returns null on empty string', () => {
      expect(parseActivityCitySlug('')).toBeNull()
    })
  })

  describe('loadActivityCityCollection', () => {
    let db: TestDB
    let teardown: () => Promise<void>

    beforeAll(async () => {
      const setup = await setupTestDb()
      db = setup.db
      teardown = setup.teardown

      await db.insert(users).values({ id: 'u_v', email: 'v@example.com' })
      await db.insert(vendorProfiles).values({
        userId: 'u_v',
        businessName: 'Test Adventures',
        slug: 'test-adventures',
      })
    })

    afterAll(async () => {
      await teardown()
    })

    beforeEach(async () => {
      await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)
    })

    async function seedExperience(args: {
      slug: string
      title: string
      activitySlug: string
      regionSlug: string
      status?: 'published' | 'draft' | 'paused'
      pricePerPerson_1_2?: string
    }): Promise<string> {
      const [exp] = await db
        .insert(experiences)
        .values({
          vendorUserId: 'u_v',
          slug: args.slug,
          title: args.title,
          cancellationPreset: 'flexible',
          paymentModesAllowed: ['full_upfront'],
          pricePerPerson_1_2: args.pricePerPerson_1_2 ?? '1500.00',
          pricePerPerson_3_5: '1300.00',
          pricePerPerson_6_plus: '1100.00',
          regionSlug: args.regionSlug,
          activitySlug: args.activitySlug,
          status: args.status ?? 'published',
        })
        .returning({ id: experiences.id })
      return exp!.id
    }

    it('returns null when the slug does not parse into known activity+region pair', async () => {
      const result = await loadActivityCityCollection(db, {
        lng: 'en',
        slug: 'chess-boxing-in-atlantis',
      })
      expect(result).toBeNull()
    })

    it('returns a populated collection for a valid slug with published experiences', async () => {
      await seedExperience({
        slug: 'grand-rafting',
        title: 'Grand Rafting Adventure',
        activitySlug: 'rafting',
        regionSlug: 'rishikesh',
      })
      await seedExperience({
        slug: 'easy-rafting',
        title: 'Easy Day Rafting',
        activitySlug: 'rafting',
        regionSlug: 'rishikesh',
        pricePerPerson_1_2: '800.00',
      })

      const result = await loadActivityCityCollection(db, {
        lng: 'en',
        slug: 'rafting-in-rishikesh',
      })
      expect(result).not.toBeNull()
      expect(result?.activity.slug).toBe('rafting')
      expect(result?.region.slug).toBe('rishikesh')
      expect(result?.experiences).toHaveLength(2)
      expect(result?.experiences.map((e) => e.slug).sort()).toEqual(
        ['easy-rafting', 'grand-rafting'].sort(),
      )
    })

    it('attaches the media_assets cover per experience, null when none (parity-catchup/02)', async () => {
      const withMedia = await seedExperience({
        slug: 'media-rafting',
        title: 'Media Rafting',
        activitySlug: 'rafting',
        regionSlug: 'rishikesh',
      })
      await seedExperience({
        slug: 'plain-rafting',
        title: 'Plain Rafting',
        activitySlug: 'rafting',
        regionSlug: 'rishikesh',
      })
      await db.insert(mediaAssets).values({
        uploadedBy: 'u_v',
        storageKey: 'm/cover.jpg',
        url: 'https://cdn/cover.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 100,
        entityType: 'experience',
        entityId: withMedia,
      })

      const result = await loadActivityCityCollection(db, { lng: 'en', slug: 'rafting-in-rishikesh' })
      const coverBySlug = new Map(result!.experiences.map((e) => [e.slug, e.coverImageUrl]))
      expect(coverBySlug.get('media-rafting')).toBe('https://cdn/cover.jpg')
      expect(coverBySlug.get('plain-rafting')).toBeNull()
    })

    it('excludes draft / paused / archived experiences from the listing', async () => {
      await seedExperience({
        slug: 'live-trek',
        title: 'Live Trek',
        activitySlug: 'trekking',
        regionSlug: 'manali',
        status: 'published',
      })
      await seedExperience({
        slug: 'draft-trek',
        title: 'Draft Trek',
        activitySlug: 'trekking',
        regionSlug: 'manali',
        status: 'draft',
      })
      await seedExperience({
        slug: 'paused-trek',
        title: 'Paused Trek',
        activitySlug: 'trekking',
        regionSlug: 'manali',
        status: 'paused',
      })

      const result = await loadActivityCityCollection(db, {
        lng: 'en',
        slug: 'trekking-in-manali',
      })
      expect(result?.experiences).toHaveLength(1)
      expect(result?.experiences[0]?.slug).toBe('live-trek')
    })

    it('returns an empty experiences list (not null) when no published experiences match', async () => {
      // The page can still render with an empty product list — the SEO
      // value is in the editorial + JSON-LD scaffolding. Loader returns
      // an empty array so the page is not 404-routed in that case.
      const result = await loadActivityCityCollection(db, {
        lng: 'en',
        slug: 'rafting-in-rishikesh',
      })
      expect(result).not.toBeNull()
      expect(result?.experiences).toEqual([])
    })

    it('respects the topN cap', async () => {
      for (let i = 0; i < 5; i++) {
        await seedExperience({
          slug: `raft-${i}`,
          title: `Raft ${i}`,
          activitySlug: 'rafting',
          regionSlug: 'rishikesh',
        })
      }
      const result = await loadActivityCityCollection(db, {
        lng: 'en',
        slug: 'rafting-in-rishikesh',
        topN: 3,
      })
      expect(result?.experiences).toHaveLength(3)
    })

    it('does not leak experiences from a different region under the same activity', async () => {
      await seedExperience({
        slug: 'goa-dive',
        title: 'Goa Dive',
        activitySlug: 'scuba-diving',
        regionSlug: 'goa',
      })
      await seedExperience({
        slug: 'andaman-dive',
        title: 'Andaman Dive',
        activitySlug: 'scuba-diving',
        regionSlug: 'andaman',
      })
      const goaResult = await loadActivityCityCollection(db, {
        lng: 'en',
        slug: 'scuba-diving-in-goa',
      })
      expect(goaResult?.experiences).toHaveLength(1)
      expect(goaResult?.experiences[0]?.slug).toBe('goa-dive')
    })
  })
})
