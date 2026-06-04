import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  deriveHighlight,
  loadExperienceBookingCountMap,
  loadExperienceRatingMap,
} from './card-badges'

/**
 * Social-proof derivation thresholds (pinned here, RED-first):
 *   - bestseller : bookingCount >= 6      (real demand, sustained interest)
 *   - top_rated  : ratingAvg >= 4.6 AND ratingCount >= 5  (quantified excellence)
 *   - bestseller takes precedence over top_rated.
 * Thresholds are deliberately strict so badges stay sparse / earned.
 */
describe('deriveHighlight', () => {
  it('returns null when there is no demand and no rating', () => {
    expect(
      deriveHighlight({ ratingAvg: null, ratingCount: 0, bookingCount: 0 }),
    ).toBeNull()
  })

  it('returns bestseller at the bookingCount >= 6 boundary (not at 5)', () => {
    expect(
      deriveHighlight({ ratingAvg: null, ratingCount: 0, bookingCount: 5 }),
    ).toBeNull()
    expect(
      deriveHighlight({ ratingAvg: null, ratingCount: 0, bookingCount: 6 }),
    ).toBe('bestseller')
  })

  it('returns top_rated only at ratingAvg >= 4.6 AND ratingCount >= 5', () => {
    // 4.59 avg fails regardless of count
    expect(
      deriveHighlight({ ratingAvg: 4.59, ratingCount: 5, bookingCount: 0 }),
    ).toBeNull()
    // 4.6 avg but only 4 reviews fails the count gate
    expect(
      deriveHighlight({ ratingAvg: 4.6, ratingCount: 4, bookingCount: 0 }),
    ).toBeNull()
    // 4.6 avg and 5 reviews qualifies
    expect(
      deriveHighlight({ ratingAvg: 4.6, ratingCount: 5, bookingCount: 0 }),
    ).toBe('top_rated')
  })

  it('prefers bestseller over top_rated when both qualify', () => {
    expect(
      deriveHighlight({ ratingAvg: 4.9, ratingCount: 20, bookingCount: 10 }),
    ).toBe('bestseller')
  })
})

describe('loadExperienceRatingMap + loadExperienceBookingCountMap (PGlite)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let expA: string
  let expB: string
  // Monotonic offset so each seeded slot gets a unique start_at per experience
  // (availability_slots has a UNIQUE (experience_id, start_at) constraint).
  let slotSeq = 0

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_v', email: 'vendor@test.com', name: 'Vendor' },
      { id: 'u_c', email: 'customer@test.com', name: 'Customer' },
    ])
    await db.insert(vendorProfiles).values([
      {
        userId: 'u_v',
        businessName: 'Test Adventures',
        slug: 'test-adventures',
        responseTimeSlaScore: '100.00',
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

    const [a] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'rafting-a',
        title: 'Rafting A',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500.00',
        pricePerPerson_3_5: '1300.00',
        pricePerPerson_6_plus: '1100.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'published',
      })
      .returning({ id: experiences.id })
    const [b] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'rafting-b',
        title: 'Rafting B',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500.00',
        pricePerPerson_3_5: '1300.00',
        pricePerPerson_6_plus: '1100.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'published',
      })
      .returning({ id: experiences.id })
    expA = a!.id
    expB = b!.id
  })

  async function seedBooking(
    experienceId: string,
    state:
      | 'confirmed'
      | 'completed'
      | 'awaiting_completion'
      | 'cancelled_by_customer'
      | 'pending_payment',
  ): Promise<string> {
    slotSeq += 1
    const startAt = new Date(Date.now() + slotSeq * 24 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_c',
        experienceId,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'full_upfront',
        state,
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
      .returning({ id: bookings.id })
    return booking!.id
  }

  async function seedReview(
    experienceId: string,
    rating: number,
    status: 'pending' | 'published' | 'flagged' | 'removed',
  ): Promise<void> {
    const bookingId = await seedBooking(experienceId, 'completed')
    await db.insert(reviews).values({
      bookingId,
      customerUserId: 'u_c',
      experienceId,
      vendorUserId: 'u_v',
      rating,
      status,
    })
  }

  describe('loadExperienceRatingMap', () => {
    it('returns empty map for empty ids', async () => {
      const map = await loadExperienceRatingMap(db, [])
      expect(map.size).toBe(0)
    })

    it('averages only published reviews (count + avg rounded to 1dp)', async () => {
      // expA: published 5, 4, 4 -> avg 4.333.. -> 4.3, count 3
      await seedReview(expA, 5, 'published')
      await seedReview(expA, 4, 'published')
      await seedReview(expA, 4, 'published')
      // non-published reviews must be ignored entirely
      await seedReview(expA, 1, 'pending')
      await seedReview(expA, 1, 'flagged')
      await seedReview(expA, 1, 'removed')

      const map = await loadExperienceRatingMap(db, [expA, expB])
      expect(map.get(expA)).toEqual({ avg: 4.3, count: 3 })
      // expB has no reviews -> absent from map
      expect(map.has(expB)).toBe(false)
    })

    it('omits experiences whose only reviews are non-published', async () => {
      await seedReview(expA, 5, 'pending')
      const map = await loadExperienceRatingMap(db, [expA])
      expect(map.has(expA)).toBe(false)
    })
  })

  describe('loadExperienceBookingCountMap', () => {
    it('returns empty map for empty ids', async () => {
      const map = await loadExperienceBookingCountMap(db, [])
      expect(map.size).toBe(0)
    })

    it('counts demand states and excludes cancelled / pending', async () => {
      // expA: 1 confirmed + 1 completed + 1 awaiting_completion = 3 demand
      await seedBooking(expA, 'confirmed')
      await seedBooking(expA, 'completed')
      await seedBooking(expA, 'awaiting_completion')
      // excluded states
      await seedBooking(expA, 'cancelled_by_customer')
      await seedBooking(expA, 'pending_payment')

      const map = await loadExperienceBookingCountMap(db, [expA, expB])
      expect(map.get(expA)).toBe(3)
      expect(map.has(expB)).toBe(false)
    })
  })
})
