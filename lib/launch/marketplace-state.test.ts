import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { FIXTURE_EXPERIENCE_SLUGS } from '@/lib/experiences/fixture-slugs'
import { generateExperienceSitemapUrls } from '@/lib/seo/sitemap'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { getMarketplaceState } from './marketplace-state'

/**
 * Marketplace state (launch-readiness 04) — derived from data, never a
 * manual flag, so the day a real Vendor publishes their first Experience
 * the home page becomes the live marketplace home by itself and nobody
 * has to remember to flip anything on launch day.
 */
describe('getMarketplaceState', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values({
      id: 'u_ms_vendor',
      email: 'ms-vendor@test.com',
      name: 'State Vendor',
    })
    await db.insert(vendorProfiles).values({
      userId: 'u_ms_vendor',
      businessName: 'State Co',
      slug: 'state-co',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.delete(experiences)
  })

  async function addExperience(
    slug: string,
    status: 'draft' | 'pending_review' | 'published' | 'paused' | 'archived',
  ): Promise<void> {
    await db.insert(experiences).values({
      vendorUserId: 'u_ms_vendor',
      title: `Experience ${slug}`,
      slug,
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

  it('reports pre-launch on an empty database', async () => {
    expect(await getMarketplaceState(db)).toBe('pre-launch')
  })

  it('reports live as soon as one publicly-visible Experience exists', async () => {
    await addExperience('real-rafting-trip', 'published')
    expect(await getMarketplaceState(db)).toBe('live')
  })

  it.each([
    ['draft', 'draft'],
    ['pending_review', 'pending_review'],
    ['paused', 'paused'],
    ['archived', 'archived'],
  ] as const)('does not count a %s Experience toward live', async (_label, status) => {
    await addExperience(`not-visible-${status}`, status)
    expect(await getMarketplaceState(db)).toBe('pre-launch')
  })

  it('does not count published fixture Experiences toward live', async () => {
    for (const slug of FIXTURE_EXPERIENCE_SLUGS) {
      await addExperience(slug, 'published')
    }
    expect(await getMarketplaceState(db)).toBe('pre-launch')
  })

  it('reports live when a real Experience sits alongside fixtures', async () => {
    for (const slug of FIXTURE_EXPERIENCE_SLUGS) {
      await addExperience(slug, 'published')
    }
    await addExperience('genuine-listing', 'published')
    expect(await getMarketplaceState(db)).toBe('live')
  })

  it('returns to pre-launch once the last publicly-visible Experience is gone (the purge case)', async () => {
    await addExperience('doomed-seed-listing', 'published')
    expect(await getMarketplaceState(db)).toBe('live')

    await db.delete(experiences)
    expect(await getMarketplaceState(db)).toBe('pre-launch')
  })

  // The sitemap gates on the SAME condition, so "no Experience URLs when
  // none are published" needs no sitemap code of its own — but that is
  // only true while the two stay in agreement, which is what this pins.
  it('agrees with the sitemap: pre-launch implies zero Experience sitemap entries', async () => {
    expect(await getMarketplaceState(db)).toBe('pre-launch')
    expect(await generateExperienceSitemapUrls(db, 'en')).toEqual([])

    await addExperience('sitemap-listed-trip', 'published')
    expect(await getMarketplaceState(db)).toBe('live')
    const entries = await generateExperienceSitemapUrls(db, 'en')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.url).toContain('/experience/sitemap-listed-trip')
  })
})
