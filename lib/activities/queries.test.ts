import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  isCategorySlug,
  listCategories,
  loadActivityLanding,
  loadCategoryLanding,
} from './queries'

describe('activity / category landing queries', () => {
  describe('listCategories', () => {
    it('returns only categories that have at least one activity in the registry', () => {
      const categories = listCategories()
      // water, aerial, mountain, wildlife each have ≥1 activity; urban has none.
      expect(categories).toEqual(
        expect.arrayContaining(['water', 'aerial', 'mountain', 'wildlife']),
      )
      expect(categories).not.toContain('urban')
    })

    it('returns each category exactly once (distinct)', () => {
      const categories = listCategories()
      expect(new Set(categories).size).toBe(categories.length)
    })
  })

  describe('isCategorySlug', () => {
    it('accepts a category present in the registry', () => {
      expect(isCategorySlug('water')).toBe(true)
      expect(isCategorySlug('mountain')).toBe(true)
    })

    it('rejects an empty category (urban — in the type, no activities)', () => {
      expect(isCategorySlug('urban')).toBe(false)
    })

    it('rejects an unknown / malformed value', () => {
      expect(isCategorySlug('not-a-category')).toBe(false)
      expect(isCategorySlug('')).toBe(false)
      expect(isCategorySlug(42)).toBe(false)
    })
  })

  describe('loaders (PGlite)', () => {
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

    describe('loadActivityLanding', () => {
      it('returns null for an activity slug not in the registry', async () => {
        const result = await loadActivityLanding(db, 'chess-boxing')
        expect(result).toBeNull()
      })

      it('returns published experiences for the activity ACROSS all regions', async () => {
        await seedExperience({
          slug: 'rishikesh-raft',
          title: 'Rishikesh Rafting',
          activitySlug: 'rafting',
          regionSlug: 'rishikesh',
        })
        await seedExperience({
          slug: 'kullu-raft',
          title: 'Kullu Rafting',
          activitySlug: 'rafting',
          regionSlug: 'manali',
        })

        const result = await loadActivityLanding(db, 'rafting')
        expect(result).not.toBeNull()
        expect(result?.activity.slug).toBe('rafting')
        expect(result?.experiences).toHaveLength(2)
        // Cross-region: both regions present, each card carries its own regionSlug.
        const regionSlugs = result?.experiences.map((e) => e.regionSlug).sort()
        expect(regionSlugs).toEqual(['manali', 'rishikesh'])
      })

      it('excludes draft / paused experiences', async () => {
        await seedExperience({
          slug: 'live-raft',
          title: 'Live Raft',
          activitySlug: 'rafting',
          regionSlug: 'rishikesh',
          status: 'published',
        })
        await seedExperience({
          slug: 'draft-raft',
          title: 'Draft Raft',
          activitySlug: 'rafting',
          regionSlug: 'rishikesh',
          status: 'draft',
        })
        await seedExperience({
          slug: 'paused-raft',
          title: 'Paused Raft',
          activitySlug: 'rafting',
          regionSlug: 'goa',
          status: 'paused',
        })

        const result = await loadActivityLanding(db, 'rafting')
        expect(result?.experiences).toHaveLength(1)
        expect(result?.experiences[0]?.slug).toBe('live-raft')
      })

      it('does not leak experiences from a different activity', async () => {
        await seedExperience({
          slug: 'a-raft',
          title: 'A Raft',
          activitySlug: 'rafting',
          regionSlug: 'rishikesh',
        })
        await seedExperience({
          slug: 'a-trek',
          title: 'A Trek',
          activitySlug: 'trekking',
          regionSlug: 'manali',
        })
        const result = await loadActivityLanding(db, 'rafting')
        expect(result?.experiences).toHaveLength(1)
        expect(result?.experiences[0]?.slug).toBe('a-raft')
      })

      it('returns an empty experiences list (not null) when none published', async () => {
        const result = await loadActivityLanding(db, 'rafting')
        expect(result).not.toBeNull()
        expect(result?.experiences).toEqual([])
      })
    })

    describe('loadCategoryLanding', () => {
      it('returns null for a category not in the registry', async () => {
        const result = await loadCategoryLanding(db, 'not-a-category')
        expect(result).toBeNull()
      })

      it('returns null for an empty category (urban)', async () => {
        const result = await loadCategoryLanding(db, 'urban')
        expect(result).toBeNull()
      })

      it('aggregates published experiences across all activities in the category', async () => {
        // water = rafting, scuba-diving, kayaking.
        await seedExperience({
          slug: 'cat-raft',
          title: 'Cat Raft',
          activitySlug: 'rafting',
          regionSlug: 'rishikesh',
        })
        await seedExperience({
          slug: 'cat-dive',
          title: 'Cat Dive',
          activitySlug: 'scuba-diving',
          regionSlug: 'goa',
        })
        await seedExperience({
          slug: 'cat-kayak',
          title: 'Cat Kayak',
          activitySlug: 'kayaking',
          regionSlug: 'rishikesh',
        })
        // A mountain activity must NOT leak into the water category.
        await seedExperience({
          slug: 'cat-trek',
          title: 'Cat Trek',
          activitySlug: 'trekking',
          regionSlug: 'manali',
        })

        const result = await loadCategoryLanding(db, 'water')
        expect(result).not.toBeNull()
        expect(result?.category).toBe('water')
        expect(result?.experiences).toHaveLength(3)
        const slugs = result?.experiences.map((e) => e.slug).sort()
        expect(slugs).toEqual(['cat-dive', 'cat-kayak', 'cat-raft'])
        // The mountain activity is excluded.
        expect(slugs).not.toContain('cat-trek')
      })

      it('excludes draft / paused experiences from the category rollup', async () => {
        await seedExperience({
          slug: 'pub-raft',
          title: 'Pub Raft',
          activitySlug: 'rafting',
          regionSlug: 'rishikesh',
          status: 'published',
        })
        await seedExperience({
          slug: 'draft-dive',
          title: 'Draft Dive',
          activitySlug: 'scuba-diving',
          regionSlug: 'goa',
          status: 'draft',
        })
        const result = await loadCategoryLanding(db, 'water')
        expect(result?.experiences).toHaveLength(1)
        expect(result?.experiences[0]?.slug).toBe('pub-raft')
      })

      it('returns an empty experiences list (not null) for a valid category with no published experiences', async () => {
        const result = await loadCategoryLanding(db, 'wildlife')
        expect(result).not.toBeNull()
        expect(result?.experiences).toEqual([])
      })
    })
  })
})
