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

import { attachReviewPhoto } from './photos'

/**
 * Photo-attach core (issue 19). Only the Customer who OWNS the Review (a
 * completed-Booking Review per ADR-0003 eligibility, enforced at review
 * create time) may attach photos, and every attached photo enters
 * status='pending' for moderation.
 */
describe('attachReviewPhoto (owner-gated, enters pending)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values({ id: 'u_v', email: 'v@example.com' })
    await db.insert(users).values({ id: 'u_c', email: 'c@example.com', name: 'Asha' })
    await db.insert(users).values({ id: 'u_other', email: 'o@example.com', name: 'Other' })
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
        slug: 'rp-attach',
        title: 'RP Attach',
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

  it('lets the review-owning Customer attach a photo as pending', async () => {
    const reviewId = await seedReview()
    const result = await attachReviewPhoto(db, 'u_c', {
      reviewId,
      storageKey: 'reviews/owner.jpg',
      url: '/uploads/reviews/owner.jpg',
      altText: 'A great day',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const rows = await db
      .select()
      .from(reviewPhotos)
      .where(eq(reviewPhotos.reviewId, reviewId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: 'pending',
      uploadedByUserId: 'u_c',
      storageKey: 'reviews/owner.jpg',
      url: '/uploads/reviews/owner.jpg',
      altText: 'A great day',
    })
    expect(result.photo).toMatchObject({
      id: rows[0]!.id,
      url: '/uploads/reviews/owner.jpg',
      storageKey: 'reviews/owner.jpg',
    })
  })

  it('rejects a non-owner Customer attaching to the review', async () => {
    const reviewId = await seedReview()
    const result = await attachReviewPhoto(db, 'u_other', {
      reviewId,
      storageKey: 'reviews/intruder.jpg',
      url: '/uploads/reviews/intruder.jpg',
    })
    expect(result.ok).toBe(false)
    const rows = await db
      .select()
      .from(reviewPhotos)
      .where(eq(reviewPhotos.reviewId, reviewId))
    expect(rows).toHaveLength(0)
  })

  it('rejects attaching to a non-existent review', async () => {
    const result = await attachReviewPhoto(db, 'u_c', {
      reviewId: '00000000-0000-0000-0000-000000000000',
      storageKey: 'reviews/ghost.jpg',
      url: '/uploads/reviews/ghost.jpg',
    })
    expect(result.ok).toBe(false)
  })
})
