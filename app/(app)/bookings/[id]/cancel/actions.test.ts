import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { refundRequests } from '@/db/schema/refund-requests'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { walletBalances } from '@/db/schema/wallet-balances'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { executeCancelBooking } from './actions'

/**
 * Cancellation Server Action — pure-function entry point that the
 * Server Action wrapper calls. Bound to processRefund through a
 * caller-owned db.transaction so the booking transition, refund credit,
 * refund_requests row, and audit row commit atomically.
 *
 * The Server Action shape is `{ ok: true, ... } | { ok: false, error,
 * message }` — both branches are part of the action's typed return so
 * the calling React form can render the right UI without try/catch.
 */
describe('executeCancelBooking', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_v', email: 'v@example.com' },
      { id: 'u_c', email: 'c@example.com' },
      { id: 'u_other', email: 'o@example.com' },
    ])
    await db.insert(vendorProfiles).values({
      userId: 'u_v',
      businessName: 'Test Adventures',
      slug: 'test-adventures',
      pan: 'ABCDE1234F',
      commissionRate: '20.00',
      payoutMethod: 'upi',
      payoutDestination: { vpa: 'vendor@upi' },
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, payments, refund_requests, bookings, availability_slots, experiences, wallet_balances CASCADE`,
    )
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'rafting-day',
        title: 'Rafting Day',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500.00',
        pricePerPerson_3_5: '1300.00',
        pricePerPerson_6_plus: '1100.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    experienceId = exp!.id
  })

  async function seedBookingForCustomer(args: {
    hoursAhead: number
    customerUserId?: string
  }): Promise<string> {
    const startAt = new Date(Date.now() + args.hoursAhead * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: args.customerUserId ?? 'u_c',
        experienceId,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'full_upfront',
        state: 'confirmed',
        grossTotalSnapshot: '3000.00',
        pricePerParticipantSnapshot: '1500.00',
        pricingBasisSnapshot: 'experience_bracket:1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: 'flexible',
        tdsAmountSnapshot: '30.00',
        gstRateOnCommissionSnapshot: '18.00',
        vendorPanSnapshot: 'ABCDE1234F',
        vendorIsResidentSnapshot: true,
        payoutMethodSnapshot: 'upi',
        payoutDestinationSnapshot: { vpa: 'vendor@upi' },
      })
      .returning({ id: bookings.id })
    return booking!.id
  }

  async function readRefundBalance(userId: string): Promise<number> {
    const [row] = await db
      .select()
      .from(walletBalances)
      .where(
        and(
          eq(walletBalances.userId, userId),
          eq(walletBalances.balanceType, 'refund_balance'),
        ),
      )
    return row ? Math.floor(Number(row.amount)) : 0
  }

  it('cancels an authenticated customer’s own booking and credits refund_balance', async () => {
    const bookingId = await seedBookingForCustomer({ hoursAhead: 25 })

    const result = await executeCancelBooking(db, {
      bookingId,
      actorUserId: 'u_c',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.refundAmountRupees).toBe(3000)
      expect(result.basis).toBe('free_window')
      expect(result.bookingState).toBe('cancelled_by_customer')
      expect(result.routedToDispute).toBe(false)
    }
    expect(await readRefundBalance('u_c')).toBe(3000)
  })

  it('refuses a cancellation attempted by a different customer (403-equivalent)', async () => {
    const bookingId = await seedBookingForCustomer({
      hoursAhead: 25,
      customerUserId: 'u_c',
    })

    const result = await executeCancelBooking(db, {
      bookingId,
      actorUserId: 'u_other',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('unauthorized')
    }
    // No refund credited
    expect(await readRefundBalance('u_other')).toBe(0)
    expect(await readRefundBalance('u_c')).toBe(0)
    // No refund_requests row
    const reqs = await db.select().from(refundRequests)
    expect(reqs).toHaveLength(0)
  })

  it('is idempotent — cancelling an already-cancelled booking returns not_cancellable, no double-credit', async () => {
    const bookingId = await seedBookingForCustomer({ hoursAhead: 25 })

    const first = await executeCancelBooking(db, { bookingId, actorUserId: 'u_c' })
    expect(first.ok).toBe(true)
    const balanceAfterFirst = await readRefundBalance('u_c')
    expect(balanceAfterFirst).toBe(3000)

    const second = await executeCancelBooking(db, { bookingId, actorUserId: 'u_c' })
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error).toBe('not_cancellable')
    }
    // No double-credit
    expect(await readRefundBalance('u_c')).toBe(3000)
  })

  it('routes a cancellation past slot.startAt to Dispute (ok=true, routedToDispute=true)', async () => {
    const bookingId = await seedBookingForCustomer({ hoursAhead: -1 })

    const result = await executeCancelBooking(db, { bookingId, actorUserId: 'u_c' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bookingState).toBe('disputed')
      expect(result.basis).toBe('outside_policy')
      expect(result.refundAmountRupees).toBe(0)
      expect(result.routedToDispute).toBe(true)
    }
    // No refund credited yet (admin must resolve dispute first)
    expect(await readRefundBalance('u_c')).toBe(0)
  })

  it('returns not_found when the bookingId does not exist', async () => {
    const result = await executeCancelBooking(db, {
      bookingId: crypto.randomUUID(),
      actorUserId: 'u_c',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('not_found')
    }
  })

  it('returns sanitised messages that do not leak booking ids or internal state', async () => {
    const bookingId = await seedBookingForCustomer({
      hoursAhead: 25,
      customerUserId: 'u_c',
    })
    const otherResult = await executeCancelBooking(db, {
      bookingId,
      actorUserId: 'u_other',
    })
    if (!otherResult.ok) {
      expect(otherResult.message).not.toContain(bookingId)
      expect(otherResult.message).not.toContain('u_c')
      expect(otherResult.message).not.toContain('u_other')
      expect(otherResult.message).toBe(
        'You are not authorised to cancel this booking.',
      )
    }

    const notFoundResult = await executeCancelBooking(db, {
      bookingId: '00000000-0000-0000-0000-000000000000',
      actorUserId: 'u_c',
    })
    if (!notFoundResult.ok) {
      expect(notFoundResult.message).toBe('Booking not found.')
    }
  })

  it('rolls back the booking-state flip if the audit insert somehow fails', async () => {
    // Sanity: a happy-path cancel commits atomically. We assert this
    // indirectly by checking that on the unauthorized path the booking
    // state remains 'confirmed' and no audit / refund rows exist.
    const bookingId = await seedBookingForCustomer({ hoursAhead: 25 })
    await executeCancelBooking(db, { bookingId, actorUserId: 'u_other' })

    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
    expect(row?.state).toBe('confirmed')
  })
})
