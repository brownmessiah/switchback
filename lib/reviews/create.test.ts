import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { executeCreateReview } from './create'

/**
 * Capture path (issue 18): a Customer creates a Review for their own
 * completed Booking, storing the capture-time group type. Mirrors the
 * existing execute-core / action-wrapper split used by the vendor-response
 * action.
 */
describe('executeCreateReview', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let slotSeq = 0

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

  async function seedExperience(): Promise<string> {
    const [row] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'create-test',
        title: 'Create Test',
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

  async function seedBooking(
    experienceId: string,
    customerUserId: string,
    state: 'completed' | 'confirmed',
  ): Promise<string> {
    slotSeq += 1
    const startAt = new Date(Date.now() + slotSeq * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId,
        experienceId,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'full_upfront',
        state,
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

  it('creates a published review with the captured group type', async () => {
    const experienceId = await seedExperience()
    const bookingId = await seedBooking(experienceId, 'u_c', 'completed')

    const result = await executeCreateReview(db, 'u_c', {
      bookingId,
      rating: 5,
      title: 'Great',
      body: 'Loved it',
      groupType: 'family',
    })

    expect(result.ok).toBe(true)
    const [row] = await db.select().from(reviews).where(eq(reviews.bookingId, bookingId))
    expect(row?.rating).toBe(5)
    expect(row?.groupType).toBe('family')
    expect(row?.status).toBe('published')
    expect(row?.experienceId).toBe(experienceId)
    expect(row?.vendorUserId).toBe('u_v')
  })

  it('allows a null group type', async () => {
    const experienceId = await seedExperience()
    const bookingId = await seedBooking(experienceId, 'u_c', 'completed')

    const result = await executeCreateReview(db, 'u_c', {
      bookingId,
      rating: 4,
    })

    expect(result.ok).toBe(true)
    const [row] = await db.select().from(reviews).where(eq(reviews.bookingId, bookingId))
    expect(row?.groupType).toBeNull()
  })

  it('rejects when the booking belongs to a different customer', async () => {
    const experienceId = await seedExperience()
    const bookingId = await seedBooking(experienceId, 'u_c', 'completed')

    const result = await executeCreateReview(db, 'u_other', {
      bookingId,
      rating: 5,
    })

    expect(result).toEqual({ ok: false, error: expect.any(String) })
    const rows = await db.select().from(reviews).where(eq(reviews.bookingId, bookingId))
    expect(rows).toHaveLength(0)
  })

  it('rejects when the booking is not completed', async () => {
    const experienceId = await seedExperience()
    const bookingId = await seedBooking(experienceId, 'u_c', 'confirmed')

    const result = await executeCreateReview(db, 'u_c', {
      bookingId,
      rating: 5,
    })

    expect(result.ok).toBe(false)
    const rows = await db.select().from(reviews).where(eq(reviews.bookingId, bookingId))
    expect(rows).toHaveLength(0)
  })

  it('rejects a second review for the same booking', async () => {
    const experienceId = await seedExperience()
    const bookingId = await seedBooking(experienceId, 'u_c', 'completed')

    await executeCreateReview(db, 'u_c', { bookingId, rating: 5 })
    const second = await executeCreateReview(db, 'u_c', { bookingId, rating: 1 })

    expect(second.ok).toBe(false)
    const rows = await db.select().from(reviews).where(eq(reviews.bookingId, bookingId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.rating).toBe(5)
  })

  it('rejects an out-of-range rating', async () => {
    const experienceId = await seedExperience()
    const bookingId = await seedBooking(experienceId, 'u_c', 'completed')

    const result = await executeCreateReview(db, 'u_c', { bookingId, rating: 7 })
    expect(result.ok).toBe(false)
  })

  it('rejects an invalid group type', async () => {
    const experienceId = await seedExperience()
    const bookingId = await seedBooking(experienceId, 'u_c', 'completed')

    const result = await executeCreateReview(db, 'u_c', {
      bookingId,
      rating: 5,
      // @ts-expect-error — exercising runtime validation of a bad value
      groupType: 'spouse',
    })
    expect(result.ok).toBe(false)
  })
})
