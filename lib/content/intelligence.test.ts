import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { FIXTURE_EXPERIENCE_SLUGS } from '@/lib/experiences/fixture-slugs'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  deriveActivityIntelligence,
  deriveRegionIntelligence,
} from './intelligence'

/**
 * Issue 22 — data-derived intelligence sections.
 *
 * Every derivation is gated through `publiclyVisibleExperienceCondition()`
 * (status='published' AND non-fixture). These tests prove the derivations are
 * correct, empty-safe, and never leak a fixture/unpublished Experience.
 */
describe('lib/content/intelligence', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_v', email: 'v@test.com', name: 'V' },
      { id: 'u_c', email: 'c@test.com', name: 'C' },
    ])
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
    await db.execute(
      sql`TRUNCATE TABLE reviews, bookings, availability_slots, experiences CASCADE`,
    )
  })

  let slotSeq = 0
  /** Seed N demand bookings on an experience (mirrors card-badges.test.ts). */
  async function seedDemand(experienceId: string, n: number): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      slotSeq += 1
      const startAt = new Date(Date.now() + slotSeq * 24 * 60 * 60 * 1000)
      const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
      const [slot] = await db
        .insert(availabilitySlots)
        .values({ experienceId, startAt, endAt, capacity: 8 })
        .returning({ id: availabilitySlots.id })
      await db.insert(bookings).values({
        customerUserId: 'u_c',
        experienceId,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'full_upfront',
        state: 'completed',
        grossTotalSnapshot: '3000.00',
        pricePerParticipantSnapshot: '1500.00',
        pricingBasisSnapshot: 'experience_bracket:1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: 'flexible',
        tdsAmountSnapshot: '30.00',
        gstRateOnCommissionSnapshot: '18.00',
        vendorPanSnapshot: 'ABCDE1234F',
        vendorIsResidentSnapshot: true,
        payoutMethodSnapshot: 'upi',
        payoutDestinationSnapshot: { vpa: 'vendor@upi' },
      })
    }
  }

  const baseExp = {
    vendorUserId: 'u_v',
    cancellationPreset: 'flexible' as const,
    paymentModesAllowed: ['full_upfront'] as ('full_upfront' | 'partial_pay')[],
  }

  /** Flat-priced bracket helper: all three group-size brackets equal `p`. */
  function flat(p: string): {
    pricePerPerson_1_2: string
    pricePerPerson_3_5: string
    pricePerPerson_6_plus: string
  } {
    return {
      pricePerPerson_1_2: p,
      pricePerPerson_3_5: p,
      pricePerPerson_6_plus: p,
    }
  }

  async function seedRishikesh(): Promise<void> {
    await db.insert(experiences).values([
      // Two published rafting Experiences in Rishikesh (Uttarakhand).
      {
        ...baseExp,
        ...flat('1500.00'),
        slug: 'rishi-rafting-1',
        title: 'Ganga Rafting',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        difficulty: 'moderate',
        status: 'published',
      },
      {
        ...baseExp,
        ...flat('4500.00'),
        slug: 'rishi-rafting-2',
        title: 'Grade IV Rapids',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        difficulty: 'challenging',
        status: 'published',
      },
      // One published bungee in Rishikesh.
      {
        ...baseExp,
        ...flat('3700.00'),
        slug: 'rishi-bungee-1',
        title: 'Mohan Chatti Bungee',
        regionSlug: 'rishikesh',
        activitySlug: 'bungee-jumping',
        difficulty: 'extreme',
        status: 'published',
      },
      // A DRAFT Experience — must be excluded from every derivation.
      {
        ...baseExp,
        ...flat('100.00'),
        slug: 'rishi-draft',
        title: 'Draft Trek (cheap)',
        regionSlug: 'rishikesh',
        activitySlug: 'trekking',
        difficulty: 'easy',
        status: 'draft',
      },
      // A published FIXTURE — must be excluded from every derivation.
      {
        ...baseExp,
        ...flat('99999.00'),
        slug: FIXTURE_EXPERIENCE_SLUGS[0],
        title: 'Fixture (very expensive)',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        difficulty: 'easy',
        status: 'published',
      },
      // A published Experience in Auli — same state (Uttarakhand) → "nearby".
      {
        ...baseExp,
        ...flat('2000.00'),
        slug: 'auli-skiing-1',
        title: 'Auli Skiing',
        regionSlug: 'auli',
        activitySlug: 'skiing',
        difficulty: 'moderate',
        status: 'published',
      },
      // A published Experience in Goa — different state → NOT nearby.
      {
        ...baseExp,
        ...flat('5000.00'),
        slug: 'goa-scuba-1',
        title: 'Goa Scuba',
        regionSlug: 'goa',
        activitySlug: 'scuba-diving',
        difficulty: 'easy',
        status: 'published',
      },
    ])
  }

  describe('deriveRegionIntelligence', () => {
    it('returns null for an unregistered region slug', async () => {
      expect(await deriveRegionIntelligence(db, 'atlantis')).toBeNull()
    })

    it('price range = min/max across PUBLISHED non-fixture experiences only', async () => {
      await seedRishikesh()
      const data = await deriveRegionIntelligence(db, 'rishikesh')
      // min from the 1500 rafting, max from the 4500 rafting; draft (100) and
      // fixture (99999) excluded.
      expect(data?.priceRange).toEqual({ minRupees: 1500, maxRupees: 4500 })
    })

    it('top activities ranked by published-inventory count', async () => {
      await seedRishikesh()
      const data = await deriveRegionIntelligence(db, 'rishikesh')
      // rafting=2 (the fixture rafting is excluded), bungee=1; trekking draft excluded.
      expect(data?.topActivities).toEqual([
        { slug: 'rafting', count: 2 },
        { slug: 'bungee-jumping', count: 1 },
      ])
    })

    it('difficulty spread counts PUBLISHED non-fixture experiences only', async () => {
      await seedRishikesh()
      const data = await deriveRegionIntelligence(db, 'rishikesh')
      // moderate=1, challenging=1, extreme=1; draft easy + fixture easy excluded.
      expect(data?.difficultySpread).toEqual([
        { difficulty: 'moderate', count: 1 },
        { difficulty: 'challenging', count: 1 },
        { difficulty: 'extreme', count: 1 },
      ])
    })

    it('nearby = OTHER same-state regions with published inventory (no distance)', async () => {
      await seedRishikesh()
      const data = await deriveRegionIntelligence(db, 'rishikesh')
      // Auli is Uttarakhand with inventory → nearby. Goa (different state) excluded.
      // The region itself (rishikesh) is excluded. No distance/coords fabricated.
      expect(data?.nearbyRegions).toEqual([{ slug: 'auli', count: 1 }])
      // honesty: nearby rows carry no distance field.
      expect(data?.nearbyRegions[0]).not.toHaveProperty('distanceKm')
    })

    it('featured experiences exclude fixtures + unpublished and rank by demand', async () => {
      await seedRishikesh()
      // Give the cheaper rafting real demand so it outranks recency.
      const [{ id: raftingId }] = await db
        .select({ id: experiences.id })
        .from(experiences)
        .where(sql`${experiences.slug} = 'rishi-rafting-1'`)
      await seedDemand(raftingId, 7)

      const data = await deriveRegionIntelligence(db, 'rishikesh')
      const slugs = data?.featured.map((f) => f.slug) ?? []
      // No fixture, no draft leaked.
      expect(slugs).not.toContain(FIXTURE_EXPERIENCE_SLUGS[0])
      expect(slugs).not.toContain('rishi-draft')
      // The high-demand rafting is featured first (bestseller highlight).
      expect(slugs[0]).toBe('rishi-rafting-1')
      expect(data?.featured[0].highlight).toBe('bestseller')
    })

    it('is empty-safe: a region with NO published inventory yields nulls/empties', async () => {
      // Only a draft in manali — nothing published.
      await db.insert(experiences).values([
        {
          ...baseExp,
          ...flat('900.00'),
          slug: 'manali-draft',
          title: 'Manali Draft',
          regionSlug: 'manali',
          activitySlug: 'trekking',
          difficulty: 'easy',
          status: 'draft',
        },
      ])
      const data = await deriveRegionIntelligence(db, 'manali')
      expect(data).not.toBeNull()
      expect(data?.priceRange).toBeNull()
      expect(data?.topActivities).toEqual([])
      expect(data?.difficultySpread).toEqual([])
      expect(data?.nearbyRegions).toEqual([])
      expect(data?.featured).toEqual([])
    })
  })

  describe('deriveActivityIntelligence', () => {
    it('returns null for an unregistered activity slug', async () => {
      expect(await deriveActivityIntelligence(db, 'underwater-basket-weaving')).toBeNull()
    })

    it('price range + top destinations + difficulty from published non-fixture only', async () => {
      await seedRishikesh()
      const data = await deriveActivityIntelligence(db, 'rafting')
      // Only the two real Rishikesh rafting rows (1500, 4500); fixture rafting excluded.
      expect(data?.priceRange).toEqual({ minRupees: 1500, maxRupees: 4500 })
      // Top destinations for rafting: rishikesh has 2 (the analogue of top activities).
      expect(data?.topRegions).toEqual([{ slug: 'rishikesh', count: 2 }])
      expect(data?.difficultySpread).toEqual([
        { difficulty: 'moderate', count: 1 },
        { difficulty: 'challenging', count: 1 },
      ])
    })

    it('is empty-safe: an activity with no published inventory yields nulls/empties', async () => {
      await seedRishikesh()
      // 'kayaking' has no inventory in the seed.
      const data = await deriveActivityIntelligence(db, 'kayaking')
      expect(data).not.toBeNull()
      expect(data?.priceRange).toBeNull()
      expect(data?.topRegions).toEqual([])
      expect(data?.difficultySpread).toEqual([])
      expect(data?.featured).toEqual([])
    })
  })
})
