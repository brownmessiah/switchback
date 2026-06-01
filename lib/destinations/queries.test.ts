import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { listRegions } from '@/lib/regions/registry'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { listRegionsWithCounts, loadRegionLanding } from './queries'

describe('destinations queries (Issue 04)', () => {
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

  describe('loadRegionLanding', () => {
    it('returns null for an unregistered region slug', async () => {
      const result = await loadRegionLanding(db, 'not-a-region')
      expect(result).toBeNull()
    })

    it('returns region metadata + its published experiences for a valid slug', async () => {
      await seedExperience({
        slug: 'rishikesh-rafting',
        title: 'Rishikesh Rafting',
        activitySlug: 'rafting',
        regionSlug: 'rishikesh',
      })
      await seedExperience({
        slug: 'rishikesh-bungee',
        title: 'Rishikesh Bungee',
        activitySlug: 'bungee-jumping',
        regionSlug: 'rishikesh',
        pricePerPerson_1_2: '3500.00',
      })

      const result = await loadRegionLanding(db, 'rishikesh')
      expect(result).not.toBeNull()
      expect(result?.region.slug).toBe('rishikesh')
      expect(result?.region.displayName.en).toBe('Rishikesh')
      expect(result?.region.state).toBe('Uttarakhand')
      expect(result?.experiences).toHaveLength(2)
      expect(result?.experiences.map((e) => e.slug).sort()).toEqual(
        ['rishikesh-bungee', 'rishikesh-rafting'].sort(),
      )
      const rafting = result?.experiences.find(
        (e) => e.slug === 'rishikesh-rafting',
      )
      expect(rafting?.pricePerParticipantRupees).toBe(1500)
      expect(rafting?.activitySlug).toBe('rafting')
    })

    it('excludes draft / paused experiences from the region listing', async () => {
      await seedExperience({
        slug: 'goa-dive',
        title: 'Goa Dive',
        activitySlug: 'scuba-diving',
        regionSlug: 'goa',
        status: 'published',
      })
      await seedExperience({
        slug: 'goa-draft',
        title: 'Goa Draft',
        activitySlug: 'scuba-diving',
        regionSlug: 'goa',
        status: 'draft',
      })
      await seedExperience({
        slug: 'goa-paused',
        title: 'Goa Paused',
        activitySlug: 'scuba-diving',
        regionSlug: 'goa',
        status: 'paused',
      })

      const result = await loadRegionLanding(db, 'goa')
      expect(result?.experiences).toHaveLength(1)
      expect(result?.experiences[0]?.slug).toBe('goa-dive')
    })

    it('does not leak experiences from a different region', async () => {
      await seedExperience({
        slug: 'manali-trek',
        title: 'Manali Trek',
        activitySlug: 'trekking',
        regionSlug: 'manali',
      })
      await seedExperience({
        slug: 'kasol-trek',
        title: 'Kasol Trek',
        activitySlug: 'trekking',
        regionSlug: 'kasol',
      })

      const result = await loadRegionLanding(db, 'manali')
      expect(result?.experiences).toHaveLength(1)
      expect(result?.experiences[0]?.slug).toBe('manali-trek')
    })

    it('returns an empty experiences list (not null) when the region has none published', async () => {
      const result = await loadRegionLanding(db, 'auli')
      expect(result).not.toBeNull()
      expect(result?.experiences).toEqual([])
    })

    it('respects the topN cap', async () => {
      for (let i = 0; i < 5; i++) {
        await seedExperience({
          slug: `lonavala-${i}`,
          title: `Lonavala ${i}`,
          activitySlug: 'trekking',
          regionSlug: 'lonavala',
        })
      }
      const result = await loadRegionLanding(db, 'lonavala', { topN: 3 })
      expect(result?.experiences).toHaveLength(3)
    })
  })

  describe('listRegionsWithCounts', () => {
    it('lists every region from the registry with imagery', async () => {
      const rows = await listRegionsWithCounts(db)
      expect(rows).toHaveLength(listRegions().length)
      const slugs = rows.map((r) => r.region.slug).sort()
      expect(slugs).toEqual(listRegions().map((r) => r.slug).sort())
      for (const row of rows) {
        expect(row.imageUrl).toBeTruthy()
      }
    })

    it('counts only published experiences per region', async () => {
      await seedExperience({
        slug: 'rishikesh-a',
        title: 'Rishikesh A',
        activitySlug: 'rafting',
        regionSlug: 'rishikesh',
        status: 'published',
      })
      await seedExperience({
        slug: 'rishikesh-b',
        title: 'Rishikesh B',
        activitySlug: 'trekking',
        regionSlug: 'rishikesh',
        status: 'published',
      })
      await seedExperience({
        slug: 'rishikesh-draft',
        title: 'Rishikesh Draft',
        activitySlug: 'rafting',
        regionSlug: 'rishikesh',
        status: 'draft',
      })
      await seedExperience({
        slug: 'goa-a',
        title: 'Goa A',
        activitySlug: 'scuba-diving',
        regionSlug: 'goa',
        status: 'published',
      })

      const rows = await listRegionsWithCounts(db)
      const bySlug = new Map(rows.map((r) => [r.region.slug, r]))
      expect(bySlug.get('rishikesh')?.experienceCount).toBe(2)
      expect(bySlug.get('goa')?.experienceCount).toBe(1)
      expect(bySlug.get('manali')?.experienceCount).toBe(0)
    })
  })
})
