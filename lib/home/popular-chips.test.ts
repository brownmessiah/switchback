import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { loadPopularSearchChips } from '@/lib/home/popular-chips'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

/**
 * Popular search chips (issue 09 / DECISION D0): the home hero offers a few
 * high-intent (Destination × Activity) shortcuts — "Rishikesh Rafting", "Goa
 * Scuba" etc. A chip renders ONLY if its exact (region, activity) pair has REAL
 * published, non-fixture inventory; a chip pointing at empty results must NOT
 * render (a dead chip → 0 results + noindex, which the issue forbids).
 *
 * This is proven against a seeded DB so the gate is the real published-count
 * query (shared `publiclyVisibleExperienceCondition`), not a hardcoded list.
 */
describe('loadPopularSearchChips — inventory-gated home chips', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  function publishedExperience(
    over: Partial<typeof experiences.$inferInsert>,
  ): typeof experiences.$inferInsert {
    return {
      vendorUserId: 'u_v',
      slug: 'placeholder',
      title: 'Placeholder',
      cancellationPreset: 'flexible',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: '1500.00',
      pricePerPerson_3_5: '1300.00',
      pricePerPerson_6_plus: '1100.00',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
      requiresSafetyStack: true,
      status: 'published',
      ...over,
    }
  }

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
        kycTier: 'business',
      },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)
  })

  it('renders only chips whose (region, activity) pair has published inventory', async () => {
    await db.insert(experiences).values([
      publishedExperience({ slug: 'rk-raft', regionSlug: 'rishikesh', activitySlug: 'rafting' }),
      publishedExperience({ slug: 'goa-scuba', regionSlug: 'goa', activitySlug: 'scuba-diving' }),
    ])

    const chips = await loadPopularSearchChips(db)
    const keys = chips.map((c) => `${c.regionSlug}:${c.activitySlug}`)

    expect(keys).toContain('rishikesh:rafting')
    expect(keys).toContain('goa:scuba-diving')
    // Bir-Billing paragliding has NO inventory here → must NOT appear.
    expect(keys).not.toContain('bir-billing:paragliding')
  })

  it('excludes a chip whose pair is only present as a non-published (draft) listing', async () => {
    await db.insert(experiences).values([
      publishedExperience({ slug: 'rk-raft', regionSlug: 'rishikesh', activitySlug: 'rafting' }),
      publishedExperience({
        slug: 'goa-scuba-draft',
        regionSlug: 'goa',
        activitySlug: 'scuba-diving',
        status: 'draft',
      }),
    ])

    const chips = await loadPopularSearchChips(db)
    const keys = chips.map((c) => `${c.regionSlug}:${c.activitySlug}`)

    expect(keys).toContain('rishikesh:rafting')
    expect(keys).not.toContain('goa:scuba-diving')
  })

  it('returns chips whose href is the home-query URL for the pair', async () => {
    await db.insert(experiences).values([
      publishedExperience({ slug: 'rk-raft', regionSlug: 'rishikesh', activitySlug: 'rafting' }),
    ])

    const chips = await loadPopularSearchChips(db)
    const rishikeshRafting = chips.find(
      (c) => c.regionSlug === 'rishikesh' && c.activitySlug === 'rafting',
    )
    expect(rishikeshRafting).toBeDefined()
    expect(rishikeshRafting?.href).toBe('/search?region=rishikesh&activity=rafting')
  })

  it('carries the registry display names + i18n key suffixes for the pair', async () => {
    await db.insert(experiences).values([
      publishedExperience({ slug: 'rk-raft', regionSlug: 'rishikesh', activitySlug: 'rafting' }),
    ])

    const chips = await loadPopularSearchChips(db)
    const chip = chips.find(
      (c) => c.regionSlug === 'rishikesh' && c.activitySlug === 'rafting',
    )
    expect(chip?.regionNameEn).toBe('Rishikesh')
    expect(chip?.activityNameEn).toBe('Rafting')
    // i18n key suffixes are the hyphen-free registry-slug camelisations used by
    // the existing facet-options module.
    expect(chip?.regionI18nKey).toBe('rishikesh')
    expect(chip?.activityI18nKey).toBe('rafting')
  })

  it('returns an empty list when no candidate pair has inventory', async () => {
    // A published Experience for a pair that is NOT in the curated candidate set.
    await db.insert(experiences).values([
      publishedExperience({ slug: 'lon-camp', regionSlug: 'lonavala', activitySlug: 'kayaking' }),
    ])
    const chips = await loadPopularSearchChips(db)
    expect(chips).toEqual([])
  })
})
