import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { reviewPhotos } from '@/db/schema/review-photos'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeApproveReviewPhoto,
  executeRejectReviewPhoto,
  loadPendingReviewPhotos,
} from './review-photo-moderation-actions'

/**
 * Photo moderation core (issue 19). An Admin approves or rejects a pending
 * Review photo through the existing review-moderation surface. Approve →
 * 'approved' (the only public state); reject → 'rejected'. Each transition is
 * audit-logged. The moderation-queue loader surfaces pending photos.
 */
describe('review photo moderation core', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let reviewId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_admin', email: 'admin@switchback.com', name: 'Admin' },
      { id: 'u_v', email: 'v@example.com', name: 'Vendor' },
      { id: 'u_c', email: 'c@example.com', name: 'Asha' },
    ])
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
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, review_photos, reviews, bookings, availability_slots, experiences CASCADE`,
    )
    reviewId = await seedReview()
  })

  async function seedReview(): Promise<string> {
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'rp-mod',
        title: 'RP Mod',
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

  async function seedPhoto(status: 'pending' | 'approved' | 'rejected' = 'pending'): Promise<string> {
    const [photo] = await db
      .insert(reviewPhotos)
      .values({
        reviewId,
        uploadedByUserId: 'u_c',
        storageKey: `reviews/${status}-${Math.random().toString(36).slice(2, 8)}.jpg`,
        url: '/uploads/reviews/x.jpg',
        status,
      })
      .returning({ id: reviewPhotos.id })
    return photo!.id
  }

  it('approve moves a pending photo to approved and audit-logs it', async () => {
    const photoId = await seedPhoto('pending')
    const result = await executeApproveReviewPhoto(db, 'u_admin', photoId)
    expect(result.ok).toBe(true)

    const [row] = await db
      .select({ status: reviewPhotos.status })
      .from(reviewPhotos)
      .where(eq(reviewPhotos.id, photoId))
    expect(row!.status).toBe('approved')

    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'admin.review_photo.approve'))
    expect(logs).toHaveLength(1)
    expect(logs[0]!.entityId).toBe(photoId)
  })

  it('reject moves a pending photo to rejected and audit-logs it', async () => {
    const photoId = await seedPhoto('pending')
    const result = await executeRejectReviewPhoto(db, 'u_admin', photoId)
    expect(result.ok).toBe(true)

    const [row] = await db
      .select({ status: reviewPhotos.status })
      .from(reviewPhotos)
      .where(eq(reviewPhotos.id, photoId))
    expect(row!.status).toBe('rejected')

    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'admin.review_photo.reject'))
    expect(logs).toHaveLength(1)
  })

  it('returns an error for a non-existent photo', async () => {
    const result = await executeApproveReviewPhoto(
      db,
      'u_admin',
      '00000000-0000-0000-0000-000000000000',
    )
    expect(result.ok).toBe(false)
  })

  it('loadPendingReviewPhotos surfaces ONLY pending photos for the queue', async () => {
    await seedPhoto('pending')
    await seedPhoto('pending')
    await seedPhoto('approved')
    await seedPhoto('rejected')

    const queue = await loadPendingReviewPhotos(db)
    expect(queue).toHaveLength(2)
    expect(queue.every((p) => p.status === 'pending')).toBe(true)
    // Enriched with the parent review/experience context for the admin table.
    expect(queue[0]).toHaveProperty('reviewId', reviewId)
    expect(queue[0]).toHaveProperty('experienceTitle')
  })
})
