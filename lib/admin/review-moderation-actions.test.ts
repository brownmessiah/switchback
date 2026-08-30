import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeFlagReview,
  executePublishReview,
  executeRemoveReview,
  loadReviewsList,
} from './review-moderation-actions'

describe('review moderation actions', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string
  let bookingId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_admin', email: 'admin@switchback.com', name: 'Admin' },
      { id: 'u_vendor', email: 'vendor@test.com', name: 'Vendor' },
      { id: 'u_customer', email: 'customer@test.com', name: 'Customer' },
    ])

    await db.insert(vendorProfiles).values({
      userId: 'u_vendor',
      businessName: 'Adventure Co',
      slug: 'adventure-co',
      pan: 'ABCDE1234F',
      commissionRate: '20.00',
      responseTimeSlaScore: '100.00',
      payoutMethod: 'upi',
      payoutDestination: { vpa: 'vendor@upi' },
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, reviews, bookings, availability_slots, experiences CASCADE`,
    )

    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_vendor',
        slug: 'rafting',
        title: 'Rafting Trip',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '2000.00',
        pricePerPerson_3_5: '1800.00',
        pricePerPerson_6_plus: '1500.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'published',
      })
      .returning({ id: experiences.id })
    experienceId = exp!.id

    const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })

    const [bk] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_customer',
        experienceId,
        slotId: slot!.id,
        participantCount: 2,
        grossTotalSnapshot: '4000.00',
        pricePerParticipantSnapshot: '2000.00',
        pricingBasisSnapshot: 'tier_1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'platform_default',
        tdsAmountSnapshot: '0.80',
        gstRateOnCommissionSnapshot: '18.00',
        vendorPanSnapshot: 'ABCDE1234F',
        vendorIsResidentSnapshot: true,
        cancellationPresetSnapshot: 'flexible',
        paymentMode: 'full_upfront',
        state: 'completed',
      })
      .returning({ id: bookings.id })
    bookingId = bk!.id
  })

  // ── Helpers ────────────────────────────────────────────────────

  async function insertReview(status: 'pending' | 'published' | 'flagged' | 'removed' = 'published') {
    const [rev] = await db
      .insert(reviews)
      .values({
        bookingId,
        customerUserId: 'u_customer',
        experienceId,
        vendorUserId: 'u_vendor',
        rating: 4,
        title: 'Great experience',
        body: 'Had a wonderful time rafting.',
        status,
      })
      .returning({ id: reviews.id })
    return rev!.id
  }

  // ── Flag ─────────────────────────────────────────────────────

  it('flags a published review', async () => {
    const reviewId = await insertReview('published')

    const result = await executeFlagReview(db, 'u_admin', reviewId)
    expect(result.ok).toBe(true)

    const [updated] = await db
      .select({ status: reviews.status })
      .from(reviews)
      .where(eq(reviews.id, reviewId))
    expect(updated!.status).toBe('flagged')
  })

  it('flags a pending review', async () => {
    const reviewId = await insertReview('pending')

    const result = await executeFlagReview(db, 'u_admin', reviewId)
    expect(result.ok).toBe(true)
  })

  it('rejects flagging an already removed review', async () => {
    const reviewId = await insertReview('removed')

    const result = await executeFlagReview(db, 'u_admin', reviewId)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Cannot flag')
  })

  it('writes audit log on flag', async () => {
    const reviewId = await insertReview('published')

    await executeFlagReview(db, 'u_admin', reviewId)

    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'admin.review.flag'))
    expect(logs).toHaveLength(1)
    expect(logs[0]!.entityType).toBe('review')
    expect(logs[0]!.entityId).toBe(reviewId)
    expect(logs[0]!.actorUserId).toBe('u_admin')
  })

  // ── Remove ───────────────────────────────────────────────────

  it('removes a published review', async () => {
    const reviewId = await insertReview('published')

    const result = await executeRemoveReview(db, 'u_admin', reviewId)
    expect(result.ok).toBe(true)

    const [updated] = await db
      .select({ status: reviews.status })
      .from(reviews)
      .where(eq(reviews.id, reviewId))
    expect(updated!.status).toBe('removed')
  })

  it('removes a flagged review', async () => {
    const reviewId = await insertReview('flagged')

    const result = await executeRemoveReview(db, 'u_admin', reviewId)
    expect(result.ok).toBe(true)
  })

  it('rejects removing an already removed review', async () => {
    const reviewId = await insertReview('removed')

    const result = await executeRemoveReview(db, 'u_admin', reviewId)
    expect(result.ok).toBe(false)
  })

  // ── Publish ──────────────────────────────────────────────────

  it('publishes a pending review', async () => {
    const reviewId = await insertReview('pending')

    const result = await executePublishReview(db, 'u_admin', reviewId)
    expect(result.ok).toBe(true)

    const [updated] = await db
      .select({ status: reviews.status })
      .from(reviews)
      .where(eq(reviews.id, reviewId))
    expect(updated!.status).toBe('published')
  })

  it('publishes a flagged review (re-approve)', async () => {
    const reviewId = await insertReview('flagged')

    const result = await executePublishReview(db, 'u_admin', reviewId)
    expect(result.ok).toBe(true)
  })

  it('rejects publishing an already published review', async () => {
    const reviewId = await insertReview('published')

    const result = await executePublishReview(db, 'u_admin', reviewId)
    expect(result.ok).toBe(false)
  })

  it('rejects publishing a removed review', async () => {
    const reviewId = await insertReview('removed')

    const result = await executePublishReview(db, 'u_admin', reviewId)
    expect(result.ok).toBe(false)
  })

  // ── List with filters ────────────────────────────────────────

  it('filters reviews by status', async () => {
    await insertReview('published')

    const published = await loadReviewsList(db, { status: 'published' })
    expect(published).toHaveLength(1)

    const pending = await loadReviewsList(db, { status: 'pending' })
    expect(pending).toHaveLength(0)
  })

  it('filters reviews by rating', async () => {
    const reviewId = await insertReview('published')

    const fourStar = await loadReviewsList(db, { rating: 4 })
    expect(fourStar).toHaveLength(1)

    const fiveStar = await loadReviewsList(db, { rating: 5 })
    expect(fiveStar).toHaveLength(0)
  })

  // ── Not found ────────────────────────────────────────────────

  it('returns error for non-existent review', async () => {
    const result = await executeFlagReview(
      db,
      'u_admin',
      '00000000-0000-0000-0000-000000000000',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('not found')
  })

  it('rejects invalid UUID', async () => {
    const result = await executeFlagReview(db, 'u_admin', 'not-a-uuid')
    expect(result.ok).toBe(false)
  })
})
