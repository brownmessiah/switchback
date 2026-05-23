import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { loadBookingConfirmation } from './confirmation-loader'

describe('Booking confirmation loader (Task 21)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let bookingId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_cust', email: 'cust@test.com' },
      { id: 'u_vendor', email: 'vendor@test.com' },
      { id: 'u_other', email: 'other@test.com' },
    ])
    await db.insert(vendorProfiles).values({
      userId: 'u_vendor',
      businessName: 'Test Adventures',
      slug: 'test-adventures',
      pan: 'ABCDE1234F',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE audit_logs CASCADE`)
    await db.execute(sql`TRUNCATE TABLE bookings CASCADE`)
    await db.execute(sql`TRUNCATE TABLE availability_slots CASCADE`)
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)

    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_vendor',
        slug: 'test-rafting',
        title: 'Grand Rafting Trip',
        shortDescription: 'Thrilling rafting',
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

    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: exp!.id,
        startAt: futureDate,
        endAt: new Date(futureDate.getTime() + 4 * 60 * 60 * 1000),
        capacity: 10,
        capacityTaken: 2,
        status: 'open',
      })
      .returning({ id: availabilitySlots.id })

    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_cust',
        experienceId: exp!.id,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'full_upfront',
        state: 'confirmed',
        grossTotalSnapshot: '4000.00',
        pricePerParticipantSnapshot: '2000.00',
        pricingBasisSnapshot: 'experience_bracket:1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'platform_default',
        cancellationPresetSnapshot: 'flexible',
        tdsAmountSnapshot: '40.00',
        gstRateOnCommissionSnapshot: '18.00',
        vendorPanSnapshot: 'ABCDE1234F',
        vendorIsResidentSnapshot: true,
      })
      .returning({ id: bookings.id })
    bookingId = booking!.id
  })

  it('returns booking + experience details for the owner', async () => {
    const result = await loadBookingConfirmation(db, {
      bookingId,
      actorUserId: 'u_cust',
    })

    expect(result).not.toBeNull()
    expect(result!.bookingId).toBe(bookingId)
    expect(result!.experienceTitle).toBe('Grand Rafting Trip')
    expect(result!.grossTotalRupees).toBe(4000)
    expect(result!.participantCount).toBe(2)
    expect(result!.cancellationPreset).toBe('flexible')
    expect(result!.state).toBe('confirmed')
    expect(result!.vendorBusinessName).toBe('Test Adventures')
  })

  it('returns null when booking not found', async () => {
    const result = await loadBookingConfirmation(db, {
      bookingId: '00000000-0000-0000-0000-000000000000',
      actorUserId: 'u_cust',
    })
    expect(result).toBeNull()
  })

  it('returns null when the actor is not the booking owner', async () => {
    const result = await loadBookingConfirmation(db, {
      bookingId,
      actorUserId: 'u_other',
    })
    expect(result).toBeNull()
  })
})
