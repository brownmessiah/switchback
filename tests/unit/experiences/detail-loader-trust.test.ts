import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { loadExperienceDetail } from '@/lib/experiences/detail-loader'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

/**
 * Issue 05: the PDP renders trust badges through the shared TrustBadge, so the
 * detail loader must surface the two fields it does not yet expose —
 * `vendorKycTier` (ADR-0007) and `requiresSafetyStack` (ADR-0015). The other
 * inputs (cancellationPreset, paymentModesAllowed, difficulty, base price) are
 * already on ExperienceDetailData.
 */
describe('loadExperienceDetail — trust-badge fields', () => {
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

  it('exposes vendorKycTier and requiresSafetyStack for a safety listing', async () => {
    await db.insert(experiences).values({
      vendorUserId: 'u_v',
      slug: 'rafting-detail',
      title: 'Rafting Detail',
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

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'rafting-detail' })
    expect(result?.type).toBe('found')
    if (result?.type !== 'found') return
    expect(result.data.vendorKycTier).toBe('identity')
    expect(result.data.requiresSafetyStack).toBe(true)
  })

  it('exposes a non-safety listing as requiresSafetyStack=false', async () => {
    await db.insert(experiences).values({
      vendorUserId: 'u_v',
      slug: 'camping-detail',
      title: 'Camping Detail',
      cancellationPreset: 'strict',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: '900.00',
      pricePerPerson_3_5: '900.00',
      pricePerPerson_6_plus: '900.00',
      regionSlug: 'manali',
      activitySlug: 'camping',
      requiresSafetyStack: false,
      status: 'published',
    })

    const result = await loadExperienceDetail(db, { lng: 'en', slug: 'camping-detail' })
    expect(result?.type).toBe('found')
    if (result?.type !== 'found') return
    expect(result.data.requiresSafetyStack).toBe(false)
    expect(result.data.vendorKycTier).toBe('identity')
  })
})
