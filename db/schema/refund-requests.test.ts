import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { availabilitySlots } from './availability-slots'
import { bookings } from './bookings'
import { experiences } from './experiences'
import { payments } from './payments'
import { refundRequests } from './refund-requests'
import { users } from './users'
import { vendorProfiles } from './vendor-profiles'

describe('refund_requests schema (ADRs 0004, 0005)', () => {
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
        paymentMode: 'full_upfront',
        grossTotalSnapshot: '3000.00',
        pricePerParticipantSnapshot: '1500.00',
        pricingBasisSnapshot: 'experience_tier_1_2',
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
    // refund_requests must clear first because payments.refund_request_id FK
    // references it with onDelete RESTRICT.
    await db.execute(sql`TRUNCATE TABLE payments, refund_requests`)
  })

  function baseRefundRequest(): typeof refundRequests.$inferInsert {
    return {
      bookingId,
      requestedByUserId: 'u_c',
      reason: 'inside_policy_cancellation',
      destination: 'refund_balance',
      amount: '1500.00',
      cancellationPresetSnapshot: 'flexible',
      policyWindowBasisSnapshot: '50%_window',
    }
  }

  it('inserts a pending refund_request with all required snapshots', async () => {
    await db.insert(refundRequests).values(baseRefundRequest())
    const [row] = await db.select().from(refundRequests)
    expect(row?.state).toBe('pending')
    expect(row?.reason).toBe('inside_policy_cancellation')
    expect(row?.destination).toBe('refund_balance')
    expect(row?.amount).toBe('1500.00')
    expect(row?.cancellationPresetSnapshot).toBe('flexible')
    expect(row?.policyWindowBasisSnapshot).toBe('50%_window')
    expect(row?.resolvedAt).toBeNull()
  })

  it('accepts every refund_reason enum value', async () => {
    const reasons = [
      'inside_policy_cancellation',
      'outside_policy_dispute_resolved',
      'vendor_cancelled',
      'admin_override',
    ] as const
    for (const reason of reasons) {
      const [row] = await db
        .insert(refundRequests)
        .values({ ...baseRefundRequest(), reason })
        .returning({ reason: refundRequests.reason })
      expect(row?.reason).toBe(reason)
      await db.execute(sql`TRUNCATE TABLE refund_requests CASCADE`)
    }
  })

  it('accepts both refund_destination enum values', async () => {
    const destinations = ['refund_balance', 'original_payment_method'] as const
    for (const destination of destinations) {
      const [row] = await db
        .insert(refundRequests)
        .values({ ...baseRefundRequest(), destination })
        .returning({ destination: refundRequests.destination })
      expect(row?.destination).toBe(destination)
      await db.execute(sql`TRUNCATE TABLE refund_requests CASCADE`)
    }
  })

  it('accepts every refund_request_state enum value', async () => {
    const states = ['pending', 'approved', 'credited', 'failed', 'rejected'] as const
    for (const state of states) {
      const [row] = await db
        .insert(refundRequests)
        .values({ ...baseRefundRequest(), state })
        .returning({ state: refundRequests.state })
      expect(row?.state).toBe(state)
      await db.execute(sql`TRUNCATE TABLE refund_requests CASCADE`)
    }
  })

  it('rejects unknown enum values', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO refund_requests
          (booking_id, requested_by_user_id, reason, destination, amount,
           cancellation_preset_snapshot, policy_window_basis_snapshot)
        VALUES
          (${bookingId}, 'u_c', 'invalid_reason', 'refund_balance', 100,
           'flexible', '50%_window')
      `),
    ).rejects.toThrow()
  })

  it('rejects negative amount', async () => {
    await expect(
      db.insert(refundRequests).values({ ...baseRefundRequest(), amount: '-1.00' }),
    ).rejects.toThrow()
  })

  it('accepts zero amount (no-refund-window resolved as rejected with 0)', async () => {
    await db.insert(refundRequests).values({
      ...baseRefundRequest(),
      amount: '0.00',
      state: 'rejected',
      policyWindowBasisSnapshot: 'no_refund_window',
    })
    const [row] = await db.select().from(refundRequests)
    expect(row?.amount).toBe('0.00')
    expect(row?.state).toBe('rejected')
  })

  it('persists resolvedAt timestamp when set explicitly', async () => {
    const resolvedAt = new Date('2026-09-10T12:00:00Z')
    await db
      .insert(refundRequests)
      .values({ ...baseRefundRequest(), state: 'credited', resolvedAt })
    const [row] = await db.select().from(refundRequests)
    expect(row?.resolvedAt?.toISOString()).toBe(resolvedAt.toISOString())
  })

  it('restricts deletion of a booking that has refund_requests', async () => {
    await db.insert(refundRequests).values(baseRefundRequest())
    await expect(
      db.execute(sql`DELETE FROM bookings WHERE id = ${bookingId}`),
    ).rejects.toThrow()
  })

  describe('payments.refund_request_id consistency check', () => {
    it('allows refund_reverse payment with a refund_request_id', async () => {
      const [refundRequest] = await db
        .insert(refundRequests)
        .values({ ...baseRefundRequest(), state: 'approved' })
        .returning({ id: refundRequests.id })
      await db.insert(payments).values({
        bookingId,
        razorpayPaymentId: 'pay_reverse_1',
        amount: '-1500.00',
        captureTrigger: 'refund_reverse',
        refundRequestId: refundRequest!.id,
      })
      const [row] = await db.select().from(payments)
      expect(row?.refundRequestId).toBe(refundRequest!.id)
    })

    it('rejects refund_reverse payment without a refund_request_id', async () => {
      await expect(
        db.insert(payments).values({
          bookingId,
          razorpayPaymentId: 'pay_reverse_no_req',
          amount: '-1500.00',
          captureTrigger: 'refund_reverse',
        }),
      ).rejects.toThrow()
    })

    it('allows non-refund payments with NULL refund_request_id', async () => {
      await db.insert(payments).values({
        bookingId,
        razorpayPaymentId: 'pay_normal',
        amount: '1500.00',
        captureTrigger: 'booking_create',
      })
      const [row] = await db.select().from(payments)
      expect(row?.refundRequestId).toBeNull()
    })

    it('restricts deletion of a refund_request that has payments pointing at it', async () => {
      const [refundRequest] = await db
        .insert(refundRequests)
        .values({ ...baseRefundRequest(), state: 'credited' })
        .returning({ id: refundRequests.id })
      await db.insert(payments).values({
        bookingId,
        razorpayPaymentId: 'pay_reverse_restrict',
        amount: '-500.00',
        captureTrigger: 'refund_reverse',
        refundRequestId: refundRequest!.id,
      })
      await expect(
        db.execute(sql`DELETE FROM refund_requests WHERE id = ${refundRequest!.id}`),
      ).rejects.toThrow()
    })
  })
})
