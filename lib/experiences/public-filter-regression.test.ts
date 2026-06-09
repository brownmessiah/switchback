import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { loadActivityLanding, loadCategoryLanding } from '@/lib/activities/queries'
import { loadActivityCityCollection } from '@/lib/collections/activity-city-loader'
import { listRegionsWithCounts, loadRegionLanding } from '@/lib/destinations/queries'
import { loadHomePageData } from '@/lib/home/queries'
import {
  generateAdventureSitemapUrls,
  generateExperienceSitemapUrls,
  generateVendorSitemapUrls,
} from '@/lib/seo/sitemap'
import { loadVendorPublicExperiences } from '@/lib/vendor/public-profile'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { FIXTURE_EXPERIENCE_SLUGS } from './fixture-slugs'

/**
 * Issue 04 — fixture-leak hardening regression net.
 *
 * For EVERY public list-query helper, seed a real catalog Experience plus a
 * PUBLISHED fixture Experience and a DRAFT Experience, then assert no fixture
 * slug and no non-published row ever surfaces. This is the single guard that
 * fails the moment a new public list-query forgets to route through
 * `publiclyVisibleExperienceCondition()` / `isPubliclyVisibleExperience`.
 */

const REAL_SLUG = 'real-rafting-rishikesh'
const REAL_TITLE = 'White Water Rafting'
const DRAFT_SLUG = 'draft-rafting-rishikesh'
// A representative slug from each fixture sub-family.
const PUBLISHED_FIXTURE_SLUG = 'commission-scope-fixture-bir-billing'
const REVIEW_MOD_FIXTURE_SLUG = 'review-moderation-fixture-rishikesh'

function containsAnyFixtureSlug(slugs: string[]): boolean {
  return slugs.some((s) => FIXTURE_EXPERIENCE_SLUGS.includes(s))
}

describe('Public list-query fixture-leak regression', () => {
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
    await db.delete(experiences)
    await db.delete(vendorProfiles)
    await db.delete(users)
    await db.insert(users).values({ id: 'v1', email: 'v@test.com', name: 'V' })
    await db.insert(vendorProfiles).values({
      userId: 'v1',
      businessName: 'V Adventures',
      slug: 'v-adventures',
      kycTier: 'identity',
      commissionRate: '20.00',
    })

    // Same vendor / same activity+region for all three so every surface that
    // filters by activity+region still sees all of them as candidates.
    await seedExp(REAL_SLUG, 'published')
    await seedExp(DRAFT_SLUG, 'draft')
    await seedExp(PUBLISHED_FIXTURE_SLUG, 'published')
    // A pending_review moderation fixture (never published) and a published
    // review-moderation fixture, to exercise both fixture sub-families.
    await seedExp(REVIEW_MOD_FIXTURE_SLUG, 'published')
    await seedExp('mod-pending-approve-within-cap', 'pending_review')
  })

  async function seedExp(
    slug: string,
    status: 'draft' | 'pending_review' | 'published' | 'paused' | 'archived',
  ): Promise<void> {
    await db.insert(experiences).values({
      vendorUserId: 'v1',
      slug,
      title: slug === REAL_SLUG ? REAL_TITLE : slug,
      status,
      cancellationPreset: 'moderate',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: '1000.00',
      pricePerPerson_3_5: '900.00',
      pricePerPerson_6_plus: '800.00',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
    })
  }

  it('homepage rails exclude fixtures and non-published', async () => {
    const data = await loadHomePageData(db)
    const slugs = data.featuredExperiences.map((e) => e.slug)
    expect(slugs).toEqual([REAL_SLUG])
    expect(containsAnyFixtureSlug(slugs)).toBe(false)
    // Region/activity counts must only count the one real published Experience.
    const rishikesh = data.featuredDestinations.find((d) => d.slug === 'rishikesh')
    expect(rishikesh?.experienceCount).toBe(1)
    const rafting = data.featuredActivities.find((a) => a.slug === 'rafting')
    expect(rafting?.experienceCount).toBe(1)
  })

  it('destination region landing excludes fixtures and non-published', async () => {
    const data = await loadRegionLanding(db, 'rishikesh')
    const slugs = data!.experiences.map((e) => e.slug)
    expect(slugs).toEqual([REAL_SLUG])
    expect(containsAnyFixtureSlug(slugs)).toBe(false)
  })

  it('destinations index counts exclude fixtures and non-published', async () => {
    const rows = await listRegionsWithCounts(db)
    const rishikesh = rows.find((r) => r.region.slug === 'rishikesh')
    expect(rishikesh?.experienceCount).toBe(1)
  })

  it('activity landing excludes fixtures and non-published', async () => {
    const data = await loadActivityLanding(db, 'rafting')
    const slugs = data!.experiences.map((e) => e.slug)
    expect(slugs).toEqual([REAL_SLUG])
    expect(containsAnyFixtureSlug(slugs)).toBe(false)
  })

  it('category landing excludes fixtures and non-published', async () => {
    // rafting's category is 'water' — load by that category rollup.
    const data = await loadCategoryLanding(db, 'water')
    const slugs = data!.experiences.map((e) => e.slug)
    expect(slugs).toContain(REAL_SLUG)
    expect(containsAnyFixtureSlug(slugs)).toBe(false)
    expect(slugs).not.toContain(DRAFT_SLUG)
  })

  it('activity-city collection excludes fixtures and non-published', async () => {
    const data = await loadActivityCityCollection(db, {
      lng: 'en',
      slug: 'rafting-in-rishikesh',
    })
    const slugs = data!.experiences.map((e) => e.slug)
    expect(slugs).toEqual([REAL_SLUG])
    expect(containsAnyFixtureSlug(slugs)).toBe(false)
  })

  it('vendor public storefront excludes fixtures and non-published', async () => {
    const rows = await loadVendorPublicExperiences(db, 'v1')
    const slugs = rows.map((e) => e.slug)
    expect(slugs).toEqual([REAL_SLUG])
    expect(containsAnyFixtureSlug(slugs)).toBe(false)
  })

  it('experience sitemap excludes fixtures and non-published', async () => {
    const entries = await generateExperienceSitemapUrls(db, 'en')
    const urls = entries.map((e) => e.url)
    expect(urls.some((u) => u.endsWith(`/experience/${REAL_SLUG}`))).toBe(true)
    for (const fixture of FIXTURE_EXPERIENCE_SLUGS) {
      expect(urls.some((u) => u.endsWith(`/experience/${fixture}`))).toBe(false)
    }
    expect(urls.some((u) => u.endsWith(`/experience/${DRAFT_SLUG}`))).toBe(false)
  })

  it('adventure sitemap excludes collections that only have fixtures', async () => {
    // Seed a fixture-only activity+region pair: it must NOT yield an adventure URL.
    await db.insert(experiences).values({
      vendorUserId: 'v1',
      slug: 'payout-queue-fixture-bir-billing',
      title: 'payout-queue-fixture-bir-billing',
      status: 'published',
      cancellationPreset: 'moderate',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: '1000.00',
      pricePerPerson_3_5: '900.00',
      pricePerPerson_6_plus: '800.00',
      regionSlug: 'bir-billing',
      activitySlug: 'paragliding',
    })

    const entries = await generateAdventureSitemapUrls(db, 'en')
    const urls = entries.map((e) => e.url)
    // The real rafting-in-rishikesh collection is present...
    expect(urls.some((u) => u.endsWith('/adventure/rafting-in-rishikesh'))).toBe(true)
    // ...but the fixture-only paragliding-in-bir-billing collection is NOT.
    expect(urls.some((u) => u.endsWith('/adventure/paragliding-in-bir-billing'))).toBe(false)
  })

  it('vendor sitemap excludes vendors whose only catalog is fixtures', async () => {
    // A second vendor whose ONLY published Experience is a fixture.
    await db.insert(users).values({ id: 'v2', email: 'v2@test.com', name: 'V2' })
    await db.insert(vendorProfiles).values({
      userId: 'v2',
      businessName: 'Fixture Only Co',
      slug: 'fixture-only-co',
      kycTier: 'identity',
      commissionRate: '20.00',
    })
    await db.insert(experiences).values({
      vendorUserId: 'v2',
      slug: 'payout-gate-fixture-bir-billing',
      title: 'payout-gate-fixture-bir-billing',
      status: 'published',
      cancellationPreset: 'moderate',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: '1000.00',
      pricePerPerson_3_5: '900.00',
      pricePerPerson_6_plus: '800.00',
      regionSlug: 'bir-billing',
      activitySlug: 'paragliding',
    })

    const entries = await generateVendorSitemapUrls(db, 'en')
    const urls = entries.map((e) => e.url)
    // v-adventures has a real published Experience → present.
    expect(urls.some((u) => u.endsWith('/vendor/v-adventures'))).toBe(true)
    // fixture-only-co's only catalog is a fixture → absent.
    expect(urls.some((u) => u.endsWith('/vendor/fixture-only-co'))).toBe(false)
  })
})
