import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { slugRedirects } from '@/db/schema/slug-redirects'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { loadExperienceDetail } from '@/lib/experiences/detail-loader'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

/**
 * QA fix pass: a PUBLISHED fixture Experience (lib/experiences/fixture-slugs.ts)
 * was directly reachable at /experience/{slug} because the detail loader only
 * checked `status='published'` — the one public surface issue 04 deferred.
 * The PDP must apply the same public-visibility rule as every list-query:
 * published AND not a fixture slug, including via the slug-redirect path.
 */
describe('loadExperienceDetail — public-visibility gate', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([{ id: 'u_v', email: 'v@test.com', name: 'V' }])
    await db.insert(vendorProfiles).values([
      {
        userId: 'u_v',
        businessName: 'Verified Co',
        slug: 'verified-co',
        responseTimeSlaScore: '100.00',
        kycTier: 'identity',
      },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)
  })

  function baseExperience(slug: string): typeof experiences.$inferInsert {
    return {
      vendorUserId: 'u_v',
      slug,
      title: `Listing ${slug}`,
      cancellationPreset: 'flexible',
      paymentModesAllowed: ['full_upfront', 'partial_pay'],
      pricePerPerson_1_2: '1500.00',
      pricePerPerson_3_5: '1300.00',
      pricePerPerson_6_plus: '1100.00',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
      status: 'published',
    }
  }

  it('returns null for a published fixture slug requested directly', async () => {
    await db
      .insert(experiences)
      .values(baseExperience('review-moderation-fixture-rishikesh'))

    const result = await loadExperienceDetail(db, {
      slug: 'review-moderation-fixture-rishikesh',
      lng: 'en',
    })

    expect(result).toBeNull()
  })

  it('still returns a published non-fixture listing', async () => {
    await db.insert(experiences).values(baseExperience('rafting-real'))

    const result = await loadExperienceDetail(db, {
      slug: 'rafting-real',
      lng: 'en',
    })

    expect(result).not.toBeNull()
    expect(result?.type).toBe('found')
  })

  it('returns null when a slug redirect targets a fixture listing', async () => {
    const [fixture] = await db
      .insert(experiences)
      .values(baseExperience('payout-queue-fixture-bir-billing'))
      .returning({ id: experiences.id })

    await db.insert(slugRedirects).values({
      oldSlug: 'old-fixture-slug',
      entityType: 'experience',
      entityId: fixture.id,
    })

    const result = await loadExperienceDetail(db, {
      slug: 'old-fixture-slug',
      lng: 'en',
    })

    expect(result).toBeNull()
  })
})
