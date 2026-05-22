import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { availabilitySlots } from './availability-slots'
import { bookings } from './bookings'
import { experiences } from './experiences'
import { payments } from './payments'
import { users } from './users'
import { vendorProfiles } from './vendor-profiles'

/**
 * Task 17 — `payments_one_autocapture_per_booking` partial unique index.
 *
 * Defense-in-depth against the cron worker producing two
 * `auto_capture_t_minus_24h` rows for the same Booking even if the
 * in-process SELECT FOR UPDATE is bypassed (e.g. two distinct serverless
 * containers somehow racing). The partial unique index enforces at the
 * Postgres layer that at most one autocapture row exists per booking.
 *
 * Partial — only rows with capture_trigger='auto_capture_t_minus_24h'
 * are constrained, so the booking_create / refund_reverse / manual_admin
 * rows for the same booking are unaffected.
 */
describe('payments_one_autocapture_per_booking (Task 17)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let bookingId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_v', email: 'v@example.com' },
      { id: 'u_c', email: 'c@example.com' },
    ])
    await db.insert(vendorProfiles).values({
      userId: 'u_v',
      businessName: 'Test Adventures',
      slug: 'test-adventures',
    })
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'rafting-day',
        title: 'Rafting Day',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront', 'partial_pay'],
        pricePerPerson_1_2: '1500',
        pricePerPerson_3_5: '1300',
        pricePerPerson_6_plus: '1100',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    const [slot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: exp!.id,
        startAt: new Date('2026-09-15T08:00:00Z'),
        endAt: new Date('2026-09-15T12:00:00Z'),
        capacity: 8,
      })
      .returning({ id: availabilitySlots.id })
    const [b] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_c',
        experienceId: exp!.id,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'partial_pay',
        grossTotalSnapshot: '4000.00',
        pricePerParticipantSnapshot: '2000.00',
        pricingBasisSnapshot: 'experience_bracket:1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: 'flexible',
      })
      .returning({ id: bookings.id })
    bookingId = b!.id
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE payments`)
  })

  it('allows a single auto_capture_t_minus_24h row per booking', async () => {
    await db.insert(payments).values({
      bookingId,
      razorpayPaymentId: 'pay_autocap_1',
      amount: '3000.00',
      captureTrigger: 'auto_capture_t_minus_24h',
    })
    const rows = await db.select().from(payments)
    expect(rows).toHaveLength(1)
  })

  it('blocks a second auto_capture_t_minus_24h row for the same booking', async () => {
    await db.insert(payments).values({
      bookingId,
      razorpayPaymentId: 'pay_autocap_first',
      amount: '3000.00',
      captureTrigger: 'auto_capture_t_minus_24h',
    })
    await expect(
      db.insert(payments).values({
        bookingId,
        razorpayPaymentId: 'pay_autocap_second',
        amount: '3000.00',
        captureTrigger: 'auto_capture_t_minus_24h',
      }),
    ).rejects.toThrow()
  })

  it('still allows a booking_create row alongside an auto_capture row (partial index excludes other triggers)', async () => {
    await db.insert(payments).values({
      bookingId,
      razorpayPaymentId: 'pay_advance',
      amount: '1000.00',
      captureTrigger: 'booking_create',
    })
    await db.insert(payments).values({
      bookingId,
      razorpayPaymentId: 'pay_autocap',
      amount: '3000.00',
      captureTrigger: 'auto_capture_t_minus_24h',
    })
    const rows = await db.select().from(payments)
    expect(rows).toHaveLength(2)
  })
})
