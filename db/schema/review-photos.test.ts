import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { reviewPhotos } from '@/db/schema/review-photos'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

/**
 * Integration coverage for the 0025 review_photos migration + schema (issue
 * 19): the dedicated review_photos table + review_photo_status enum replayed
 * by the test harness. Asserts the status default is 'pending', the enum
 * rejects unknown values, and the reviewId FK cascades on review delete.
 */
describe('review_photos table + review_photo_status enum (0025)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values({ id: 'u_v', email: 'v@example.com' })
    await db.insert(users).values({ id: 'u_c', email: 'c@example.com', name: 'Asha' })
    await db.insert(vendorProfiles).values({
      userId: 'u_v',
      businessName: 'Test Adventures',
      slug: 'test-adventures',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)
  })

  async function seedReview(): Promise<string> {
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'rp-test',
        title: 'RP Test',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '500',
        pricePerPerson_3_5: '500',
        pricePerPerson_6_plus: '500',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    const [slot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: exp!.id,
        startAt: new Date('2026-06-15T09:00:00Z'),
        endAt: new Date('2026-06-15T13:00:00Z'),
        capacity: 8,
      })
      .returning({ id: availabilitySlots.id })
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_c',
        experienceId: exp!.id,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'full_upfront',
        state: 'completed',
        grossTotalSnapshot: '1000.00',
        pricePerParticipantSnapshot: '500.00',
        pricingBasisSnapshot: 'experience_bracket:1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: 'flexible',
        tdsAmountSnapshot: '10.00',
        gstRateOnCommissionSnapshot: '18.00',
        vendorIsResidentSnapshot: true,
        payoutMethodSnapshot: 'upi',
        payoutDestinationSnapshot: { vpa: 'vendor@upi' },
      })
      .returning({ id: bookings.id })
    const [review] = await db
      .insert(reviews)
      .values({
        bookingId: booking!.id,
        customerUserId: 'u_c',
        experienceId: exp!.id,
        vendorUserId: 'u_v',
        rating: 5,
        status: 'published',
      })
      .returning({ id: reviews.id })
    return review!.id
  }

  it('defaults status to pending on insert', async () => {
    const reviewId = await seedReview()
    const [row] = await db
      .insert(reviewPhotos)
      .values({
        reviewId,
        uploadedByUserId: 'u_c',
        storageKey: 'reviews/photo-a.jpg',
        url: '/uploads/reviews/photo-a.jpg',
      })
      .returning({ id: reviewPhotos.id, status: reviewPhotos.status })
    expect(row!.status).toBe('pending')
  })

  it('accepts all three review_photo_status enum values', async () => {
    const reviewId = await seedReview()
    for (const status of ['pending', 'approved', 'rejected'] as const) {
      await db.insert(reviewPhotos).values({
        reviewId,
        uploadedByUserId: 'u_c',
        storageKey: `reviews/${status}.jpg`,
        url: `/uploads/reviews/${status}.jpg`,
        status,
      })
    }
    const rows = await db
      .select()
      .from(reviewPhotos)
      .where(eq(reviewPhotos.reviewId, reviewId))
    expect(rows).toHaveLength(3)
  })

  it('rejects an invalid review_photo_status value', async () => {
    const reviewId = await seedReview()
    await expect(
      db.execute(
        sql`INSERT INTO review_photos (review_id, uploaded_by_user_id, storage_key, url, status)
            VALUES (${reviewId}, 'u_c', 'k', 'u', 'banned')`,
      ),
    ).rejects.toThrow()
  })

  it('cascades photo deletion when the parent review is deleted', async () => {
    const reviewId = await seedReview()
    await db.insert(reviewPhotos).values({
      reviewId,
      uploadedByUserId: 'u_c',
      storageKey: 'reviews/cascade.jpg',
      url: '/uploads/reviews/cascade.jpg',
    })
    await db.delete(reviews).where(eq(reviews.id, reviewId))
    const remaining = await db
      .select()
      .from(reviewPhotos)
      .where(eq(reviewPhotos.reviewId, reviewId))
    expect(remaining).toHaveLength(0)
  })

  it('allows a nullable altText', async () => {
    const reviewId = await seedReview()
    const [row] = await db
      .insert(reviewPhotos)
      .values({
        reviewId,
        uploadedByUserId: 'u_c',
        storageKey: 'reviews/no-alt.jpg',
        url: '/uploads/reviews/no-alt.jpg',
      })
      .returning({ altText: reviewPhotos.altText })
    expect(row!.altText).toBeNull()
  })
})
