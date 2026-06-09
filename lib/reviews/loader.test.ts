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

import { loadPublishedReviews } from './loader'

/**
 * Integration coverage for the published-review loader (issue 18): it joins
 * Review → Booking → Availability slot to derive travelMonth (DECISION D5, no
 * new field), surfaces the capture-time group_type, and loads ONLY
 * status='published' reviews. Also exercises the 0024 group_type column
 * (enum values + nullable) replayed by the test harness.
 */
describe('loadPublishedReviews + reviews.group_type (0024)', () => {
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

  async function seedExperience(slug = 'rev-test'): Promise<string> {
    const [row] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug,
        title: 'Rev Test',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '500',
        pricePerPerson_3_5: '500',
        pricePerPerson_6_plus: '500',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    return row!.id
  }

  let slotSeq = 0

  async function seedBooking(experienceId: string, slotStartAt: Date): Promise<string> {
    // Nudge each slot by a unique number of minutes so the
    // (experience_id, start_at) unique index never collides while keeping the
    // start_at within the same calendar month (the unit under test).
    slotSeq += 1
    const startAt = new Date(slotStartAt.getTime() + slotSeq * 60 * 1000)
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
    return booking!.id
  }

  it('accepts all five group_type enum values and allows NULL', async () => {
    const experienceId = await seedExperience()
    for (const gt of ['solo', 'couple', 'friends', 'family', 'corporate'] as const) {
      const bookingId = await seedBooking(experienceId, new Date('2026-06-15T09:00:00Z'))
      await db.insert(reviews).values({
        bookingId,
        customerUserId: 'u_c',
        experienceId,
        vendorUserId: 'u_v',
        rating: 5,
        status: 'published',
        groupType: gt,
      })
    }
    // NULL group type (existing reviews carry none).
    const nullBooking = await seedBooking(experienceId, new Date('2026-06-15T09:00:00Z'))
    await db.insert(reviews).values({
      bookingId: nullBooking,
      customerUserId: 'u_c',
      experienceId,
      vendorUserId: 'u_v',
      rating: 4,
      status: 'published',
    })
    const rows = await db.select().from(reviews).where(eq(reviews.experienceId, experienceId))
    expect(rows).toHaveLength(6)
    expect(rows.filter((r) => r.groupType === null)).toHaveLength(1)
  })

  it('rejects an invalid group_type value', async () => {
    const experienceId = await seedExperience()
    const bookingId = await seedBooking(experienceId, new Date('2026-06-15T09:00:00Z'))
    await expect(
      db.execute(
        sql`INSERT INTO reviews (booking_id, customer_user_id, experience_id, vendor_user_id, rating, status, group_type)
            VALUES (${bookingId}, 'u_c', ${experienceId}, 'u_v', 5, 'published', 'spouse')`,
      ),
    ).rejects.toThrow()
  })

  it('derives travelMonth from the slot start_at and surfaces group type', async () => {
    const experienceId = await seedExperience()
    const bookingId = await seedBooking(experienceId, new Date('2026-06-15T09:00:00Z'))
    await db.insert(reviews).values({
      bookingId,
      customerUserId: 'u_c',
      experienceId,
      vendorUserId: 'u_v',
      rating: 5,
      title: 'Wonderful',
      body: 'Best day out',
      status: 'published',
      groupType: 'family',
    })

    const loaded = await loadPublishedReviews(db, experienceId)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({
      rating: 5,
      title: 'Wonderful',
      customerName: 'Asha',
      travelMonth: 6,
      groupType: 'family',
    })
  })

  it('loads ONLY published reviews', async () => {
    const experienceId = await seedExperience()
    for (const status of ['published', 'pending', 'flagged', 'removed'] as const) {
      const bookingId = await seedBooking(experienceId, new Date('2026-03-10T09:00:00Z'))
      await db.insert(reviews).values({
        bookingId,
        customerUserId: 'u_c',
        experienceId,
        vendorUserId: 'u_v',
        rating: 4,
        status,
      })
    }
    const loaded = await loadPublishedReviews(db, experienceId)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.travelMonth).toBe(3)
  })

  it('returns reviews newest-first by default', async () => {
    const experienceId = await seedExperience()
    const older = await seedBooking(experienceId, new Date('2026-01-05T09:00:00Z'))
    const newer = await seedBooking(experienceId, new Date('2026-05-05T09:00:00Z'))
    await db.insert(reviews).values({
      bookingId: older,
      customerUserId: 'u_c',
      experienceId,
      vendorUserId: 'u_v',
      rating: 5,
      title: 'older',
      status: 'published',
      createdAt: new Date('2026-02-01T00:00:00Z'),
    })
    await db.insert(reviews).values({
      bookingId: newer,
      customerUserId: 'u_c',
      experienceId,
      vendorUserId: 'u_v',
      rating: 3,
      title: 'newer',
      status: 'published',
      createdAt: new Date('2026-06-01T00:00:00Z'),
    })
    const loaded = await loadPublishedReviews(db, experienceId)
    expect(loaded.map((r) => r.title)).toEqual(['newer', 'older'])
  })

  it('attaches ONLY approved photos to each review (issue 19)', async () => {
    const experienceId = await seedExperience()
    const bookingId = await seedBooking(experienceId, new Date('2026-06-15T09:00:00Z'))
    const [review] = await db
      .insert(reviews)
      .values({
        bookingId,
        customerUserId: 'u_c',
        experienceId,
        vendorUserId: 'u_v',
        rating: 5,
        title: 'photos',
        status: 'published',
      })
      .returning({ id: reviews.id })

    await db.insert(reviewPhotos).values([
      {
        reviewId: review!.id,
        uploadedByUserId: 'u_c',
        storageKey: 'reviews/ok.jpg',
        url: '/uploads/reviews/ok.jpg',
        status: 'approved',
        altText: 'approved one',
      },
      {
        reviewId: review!.id,
        uploadedByUserId: 'u_c',
        storageKey: 'reviews/pending.jpg',
        url: '/uploads/reviews/pending.jpg',
        status: 'pending',
      },
      {
        reviewId: review!.id,
        uploadedByUserId: 'u_c',
        storageKey: 'reviews/rejected.jpg',
        url: '/uploads/reviews/rejected.jpg',
        status: 'rejected',
      },
    ])

    const loaded = await loadPublishedReviews(db, experienceId)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.photos).toHaveLength(1)
    expect(loaded[0]!.photos[0]).toMatchObject({
      url: '/uploads/reviews/ok.jpg',
      altText: 'approved one',
    })
  })

  it('returns an empty photos array for a review with no approved photos', async () => {
    const experienceId = await seedExperience()
    const bookingId = await seedBooking(experienceId, new Date('2026-06-15T09:00:00Z'))
    await db.insert(reviews).values({
      bookingId,
      customerUserId: 'u_c',
      experienceId,
      vendorUserId: 'u_v',
      rating: 4,
      status: 'published',
    })
    const loaded = await loadPublishedReviews(db, experienceId)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.photos).toEqual([])
  })
})
