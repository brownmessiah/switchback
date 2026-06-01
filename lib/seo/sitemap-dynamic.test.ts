import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  generateAdventureSitemapUrls,
  generateExperienceSitemapUrls,
  generateVendorSitemapUrls,
  getSiteUrl,
} from './sitemap'

describe('dynamic sitemap generators (issue #13)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  const siteUrl = getSiteUrl()

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    // Two vendors.
    await db.insert(users).values([
      { id: 'u_v1', email: 'v1@example.com' },
      { id: 'u_v2', email: 'v2@example.com' },
      { id: 'u_v3', email: 'v3@example.com' },
    ])
    await db.insert(vendorProfiles).values([
      { userId: 'u_v1', businessName: 'Rishikesh Rafting Co', slug: 'rishikesh-rafting-co' },
      { userId: 'u_v2', businessName: 'Goa Dive School', slug: 'goa-dive-school' },
      // u_v3 has NO published experiences (only a draft) — must be excluded.
      { userId: 'u_v3', businessName: 'Ghost Vendor', slug: 'ghost-vendor' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)
  })

  async function seed(args: {
    vendorUserId: string
    slug: string
    activitySlug: string
    regionSlug: string
    status?: 'published' | 'draft' | 'paused'
    updatedAt?: Date
  }): Promise<void> {
    await db.insert(experiences).values({
      vendorUserId: args.vendorUserId,
      slug: args.slug,
      title: args.slug,
      cancellationPreset: 'flexible',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: '1500.00',
      pricePerPerson_3_5: '1300.00',
      pricePerPerson_6_plus: '1100.00',
      activitySlug: args.activitySlug,
      regionSlug: args.regionSlug,
      status: args.status ?? 'published',
      ...(args.updatedAt ? { updatedAt: args.updatedAt } : {}),
    })
  }

  describe('generateExperienceSitemapUrls', () => {
    it('includes published experience slugs and excludes drafts (en, no prefix)', async () => {
      await seed({ vendorUserId: 'u_v1', slug: 'grand-rafting', activitySlug: 'rafting', regionSlug: 'rishikesh' })
      await seed({ vendorUserId: 'u_v2', slug: 'goa-dive', activitySlug: 'scuba-diving', regionSlug: 'goa' })
      await seed({
        vendorUserId: 'u_v3',
        slug: 'hidden-draft',
        activitySlug: 'rafting',
        regionSlug: 'rishikesh',
        status: 'draft',
      })

      const entries = await generateExperienceSitemapUrls(db, 'en')
      const urls = entries.map((e) => e.url)

      expect(urls).toContain(`${siteUrl}/experience/grand-rafting`)
      expect(urls).toContain(`${siteUrl}/experience/goa-dive`)
      expect(urls).not.toContain(`${siteUrl}/experience/hidden-draft`)
    })

    it('uses /hi/ prefix for the hindi locale', async () => {
      await seed({ vendorUserId: 'u_v1', slug: 'grand-rafting', activitySlug: 'rafting', regionSlug: 'rishikesh' })

      const entries = await generateExperienceSitemapUrls(db, 'hi')
      const urls = entries.map((e) => e.url)

      expect(urls).toContain(`${siteUrl}/hi/experience/grand-rafting`)
      expect(urls).not.toContain(`${siteUrl}/experience/grand-rafting`)
    })

    it('uses updatedAt for lastModified', async () => {
      const when = new Date('2025-01-15T00:00:00.000Z')
      await seed({
        vendorUserId: 'u_v1',
        slug: 'dated-raft',
        activitySlug: 'rafting',
        regionSlug: 'rishikesh',
        updatedAt: when,
      })

      const entries = await generateExperienceSitemapUrls(db, 'en')
      const entry = entries.find((e) => e.url === `${siteUrl}/experience/dated-raft`)
      expect(entry).toBeDefined()
      expect(entry?.lastModified.getTime()).toBe(when.getTime())
    })
  })

  describe('generateAdventureSitemapUrls', () => {
    it('emits one URL per DISTINCT registry-valid activity-in-region combo with published experiences', async () => {
      // Two published rafting-in-rishikesh — should collapse to ONE combo URL.
      await seed({ vendorUserId: 'u_v1', slug: 'raft-a', activitySlug: 'rafting', regionSlug: 'rishikesh' })
      await seed({ vendorUserId: 'u_v1', slug: 'raft-b', activitySlug: 'rafting', regionSlug: 'rishikesh' })
      // One published scuba-diving-in-goa.
      await seed({ vendorUserId: 'u_v2', slug: 'goa-dive', activitySlug: 'scuba-diving', regionSlug: 'goa' })

      const entries = await generateAdventureSitemapUrls(db, 'en')
      const urls = entries.map((e) => e.url)

      expect(urls).toContain(`${siteUrl}/adventure/rafting-in-rishikesh`)
      expect(urls).toContain(`${siteUrl}/adventure/scuba-diving-in-goa`)
      // Distinct: rafting-in-rishikesh appears exactly once.
      expect(urls.filter((u) => u === `${siteUrl}/adventure/rafting-in-rishikesh`)).toHaveLength(1)
    })

    it('excludes combos with only draft/paused experiences', async () => {
      await seed({
        vendorUserId: 'u_v1',
        slug: 'draft-trek',
        activitySlug: 'trekking',
        regionSlug: 'manali',
        status: 'draft',
      })

      const entries = await generateAdventureSitemapUrls(db, 'en')
      const urls = entries.map((e) => e.url)
      expect(urls).not.toContain(`${siteUrl}/adventure/trekking-in-manali`)
    })

    it('excludes combos whose activity or region is not registry-valid', async () => {
      // 'paragliding' is a valid activity but 'atlantis' is NOT a valid region.
      await seed({ vendorUserId: 'u_v1', slug: 'fly-atlantis', activitySlug: 'paragliding', regionSlug: 'atlantis' })
      // 'chess-boxing' is not a valid activity though 'goa' is a valid region.
      await seed({ vendorUserId: 'u_v2', slug: 'odd-one', activitySlug: 'chess-boxing', regionSlug: 'goa' })

      const entries = await generateAdventureSitemapUrls(db, 'en')
      const urls = entries.map((e) => e.url)
      expect(urls).not.toContain(`${siteUrl}/adventure/paragliding-in-atlantis`)
      expect(urls).not.toContain(`${siteUrl}/adventure/chess-boxing-in-goa`)
    })

    it('uses /hi/ prefix for the hindi locale', async () => {
      await seed({ vendorUserId: 'u_v1', slug: 'raft-a', activitySlug: 'rafting', regionSlug: 'rishikesh' })
      const entries = await generateAdventureSitemapUrls(db, 'hi')
      const urls = entries.map((e) => e.url)
      expect(urls).toContain(`${siteUrl}/hi/adventure/rafting-in-rishikesh`)
    })
  })

  describe('generateVendorSitemapUrls', () => {
    it('includes only vendors with >=1 published experience', async () => {
      await seed({ vendorUserId: 'u_v1', slug: 'raft-a', activitySlug: 'rafting', regionSlug: 'rishikesh' })
      await seed({ vendorUserId: 'u_v2', slug: 'goa-dive', activitySlug: 'scuba-diving', regionSlug: 'goa' })
      // u_v3 only has a draft.
      await seed({
        vendorUserId: 'u_v3',
        slug: 'hidden-draft',
        activitySlug: 'rafting',
        regionSlug: 'rishikesh',
        status: 'draft',
      })

      const entries = await generateVendorSitemapUrls(db, 'en')
      const urls = entries.map((e) => e.url)

      expect(urls).toContain(`${siteUrl}/vendor/rishikesh-rafting-co`)
      expect(urls).toContain(`${siteUrl}/vendor/goa-dive-school`)
      expect(urls).not.toContain(`${siteUrl}/vendor/ghost-vendor`)
    })

    it('lists each qualifying vendor exactly once even with multiple published experiences', async () => {
      await seed({ vendorUserId: 'u_v1', slug: 'raft-a', activitySlug: 'rafting', regionSlug: 'rishikesh' })
      await seed({ vendorUserId: 'u_v1', slug: 'raft-b', activitySlug: 'rafting', regionSlug: 'rishikesh' })

      const entries = await generateVendorSitemapUrls(db, 'en')
      const urls = entries.map((e) => e.url)
      expect(urls.filter((u) => u === `${siteUrl}/vendor/rishikesh-rafting-co`)).toHaveLength(1)
    })

    it('uses /hi/ prefix for the hindi locale', async () => {
      await seed({ vendorUserId: 'u_v1', slug: 'raft-a', activitySlug: 'rafting', regionSlug: 'rishikesh' })
      const entries = await generateVendorSitemapUrls(db, 'hi')
      const urls = entries.map((e) => e.url)
      expect(urls).toContain(`${siteUrl}/hi/vendor/rishikesh-rafting-co`)
    })
  })
})
