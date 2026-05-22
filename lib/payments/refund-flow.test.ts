import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { refundRequests } from '@/db/schema/refund-requests'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { walletBalances } from '@/db/schema/wallet-balances'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { processRefund, RefundFlowError } from './refund-flow'

/**
 * Refund flow per ADRs 0003 / 0004 / 0005. Orchestrates the inside-policy
 * auto-credit path, the no-refund-window path, the outside-policy
 * route-to-Dispute path, and the vendor-cancelled 100%-refund override.
 *
 * Composes the pure quoteRefund (Task 4) over the Booking's snapshotted
 * cancellation preset, then in a single db.transaction(...):
 *   - inserts a refund_requests row (or, for outside-policy, skips it
 *     and audits dispute.opened),
 *   - credits the Customer's refund_balance via wallet.creditRefundBalance,
 *   - transitions Booking.state per ADR-0003,
 *   - writes the commission-reversal audit so the M3 Payout module can
 *     resolve the cancellation-fee net of commission.
 *
 * Snapshot rule (ADR-0008): the booking row's cancellationPresetSnapshot
 * is the source of truth, not experiences.cancellationPreset (which may
 * have changed after the Booking was created).
 */
describe('processRefund (ADRs 0003/0004/0005)', () => {
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

  /**
   * Seed a confirmed booking on a Flexible-preset Experience whose slot
   * starts `hoursAhead` from now. Returns the booking id; gross is 3000
   * (2 participants × 1500). Override the snapshotted preset by passing
   * `preset` so we can exercise Moderate / Strict paths.
   */
  async function seedConfirmedBooking(args: {
    hoursAhead: number
    preset?: 'flexible' | 'moderate' | 'strict'
    grossRupees?: number
  }): Promise<{ bookingId: string; slotId: string }> {
    const startAt = new Date(Date.now() + args.hoursAhead * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })
    const gross = args.grossRupees ?? 3000
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_c',
        experienceId,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'full_upfront',
        state: 'confirmed',
        grossTotalSnapshot: gross.toFixed(2),
        pricePerParticipantSnapshot: (gross / 2).toFixed(2),
        pricingBasisSnapshot: 'experience_bracket:1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: args.preset ?? 'flexible',
        tdsAmountSnapshot: (gross * 0.01).toFixed(2),
        gstRateOnCommissionSnapshot: '18.00',
        vendorPanSnapshot: 'ABCDE1234F',
        vendorIsResidentSnapshot: true,
        payoutMethodSnapshot: 'upi',
        payoutDestinationSnapshot: { vpa: 'vendor@upi' },
      })
      .returning({ id: bookings.id })
    return { bookingId: booking!.id, slotId: slot!.id }
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

  describe('inside-policy — free window', () => {
    it('refunds 100% on a Flexible-preset Booking cancelled at T-25h (free window)', async () => {
      const { bookingId } = await seedConfirmedBooking({ hoursAhead: 25 })

      const result = await processRefund(db, {
        bookingId,
        actorUserId: 'u_c',
      })

      expect(result.refundAmountRupees).toBe(3000)
      expect(result.cancellationFeeRupees).toBe(0)
      expect(result.basis).toBe('free_window')
      expect(result.bookingState).toBe('cancelled_by_customer')
      expect(result.routedToDispute).toBe(false)
    })

    it('creates a credited refund_requests row and increments refund_balance', async () => {
      const { bookingId } = await seedConfirmedBooking({ hoursAhead: 25 })
      const result = await processRefund(db, { bookingId, actorUserId: 'u_c' })

      const [reqRow] = await db
        .select()
        .from(refundRequests)
        .where(eq(refundRequests.id, result.refundRequestId!))
      expect(reqRow?.state).toBe('credited')
      expect(reqRow?.destination).toBe('refund_balance')
      expect(reqRow?.reason).toBe('inside_policy_cancellation')
      expect(reqRow?.amount).toBe('3000.00')
      expect(reqRow?.cancellationPresetSnapshot).toBe('flexible')
      expect(reqRow?.policyWindowBasisSnapshot).toBe('free_window')
      expect(reqRow?.requestedByUserId).toBe('u_c')

      expect(await readRefundBalance('u_c')).toBe(3000)
    })

    it('transitions booking to cancelled_by_customer', async () => {
      const { bookingId } = await seedConfirmedBooking({ hoursAhead: 25 })
      await processRefund(db, { bookingId, actorUserId: 'u_c' })
      const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId))
      expect(row?.state).toBe('cancelled_by_customer')
    })

    it('writes a booking.cancel audit row including the policy quote + cancellation-fee commission adjustment', async () => {
      const { bookingId } = await seedConfirmedBooking({ hoursAhead: 25 })
      await processRefund(db, { bookingId, actorUserId: 'u_c' })
      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.cancel'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      expect(rows).toHaveLength(1)
      const payload = rows[0]?.payload as Record<string, unknown>
      expect(payload.basis).toBe('free_window')
      expect(payload.refundAmountRupees).toBe(3000)
      expect(payload.cancellationFeeRupees).toBe(0)
      expect(payload.commissionRateSnapshot).toBe('20.00')
      // Original would-be commission at Completion: 20% * 3000 = 600.
      // Adjusted commission (on cancellation fee 0): 0.
      // Reversal delta: 600 (the platform forgoes the full commission).
      expect(payload.adjustedCommissionOnFeeRupees).toBe(0)
    })
  })

  describe('inside-policy — 50% window', () => {
    it('refunds floor(gross/2) on a Flexible-preset Booking cancelled at T-3h', async () => {
      const { bookingId } = await seedConfirmedBooking({ hoursAhead: 3 })

      const result = await processRefund(db, { bookingId, actorUserId: 'u_c' })
      expect(result.basis).toBe('50%_window')
      expect(result.refundAmountRupees).toBe(1500)
      expect(result.cancellationFeeRupees).toBe(1500)
      expect(result.bookingState).toBe('cancelled_by_customer')
    })

    it('uses the snapshotted preset, not the live experience preset (snapshot rule)', async () => {
      const { bookingId } = await seedConfirmedBooking({
        hoursAhead: 25,
        preset: 'strict',
      })
      // Live experience preset changes — must not affect the result.
      await db
        .update(experiences)
        .set({ cancellationPreset: 'flexible' })
        .where(eq(experiences.id, experienceId))

      const result = await processRefund(db, { bookingId, actorUserId: 'u_c' })
      // Strict free window is T-14d; at T-25h that is the no-refund window.
      expect(result.basis).toBe('no_refund_window')
      expect(result.refundAmountRupees).toBe(0)
    })

    it('credits floor(gross/2) to refund_balance and records the adjusted commission', async () => {
      const { bookingId } = await seedConfirmedBooking({ hoursAhead: 3 })
      await processRefund(db, { bookingId, actorUserId: 'u_c' })
      expect(await readRefundBalance('u_c')).toBe(1500)
      const [auditRow] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.cancel'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      const payload = auditRow?.payload as Record<string, unknown>
      // Vendor keeps cancellation fee 1500; commission on that = 20% * 1500 = 300.
      expect(payload.adjustedCommissionOnFeeRupees).toBe(300)
    })
  })

  describe('inside-policy — no-refund window', () => {
    it('refunds 0 on a Flexible-preset Booking cancelled at T-1h, but still writes a rejected refund_requests row', async () => {
      const { bookingId } = await seedConfirmedBooking({ hoursAhead: 1 })

      const result = await processRefund(db, { bookingId, actorUserId: 'u_c' })
      expect(result.basis).toBe('no_refund_window')
      expect(result.refundAmountRupees).toBe(0)
      expect(result.cancellationFeeRupees).toBe(3000)
      expect(result.bookingState).toBe('cancelled_by_customer')

      const [reqRow] = await db
        .select()
        .from(refundRequests)
        .where(eq(refundRequests.id, result.refundRequestId!))
      expect(reqRow?.state).toBe('rejected')
      expect(reqRow?.amount).toBe('0.00')
      expect(reqRow?.policyWindowBasisSnapshot).toBe('no_refund_window')

      expect(await readRefundBalance('u_c')).toBe(0)
    })
  })

  describe('outside-policy', () => {
    it('routes to Dispute on cancellation after slot.startAt — booking.state=disputed, no refund_requests row, audit dispute.opened', async () => {
      const { bookingId } = await seedConfirmedBooking({ hoursAhead: -1 })

      const result = await processRefund(db, { bookingId, actorUserId: 'u_c' })
      expect(result.basis).toBe('outside_policy')
      expect(result.refundAmountRupees).toBe(0)
      expect(result.bookingState).toBe('disputed')
      expect(result.routedToDispute).toBe(true)
      expect(result.refundRequestId).toBeNull()

      const reqs = await db.select().from(refundRequests)
      expect(reqs).toHaveLength(0)

      const disputeAudit = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'dispute.opened'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      expect(disputeAudit).toHaveLength(1)
      const payload = disputeAudit[0]?.payload as Record<string, unknown>
      expect(payload.basis).toBe('outside_policy')

      const [bookingRow] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(bookingRow?.state).toBe('disputed')

      expect(await readRefundBalance('u_c')).toBe(0)
    })
  })

  describe('vendor-cancelled override', () => {
    it('refunds 100% regardless of the snapshotted preset, even inside the no-refund window', async () => {
      const { bookingId } = await seedConfirmedBooking({
        hoursAhead: 1,
        preset: 'flexible',
      })

      const result = await processRefund(db, {
        bookingId,
        actorUserId: 'u_v',
        vendorCancelled: true,
      })
      expect(result.basis).toBe('vendor_cancelled')
      expect(result.refundAmountRupees).toBe(3000)
      expect(result.cancellationFeeRupees).toBe(0)
      expect(result.bookingState).toBe('cancelled_by_vendor')

      const [reqRow] = await db
        .select()
        .from(refundRequests)
        .where(eq(refundRequests.id, result.refundRequestId!))
      expect(reqRow?.reason).toBe('vendor_cancelled')
      expect(reqRow?.state).toBe('credited')
      expect(reqRow?.amount).toBe('3000.00')

      expect(await readRefundBalance('u_c')).toBe(3000)
    })

    it('transitions booking to cancelled_by_vendor and audits with the vendor as actor', async () => {
      const { bookingId } = await seedConfirmedBooking({ hoursAhead: 25 })
      await processRefund(db, {
        bookingId,
        actorUserId: 'u_v',
        vendorCancelled: true,
      })
      const [bookingRow] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(bookingRow?.state).toBe('cancelled_by_vendor')

      const [auditRow] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'booking.cancel'),
            eq(auditLogs.entityId, bookingId),
          ),
        )
      expect(auditRow?.actorUserId).toBe('u_v')
      const payload = auditRow?.payload as Record<string, unknown>
      expect(payload.vendorCancelled).toBe(true)
    })
  })

  describe('ownership guard (defense-in-depth)', () => {
    it('rejects a customer cancellation initiated by another customer', async () => {
      await db.insert(users).values({ id: 'u_other', email: 'o@example.com' })
      const { bookingId } = await seedConfirmedBooking({ hoursAhead: 25 })
      await expect(
        processRefund(db, { bookingId, actorUserId: 'u_other' }),
      ).rejects.toThrow(/not the customer/i)
      const [bookingRow] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(bookingRow?.state).toBe('confirmed')
      const reqs = await db.select().from(refundRequests)
      expect(reqs).toHaveLength(0)
    })

    it('rejects vendorCancelled=true when the actor is not the experience’s vendor', async () => {
      const { bookingId } = await seedConfirmedBooking({ hoursAhead: 1 })
      // u_c is the customer, not the vendor — must not be able to claim a
      // vendor-cancelled 100% refund.
      await expect(
        processRefund(db, {
          bookingId,
          actorUserId: 'u_c',
          vendorCancelled: true,
        }),
      ).rejects.toThrow(/not the vendor/i)
      const [bookingRow] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(bookingRow?.state).toBe('confirmed')
    })
  })

  describe('outside-policy provisional commission audit', () => {
    it('marks the dispute.opened audit commission figure as pendingAdminResolution', async () => {
      const { bookingId } = await seedConfirmedBooking({ hoursAhead: -1 })
      await processRefund(db, { bookingId, actorUserId: 'u_c' })
      const [auditRow] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'dispute.opened'))
      const payload = auditRow?.payload as Record<string, unknown>
      expect(payload.pendingAdminResolution).toBe(true)
      // Full gross would-be-fee: 3000 × 20% = 600. Marked provisional only.
      expect(payload.provisionalCommissionOnFeeRupees).toBe(600)
      expect(payload.adjustedCommissionOnFeeRupees).toBeUndefined()
    })
  })

  describe('idempotency / state guards', () => {
    it('refuses a second cancellation on a Booking already in a cancelled_* state', async () => {
      const { bookingId } = await seedConfirmedBooking({ hoursAhead: 25 })
      await processRefund(db, { bookingId, actorUserId: 'u_c' })

      await expect(
        processRefund(db, { bookingId, actorUserId: 'u_c' }),
      ).rejects.toThrow(RefundFlowError)
    })

    it('refuses cancellation on a Booking already disputed', async () => {
      const { bookingId } = await seedConfirmedBooking({ hoursAhead: -1 })
      await processRefund(db, { bookingId, actorUserId: 'u_c' })
      await expect(
        processRefund(db, { bookingId, actorUserId: 'u_c' }),
      ).rejects.toThrow(RefundFlowError)
    })

    it('refuses cancellation on a non-existent booking', async () => {
      await expect(
        processRefund(db, { bookingId: crypto.randomUUID(), actorUserId: 'u_c' }),
      ).rejects.toThrow(RefundFlowError)
    })

    it('refuses cancellation on a completed Booking', async () => {
      const { bookingId } = await seedConfirmedBooking({ hoursAhead: 25 })
      await db
        .update(bookings)
        .set({ state: 'completed' })
        .where(eq(bookings.id, bookingId))
      await expect(
        processRefund(db, { bookingId, actorUserId: 'u_c' }),
      ).rejects.toThrow(RefundFlowError)
    })
  })
})
