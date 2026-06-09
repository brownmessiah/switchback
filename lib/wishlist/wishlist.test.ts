import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { customerProfiles } from '@/db/schema/customer-profiles'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  getWishlistExperiences,
  getWishlistIds,
  isInWishlist,
  toggleWishlist,
} from './wishlist'

/**
 * Customer wishlist (Issue #08). The store is `customer_profiles.wishlist`
 * — a jsonb array of Experience UUIDs. The pure core toggles membership
 * idempotently, resolves saved ids to PUBLISHED ExperienceCardData rows
 * (dropping archived/missing), and never throws on a stale id during
 * removal.
 */
describe('wishlist pure core (Issue #08)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  // Two PUBLISHED experiences + one ARCHIVED, owned by a single vendor.
  let publishedA: string
  let publishedB: string
  let archived: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_v', email: 'v@example.com' },
      { id: 'u_c', email: 'c@example.com' },
    ])
    await db.insert(vendorProfiles).values({
      userId: 'u_v',
      businessName: 'Test Adventures',
      slug: 'test-adventures',
      pan: 'ABCDE1234F',
      commissionRate: '20.00',
      payoutMethod: 'upi',
      payoutDestination: { vpa: 'vendor@upi' },
    })

    const inserted = await db
      .insert(experiences)
      .values([
        {
          vendorUserId: 'u_v',
          slug: 'rishikesh-rafting-grade-iii',
          title: 'Grade III Rafting in Rishikesh',
          shortDescription: 'A thrilling stretch of the Ganges.',
          cancellationPreset: 'flexible',
          paymentModesAllowed: ['full_upfront'],
          pricePerPerson_1_2: '1500.75',
          pricePerPerson_3_5: '1400.00',
          pricePerPerson_6_plus: '1300.00',
          regionSlug: 'rishikesh',
          activitySlug: 'rafting',
          status: 'published',
        },
        {
          vendorUserId: 'u_v',
          slug: 'goa-scuba-diving-padi-dsd',
          title: 'PADI Discover Scuba in Goa',
          shortDescription: 'Your first breath underwater.',
          cancellationPreset: 'moderate',
          paymentModesAllowed: ['full_upfront'],
          pricePerPerson_1_2: '4500.00',
          pricePerPerson_3_5: '4200.00',
          pricePerPerson_6_plus: '4000.00',
          regionSlug: 'goa',
          activitySlug: 'scuba',
          status: 'published',
        },
        {
          vendorUserId: 'u_v',
          slug: 'manali-trek-archived',
          title: 'Archived Manali Trek',
          shortDescription: null,
          cancellationPreset: 'strict',
          paymentModesAllowed: ['full_upfront'],
          pricePerPerson_1_2: '2000.00',
          pricePerPerson_3_5: '1900.00',
          pricePerPerson_6_plus: '1800.00',
          regionSlug: 'manali',
          activitySlug: 'trekking',
          status: 'archived',
        },
      ])
      .returning({ id: experiences.id, slug: experiences.slug })

    publishedA = inserted.find((e) => e.slug === 'rishikesh-rafting-grade-iii')!.id
    publishedB = inserted.find((e) => e.slug === 'goa-scuba-diving-padi-dsd')!.id
    archived = inserted.find((e) => e.slug === 'manali-trek-archived')!.id
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    // Reset the customer profile to an empty wishlist before each test.
    await db.delete(customerProfiles).where(eq(customerProfiles.userId, 'u_c'))
    await db.insert(customerProfiles).values({ userId: 'u_c', wishlist: [] })
  })

  describe('toggleWishlist', () => {
    it('adds the id when absent, returning saved=true', async () => {
      const result = await toggleWishlist(db, 'u_c', publishedA)
      expect(result.saved).toBe(true)
      expect(result.wishlist).toEqual([publishedA])

      const ids = await getWishlistIds(db, 'u_c')
      expect(ids).toEqual([publishedA])
    })

    it('removes the id when present, returning saved=false (idempotent toggle)', async () => {
      await toggleWishlist(db, 'u_c', publishedA)
      const result = await toggleWishlist(db, 'u_c', publishedA)
      expect(result.saved).toBe(false)
      expect(result.wishlist).toEqual([])

      const ids = await getWishlistIds(db, 'u_c')
      expect(ids).toEqual([])
    })

    it('does not throw when removing a stale id that is not a valid experience', async () => {
      const stale = '00000000-0000-0000-0000-000000000000'
      // Seed the wishlist with a stale id directly, then toggle it off.
      await db
        .update(customerProfiles)
        .set({ wishlist: [stale] })
        .where(eq(customerProfiles.userId, 'u_c'))

      const result = await toggleWishlist(db, 'u_c', stale)
      expect(result.saved).toBe(false)
      expect(result.wishlist).toEqual([])
    })

    it('keeps existing ids when toggling a different id', async () => {
      await toggleWishlist(db, 'u_c', publishedA)
      const result = await toggleWishlist(db, 'u_c', publishedB)
      expect(result.saved).toBe(true)
      expect(result.wishlist).toEqual([publishedA, publishedB])
    })
  })

  describe('isInWishlist', () => {
    it('reflects membership', async () => {
      expect(await isInWishlist(db, 'u_c', publishedA)).toBe(false)
      await toggleWishlist(db, 'u_c', publishedA)
      expect(await isInWishlist(db, 'u_c', publishedA)).toBe(true)
    })
  })

  describe('getWishlistExperiences', () => {
    it('returns ExperienceCardData-shaped rows for saved PUBLISHED experiences', async () => {
      await toggleWishlist(db, 'u_c', publishedA)
      const rows = await getWishlistExperiences(db, 'u_c')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toEqual({
        id: publishedA,
        slug: 'rishikesh-rafting-grade-iii',
        title: 'Grade III Rafting in Rishikesh',
        shortDescription: 'A thrilling stretch of the Ganges.',
        // floor of pricePerPerson_1_2 (1500.75 → 1500)
        pricePerParticipantRupees: 1500,
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        // Additive card-tag fields (difficulty + social-proof + rating). This
        // fixture has no difficulty, reviews, or bookings → all empty.
        difficulty: null,
        ratingAvg: null,
        ratingCount: 0,
        highlight: null,
        // Trust-badge backing fields (issue 05) — from the seeded experience
        // (flexible preset, full_upfront only, no safety stack) + phone-tier
        // vendor (no kycTier set → default 'phone').
        cancellationPreset: 'flexible',
        requiresSafetyStack: false,
        paymentModesAllowed: ['full_upfront'],
        vendorKycTier: 'phone',
      })
    })

    it('returns an empty array for a customer with an empty wishlist', async () => {
      const rows = await getWishlistExperiences(db, 'u_c')
      expect(rows).toEqual([])
    })

    it('drops a saved id that resolves to an ARCHIVED experience', async () => {
      // Save one published + the archived experience.
      await db
        .update(customerProfiles)
        .set({ wishlist: [publishedB, archived] })
        .where(eq(customerProfiles.userId, 'u_c'))

      const rows = await getWishlistExperiences(db, 'u_c')
      expect(rows.map((r) => r.id)).toEqual([publishedB])
    })

    it('drops a saved id that no longer resolves to any experience', async () => {
      const missing = '11111111-1111-1111-1111-111111111111'
      await db
        .update(customerProfiles)
        .set({ wishlist: [publishedA, missing] })
        .where(eq(customerProfiles.userId, 'u_c'))

      const rows = await getWishlistExperiences(db, 'u_c')
      expect(rows.map((r) => r.id)).toEqual([publishedA])
    })

    it('returns an empty array for an unknown user (no profile row)', async () => {
      const rows = await getWishlistExperiences(db, 'u_does_not_exist')
      expect(rows).toEqual([])
    })
  })

  describe('getWishlistIds', () => {
    it('returns an empty array for an unknown user', async () => {
      const ids = await getWishlistIds(db, 'u_does_not_exist')
      expect(ids).toEqual([])
    })
  })

  describe('toggleWishlist validation', () => {
    it('does not add an id that is not a published experience', async () => {
      // Toggling an ARCHIVED experience must not add it (validate-before-add).
      const result = await toggleWishlist(db, 'u_c', archived)
      expect(result.saved).toBe(false)
      expect(result.wishlist).toEqual([])
    })
  })
})
