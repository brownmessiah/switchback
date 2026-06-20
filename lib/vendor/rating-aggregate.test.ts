import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { loadVendorRatingAggregate } from './rating-aggregate'

/**
 * Vendor rating aggregate (issue 21 / D0): the AggregateRating that backs the
 * Vendor profile's LocalBusiness/Organization JSON-LD. It must aggregate ONLY
 * status='published' reviews across the Vendor's experiences, and return null
 * when there are none (so the schema generator omits aggregateRating — no
 * fabricated rating).
 */
describe('loadVendorRatingAggregate (issue 21, D0)', () => {
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

  async function seedExperience(slug: string): Promise<string> {
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
  async function seedBooking(experienceId: string): Promise<string> {
    slotSeq += 1
    const startAt = new Date(Date.UTC(2026, 5, 15, 9, slotSeq))
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

  async function seedReview(
    experienceId: string,
    rating: number,
    status: 'published' | 'pending' | 'flagged' | 'removed' = 'published',
  ): Promise<void> {
    const bookingId = await seedBooking(experienceId)
    await db.insert(reviews).values({
      bookingId,
      customerUserId: 'u_c',
      experienceId,
      vendorUserId: 'u_v',
      rating,
      status,
    })
  }

  it('returns null when the Vendor has no published reviews', async () => {
    await seedExperience('exp-a')
    const result = await loadVendorRatingAggregate(db, 'u_v')
    expect(result).toBeNull()
  })

  it('returns null when the only reviews are non-published', async () => {
    const expId = await seedExperience('exp-a')
    await seedReview(expId, 5, 'pending')
    await seedReview(expId, 4, 'flagged')
    const result = await loadVendorRatingAggregate(db, 'u_v')
    expect(result).toBeNull()
  })

  it('aggregates published reviews across all of the Vendor experiences', async () => {
    const expA = await seedExperience('exp-a')
    const expB = await seedExperience('exp-b')
    await seedReview(expA, 5)
    await seedReview(expA, 4)
    await seedReview(expB, 3)
    const result = await loadVendorRatingAggregate(db, 'u_v')
    expect(result).not.toBeNull()
    expect(result!.ratingCount).toBe(3)
    expect(result!.ratingValue).toBe(4) // (5+4+3)/3 = 4.0
  })

  it('rounds the average rating to one decimal place', async () => {
    const expId = await seedExperience('exp-a')
    await seedReview(expId, 5)
    await seedReview(expId, 4)
    const result = await loadVendorRatingAggregate(db, 'u_v')
    expect(result!.ratingValue).toBe(4.5)
  })

  it('excludes non-published reviews from the aggregate', async () => {
    const expId = await seedExperience('exp-a')
    await seedReview(expId, 5)
    await seedReview(expId, 1, 'removed')
    const result = await loadVendorRatingAggregate(db, 'u_v')
    expect(result!.ratingCount).toBe(1)
    expect(result!.ratingValue).toBe(5)
  })
})

/**
 * Defensive-guard unit tests with a stub query builder. Postgres' `count(*)`
 * always returns a row, so the "no row at all" path (`row` is undefined) is
 * unreachable with a real DB — but the loader still guards it (`row?.count ??
 * 0`, `row?.avg == null`). A tiny stub driver lets us prove that guard holds:
 * a missing row must yield `null`, never a thrown error or a fabricated rating.
 */
describe('loadVendorRatingAggregate — defensive guards (stub driver)', () => {
  /** Build a stub matching the `db.select(...).from(...).where(...)` chain,
   *  resolving the awaited `where(...)` to the supplied rows. */
  function stubDb(rows: unknown[]) {
    const chain = {
      from: () => chain,
      where: () => Promise.resolve(rows),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { select: () => chain } as any
  }

  it('returns null when the aggregate query yields NO row (row is undefined)', async () => {
    const result = await loadVendorRatingAggregate(stubDb([]), 'u_v')
    expect(result).toBeNull()
  })

  it('returns null when the row exists but avg is null (count>0, avg null)', async () => {
    // Exercises the second arm of `count === 0 || row?.avg == null` — a present
    // row whose avg is null must still omit the aggregate (no fabricated rating).
    const result = await loadVendorRatingAggregate(
      stubDb([{ count: 3, avg: null }]),
      'u_v',
    )
    expect(result).toBeNull()
  })

  it('returns the aggregate when the stub row carries a real avg + count', async () => {
    const result = await loadVendorRatingAggregate(
      stubDb([{ count: 2, avg: '4.25' }]),
      'u_v',
    )
    expect(result).toEqual({ ratingValue: 4.3, ratingCount: 2 }) // round(4.25*10)/10
  })
})
