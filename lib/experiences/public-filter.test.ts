import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { FIXTURE_EXPERIENCE_SLUGS } from './fixture-slugs'
import {
  isPubliclyVisibleExperience,
  publiclyVisibleExperienceCondition,
} from './public-filter'

const NON_PUBLISHED_STATUSES = [
  'draft',
  'pending_review',
  'paused',
  'archived',
] as const

describe('isPubliclyVisibleExperience (in-memory predicate)', () => {
  it('returns true for a published, non-fixture Experience', () => {
    expect(
      isPubliclyVisibleExperience({ status: 'published', slug: 'rafting-in-rishikesh' }),
    ).toBe(true)
  })

  it.each(NON_PUBLISHED_STATUSES)(
    'returns false for a %s (non-published) Experience',
    (status) => {
      expect(isPubliclyVisibleExperience({ status, slug: 'rafting-in-rishikesh' })).toBe(false)
    },
  )

  it.each(FIXTURE_EXPERIENCE_SLUGS)(
    'returns false for fixture slug %s even when published',
    (slug) => {
      expect(isPubliclyVisibleExperience({ status: 'published', slug })).toBe(false)
    },
  )

  it('returns false for a non-published fixture (both gates fail)', () => {
    expect(
      isPubliclyVisibleExperience({
        status: 'pending_review',
        slug: 'mod-pending-approve-within-cap',
      }),
    ).toBe(false)
  })
})

describe('publiclyVisibleExperienceCondition (Drizzle WHERE builder)', () => {
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
  })

  async function seedExp(
    slug: string,
    status: 'draft' | 'pending_review' | 'published' | 'paused' | 'archived',
  ): Promise<void> {
    await db.insert(experiences).values({
      vendorUserId: 'v1',
      slug,
      title: slug,
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

  it('selects only published, non-fixture Experiences', async () => {
    await seedExp('real-published', 'published')
    await seedExp('real-draft', 'draft')
    await seedExp('real-paused', 'paused')
    await seedExp('commission-scope-fixture-bir-billing', 'published')

    const rows = await db
      .select({ slug: experiences.slug })
      .from(experiences)
      .where(publiclyVisibleExperienceCondition())

    expect(rows.map((r) => r.slug)).toEqual(['real-published'])
  })

  it('composes with other conditions via and()', async () => {
    await seedExp('rishikesh-published', 'published')
    await seedExp('payout-queue-fixture-bir-billing', 'published')

    const rows = await db
      .select({ slug: experiences.slug })
      .from(experiences)
      .where(and(eq(experiences.regionSlug, 'rishikesh'), publiclyVisibleExperienceCondition()))

    expect(rows.map((r) => r.slug)).toEqual(['rishikesh-published'])
  })
})
