import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { loadHomePageData } from '@/lib/home/queries'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

/**
 * Wiring contract (issue 05): the home loader must carry the trust-badge
 * backing fields onto each featured card so the shared TrustBadge renders with
 * REAL per-listing data. Proven once here; the same `...resolveTrust(id)` spread
 * is replicated across the other card loaders.
 */
describe('loadHomePageData — trust-badge fields wiring', () => {
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
        kycTier: 'business',
      },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)
    await db.insert(experiences).values({
      vendorUserId: 'u_v',
      slug: 'rafting-flex-safe',
      title: 'Rafting Flex Safe',
      cancellationPreset: 'flexible',
      paymentModesAllowed: ['full_upfront', 'partial_pay'],
      pricePerPerson_1_2: '1500.00',
      pricePerPerson_3_5: '1300.00',
      pricePerPerson_6_plus: '1100.00',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
      requiresSafetyStack: true,
      status: 'published',
    })
  })

  it('populates cancellationPreset, requiresSafetyStack, paymentModesAllowed, vendorKycTier', async () => {
    const data = await loadHomePageData(db)
    const card = data.featuredExperiences.find((e) => e.slug === 'rafting-flex-safe')
    expect(card).toBeTruthy()
    expect(card?.cancellationPreset).toBe('flexible')
    expect(card?.requiresSafetyStack).toBe(true)
    expect(card?.paymentModesAllowed).toEqual(['full_upfront', 'partial_pay'])
    expect(card?.vendorKycTier).toBe('business')
  })
})
