import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { bookings } from '@/db/schema/bookings'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { experiences } from '@/db/schema/experiences'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeSubmitVendorResponse,
  computeAverageRating,
} from './actions'

describe('executeSubmitVendorResponse', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let reviewId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    // Seed users
    await db.insert(users).values([
      { id: 'u_vendor_reviews', email: 'vendor-reviews@test.com', name: 'Test Vendor' },
      { id: 'u_customer_reviews', email: 'customer-reviews@test.com', name: 'Test Customer' },
      { id: 'u_other_vendor', email: 'other-vendor@test.com', name: 'Other Vendor' },
    ])

    // Seed vendor profiles
    await db.insert(vendorProfiles).values([
      {
        userId: 'u_vendor_reviews',
        businessName: 'Reviews Test Vendor',
        slug: 'reviews-test-vendor',
      },
      {
        userId: 'u_other_vendor',
        businessName: 'Other Test Vendor',
        slug: 'other-test-vendor',
      },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    // Clean up reviews, bookings, slots, experiences in proper order
    await db.execute(sql`TRUNCATE TABLE reviews CASCADE`)
    await db.execute(sql`TRUNCATE TABLE bookings CASCADE`)
    await db.execute(sql`TRUNCATE TABLE availability_slots CASCADE`)
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)

    // Create an experience
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_vendor_reviews',
        slug: 'review-test-exp',
        title: 'Review Test Experience',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500',
        pricePerPerson_3_5: '1300',
        pricePerPerson_6_plus: '1100',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'published',
      })
      .returning({ id: experiences.id })

    // Create an availability slot
    const [slot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: exp.id,
        startAt: new Date('2026-06-01T09:00:00Z'),
        endAt: new Date('2026-06-01T12:00:00Z'),
        capacity: 10,
      })
      .returning({ id: availabilitySlots.id })

    // Create a booking
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_customer_reviews',
        experienceId: exp.id,
        slotId: slot.id,
        participantCount: 2,
        state: 'completed',
        paymentMode: 'full_upfront',
        grossTotalSnapshot: '3000.00',
        pricePerParticipantSnapshot: '1500.00',
        pricingBasisSnapshot: '1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: 'flexible',
        tdsAmountSnapshot: '3.00',
      })
      .returning({ id: bookings.id })

    // Create a review
    const [review] = await db
      .insert(reviews)
      .values({
        bookingId: booking.id,
        customerUserId: 'u_customer_reviews',
        experienceId: exp.id,
        vendorUserId: 'u_vendor_reviews',
        rating: 5,
        title: 'Amazing experience',
        body: 'The rafting was incredible, great guides!',
      })
      .returning({ id: reviews.id })

    reviewId = review.id
  })

  it('sets vendor_response and vendor_responded_at', async () => {
    const result = await executeSubmitVendorResponse(
      db,
      'u_vendor_reviews',
      { reviewId, responseText: 'Thank you for the kind words!' },
    )

    expect(result.ok).toBe(true)

    const [updated] = await db
      .select({
        vendorResponse: reviews.vendorResponse,
        vendorRespondedAt: reviews.vendorRespondedAt,
      })
      .from(reviews)
      .where(eq(reviews.id, reviewId))

    expect(updated.vendorResponse).toBe('Thank you for the kind words!')
    expect(updated.vendorRespondedAt).toBeInstanceOf(Date)
  })

  it('rejects responding twice (already has response)', async () => {
    // First response
    await executeSubmitVendorResponse(
      db,
      'u_vendor_reviews',
      { reviewId, responseText: 'Thank you!' },
    )

    // Attempt second response
    const result = await executeSubmitVendorResponse(
      db,
      'u_vendor_reviews',
      { reviewId, responseText: 'Second response attempt' },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/already responded/i)
    }

    // Verify original response is preserved
    const [row] = await db
      .select({ vendorResponse: reviews.vendorResponse })
      .from(reviews)
      .where(eq(reviews.id, reviewId))

    expect(row.vendorResponse).toBe('Thank you!')
  })

  it('rejects responding to another vendor\'s review', async () => {
    const result = await executeSubmitVendorResponse(
      db,
      'u_other_vendor',
      { reviewId, responseText: 'Not my review' },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/not found|not authorized/i)
    }
  })

  it('rejects empty response text', async () => {
    const result = await executeSubmitVendorResponse(
      db,
      'u_vendor_reviews',
      { reviewId, responseText: '' },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/response.*required|empty/i)
    }
  })

  it('rejects whitespace-only response text', async () => {
    const result = await executeSubmitVendorResponse(
      db,
      'u_vendor_reviews',
      { reviewId, responseText: '   \n\t  ' },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/response.*required|empty/i)
    }
  })

  it('rejects non-existent review ID', async () => {
    const result = await executeSubmitVendorResponse(
      db,
      'u_vendor_reviews',
      {
        reviewId: '00000000-0000-0000-0000-000000000000',
        responseText: 'Hello',
      },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/not found/i)
    }
  })

  it('rejects invalid UUID format', async () => {
    const result = await executeSubmitVendorResponse(
      db,
      'u_vendor_reviews',
      { reviewId: 'not-a-uuid', responseText: 'Hello' },
    )

    expect(result.ok).toBe(false)
  })
})

describe('computeAverageRating', () => {
  it('computes average for multiple ratings', () => {
    const result = computeAverageRating([4, 5, 3])
    expect(result).toBe(4.0)
  })

  it('returns 0 for empty array', () => {
    const result = computeAverageRating([])
    expect(result).toBe(0)
  })

  it('handles single rating', () => {
    const result = computeAverageRating([3])
    expect(result).toBe(3.0)
  })

  it('rounds to one decimal', () => {
    // (4 + 4 + 5) / 3 = 4.333...
    const result = computeAverageRating([4, 4, 5])
    expect(result).toBe(4.3)
  })
})
