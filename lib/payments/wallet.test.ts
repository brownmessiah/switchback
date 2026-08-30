import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { payments } from '@/db/schema/payments'
import { refundRequests } from '@/db/schema/refund-requests'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { walletBalances } from '@/db/schema/wallet-balances'
import {
  _resetRazorpayClientForTests,
  _setRazorpayClientForTests,
  type RazorpaySdkLike,
} from '@/lib/payments/razorpay-client'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  applyWalletToCheckout,
  creditOutversBalance,
  creditRefundBalance,
  requestCashout,
} from './wallet'

/**
 * Wallet operations per ADR-0004 (two-balance wallet model). The single
 * customer-facing Wallet UI is backed by TWO balance buckets:
 *
 *   outvers_credit  — closed-loop promotional balance (referral, promo, loyalty).
 *                     Never cashable. Expires 12-18 months from issue.
 *   refund_balance  — closed-loop by default, cashable to original payment
 *                     method on Customer request (5-7d Razorpay round-trip).
 *
 * Spend order on checkout: Switchback credit → Refund balance → Razorpay
 * remainder.
 *
 * Every wallet movement writes an audit_logs row with the source bucket,
 * amount, and reason, so the operational reconciliation dashboard can
 * trace every rupee.
 */
describe('wallet operations (ADR-0004)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

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
    _resetRazorpayClientForTests()
  })

  async function seedBalance(
    userId: string,
    type: 'outvers_credit' | 'refund_balance',
    amountRupees: number,
  ): Promise<void> {
    await db
      .insert(walletBalances)
      .values({ userId, balanceType: type, amount: amountRupees.toFixed(2) })
      .onConflictDoUpdate({
        target: [walletBalances.userId, walletBalances.balanceType],
        set: { amount: amountRupees.toFixed(2) },
      })
  }

  async function readBalance(
    userId: string,
    type: 'outvers_credit' | 'refund_balance',
  ): Promise<number> {
    const [row] = await db
      .select()
      .from(walletBalances)
      .where(and(eq(walletBalances.userId, userId), eq(walletBalances.balanceType, type)))
    return row ? Math.floor(Number(row.amount)) : 0
  }

  async function seedBooking(): Promise<string> {
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'rafting-cashout',
        title: 'Rafting (cashout fixture)',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500.00',
        pricePerPerson_3_5: '1300.00',
        pricePerPerson_6_plus: '1100.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    const startAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId: exp!.id, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_c',
        experienceId: exp!.id,
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

  describe('applyWalletToCheckout — spend order (ADR-0004)', () => {
    it('returns zeros when both balances are absent', async () => {
      const r = await applyWalletToCheckout(db, { userId: 'u_c', grossRupees: 5000 })
      expect(r).toEqual({
        outversCreditAppliedRupees: 0,
        refundBalanceAppliedRupees: 0,
        razorpayRemainderRupees: 5000,
      })
    })

    it('applies Switchback credit first up to gross', async () => {
      await seedBalance('u_c', 'outvers_credit', 2000)
      const r = await applyWalletToCheckout(db, { userId: 'u_c', grossRupees: 5000 })
      expect(r.outversCreditAppliedRupees).toBe(2000)
      expect(r.refundBalanceAppliedRupees).toBe(0)
      expect(r.razorpayRemainderRupees).toBe(3000)
      // outvers_credit row decremented to 0
      expect(await readBalance('u_c', 'outvers_credit')).toBe(0)
    })

    it('falls through to Refund balance after exhausting Switchback credit', async () => {
      await seedBalance('u_c', 'outvers_credit', 1000)
      await seedBalance('u_c', 'refund_balance', 1500)
      const r = await applyWalletToCheckout(db, { userId: 'u_c', grossRupees: 5000 })
      expect(r.outversCreditAppliedRupees).toBe(1000)
      expect(r.refundBalanceAppliedRupees).toBe(1500)
      expect(r.razorpayRemainderRupees).toBe(2500)
      expect(await readBalance('u_c', 'outvers_credit')).toBe(0)
      expect(await readBalance('u_c', 'refund_balance')).toBe(0)
    })

    it('returns razorpayRemainder=0 when wallet covers the gross', async () => {
      await seedBalance('u_c', 'outvers_credit', 3000)
      await seedBalance('u_c', 'refund_balance', 5000)
      const r = await applyWalletToCheckout(db, { userId: 'u_c', grossRupees: 4000 })
      expect(r.outversCreditAppliedRupees).toBe(3000)
      expect(r.refundBalanceAppliedRupees).toBe(1000)
      expect(r.razorpayRemainderRupees).toBe(0)
      expect(await readBalance('u_c', 'outvers_credit')).toBe(0)
      expect(await readBalance('u_c', 'refund_balance')).toBe(4000)
    })

    it('applies all three sources in ADR-0004 order: Switchback credit, then Refund balance, then Razorpay (500 + 300 + 1000 → 500/300/200)', async () => {
      // The canonical three-bucket split: Switchback credit (expires) drains
      // first, then Refund balance (cashable), then Razorpay charges the
      // remainder. Both buckets nonzero AND a nonzero Razorpay remainder.
      await seedBalance('u_c', 'outvers_credit', 500)
      await seedBalance('u_c', 'refund_balance', 300)
      const r = await applyWalletToCheckout(db, { userId: 'u_c', grossRupees: 1000 })
      expect(r.outversCreditAppliedRupees).toBe(500)
      expect(r.refundBalanceAppliedRupees).toBe(300)
      expect(r.razorpayRemainderRupees).toBe(200)
      // Both buckets fully drained; Razorpay covers the 200 remainder.
      expect(await readBalance('u_c', 'outvers_credit')).toBe(0)
      expect(await readBalance('u_c', 'refund_balance')).toBe(0)
      // And the split reconstitutes the gross.
      expect(
        r.outversCreditAppliedRupees +
          r.refundBalanceAppliedRupees +
          r.razorpayRemainderRupees,
      ).toBe(1000)
    })

    it('does not touch Refund balance when Switchback credit alone covers gross', async () => {
      await seedBalance('u_c', 'outvers_credit', 10000)
      await seedBalance('u_c', 'refund_balance', 5000)
      const r = await applyWalletToCheckout(db, { userId: 'u_c', grossRupees: 3000 })
      expect(r.outversCreditAppliedRupees).toBe(3000)
      expect(r.refundBalanceAppliedRupees).toBe(0)
      expect(r.razorpayRemainderRupees).toBe(0)
      expect(await readBalance('u_c', 'outvers_credit')).toBe(7000)
      expect(await readBalance('u_c', 'refund_balance')).toBe(5000)
    })

    it('rejects non-integer grossRupees', async () => {
      await expect(
        applyWalletToCheckout(db, { userId: 'u_c', grossRupees: 100.5 }),
      ).rejects.toThrow(/integer/i)
    })

    it('rejects negative grossRupees', async () => {
      await expect(
        applyWalletToCheckout(db, { userId: 'u_c', grossRupees: -1 }),
      ).rejects.toThrow(/non-negative/i)
    })

    it('writes a wallet.apply audit row including the booking link', async () => {
      await seedBalance('u_c', 'outvers_credit', 500)
      await seedBalance('u_c', 'refund_balance', 500)
      const bookingId = crypto.randomUUID()
      await applyWalletToCheckout(db, { userId: 'u_c', grossRupees: 5000, bookingId })
      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'wallet.apply_to_checkout'))
      expect(rows).toHaveLength(1)
      const payload = rows[0]?.payload as Record<string, unknown>
      expect(payload.userId).toBe('u_c')
      expect(payload.grossRupees).toBe(5000)
      expect(payload.outversCreditAppliedRupees).toBe(500)
      expect(payload.refundBalanceAppliedRupees).toBe(500)
      expect(payload.razorpayRemainderRupees).toBe(4000)
      expect(payload.bookingId).toBe(bookingId)
    })
  })

  describe('creditRefundBalance', () => {
    it('credits a new bucket when none exists', async () => {
      const bookingId = await seedBooking()
      const [refundReq] = await db
        .insert(refundRequests)
        .values({
          bookingId,
          requestedByUserId: 'u_c',
          reason: 'inside_policy_cancellation',
          destination: 'refund_balance',
          state: 'credited',
          amount: '1500.00',
          cancellationPresetSnapshot: 'flexible',
          policyWindowBasisSnapshot: '50%_window',
        })
        .returning({ id: refundRequests.id })

      await creditRefundBalance(db, {
        userId: 'u_c',
        amountRupees: 1500,
        refundRequestId: refundReq!.id,
        bookingId,
      })
      expect(await readBalance('u_c', 'refund_balance')).toBe(1500)
    })

    it('adds onto an existing refund_balance', async () => {
      await seedBalance('u_c', 'refund_balance', 300)
      const bookingId = await seedBooking()
      const [refundReq] = await db
        .insert(refundRequests)
        .values({
          bookingId,
          requestedByUserId: 'u_c',
          reason: 'inside_policy_cancellation',
          destination: 'refund_balance',
          state: 'credited',
          amount: '700.00',
          cancellationPresetSnapshot: 'flexible',
          policyWindowBasisSnapshot: '50%_window',
        })
        .returning({ id: refundRequests.id })

      await creditRefundBalance(db, {
        userId: 'u_c',
        amountRupees: 700,
        refundRequestId: refundReq!.id,
        bookingId,
      })
      expect(await readBalance('u_c', 'refund_balance')).toBe(1000)
    })

    it('writes a wallet.credit_refund_balance audit row with the refund_request link', async () => {
      const bookingId = await seedBooking()
      const [refundReq] = await db
        .insert(refundRequests)
        .values({
          bookingId,
          requestedByUserId: 'u_c',
          reason: 'inside_policy_cancellation',
          destination: 'refund_balance',
          state: 'credited',
          amount: '1500.00',
          cancellationPresetSnapshot: 'flexible',
          policyWindowBasisSnapshot: '50%_window',
        })
        .returning({ id: refundRequests.id })
      await creditRefundBalance(db, {
        userId: 'u_c',
        amountRupees: 1500,
        refundRequestId: refundReq!.id,
        bookingId,
      })
      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'wallet.credit_refund_balance'))
      expect(rows).toHaveLength(1)
      const payload = rows[0]?.payload as Record<string, unknown>
      expect(payload.userId).toBe('u_c')
      expect(payload.amountRupees).toBe(1500)
      expect(payload.refundRequestId).toBe(refundReq!.id)
      expect(payload.bookingId).toBe(bookingId)
    })

    it('rejects non-positive amountRupees', async () => {
      const bookingId = await seedBooking()
      await expect(
        creditRefundBalance(db, {
          userId: 'u_c',
          amountRupees: 0,
          refundRequestId: crypto.randomUUID(),
          bookingId,
        }),
      ).rejects.toThrow(/positive/i)
      await expect(
        creditRefundBalance(db, {
          userId: 'u_c',
          amountRupees: -1,
          refundRequestId: crypto.randomUUID(),
          bookingId,
        }),
      ).rejects.toThrow(/positive/i)
    })

    it('rejects non-integer amountRupees', async () => {
      const bookingId = await seedBooking()
      await expect(
        creditRefundBalance(db, {
          userId: 'u_c',
          amountRupees: 100.5,
          refundRequestId: crypto.randomUUID(),
          bookingId,
        }),
      ).rejects.toThrow(/integer/i)
    })
  })

  describe('creditOutversBalance', () => {
    it('credits a new Switchback credit bucket and writes audit with source=referral', async () => {
      await creditOutversBalance(db, {
        userId: 'u_c',
        amountRupees: 500,
        source: 'referral',
      })
      expect(await readBalance('u_c', 'outvers_credit')).toBe(500)
      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'wallet.credit_outvers_credit'))
      expect(rows).toHaveLength(1)
      const payload = rows[0]?.payload as Record<string, unknown>
      expect(payload.source).toBe('referral')
      expect(payload.amountRupees).toBe(500)
    })

    it('accepts source=promo and source=loyalty', async () => {
      await creditOutversBalance(db, { userId: 'u_c', amountRupees: 100, source: 'promo' })
      await creditOutversBalance(db, { userId: 'u_c', amountRupees: 200, source: 'loyalty' })
      expect(await readBalance('u_c', 'outvers_credit')).toBe(300)
    })

    it('rejects an unknown source', async () => {
      await expect(
        creditOutversBalance(db, {
          userId: 'u_c',
          amountRupees: 100,
          source: 'cashback' as never,
        }),
      ).rejects.toThrow()
    })

    it('rejects non-positive amount', async () => {
      await expect(
        creditOutversBalance(db, { userId: 'u_c', amountRupees: 0, source: 'referral' }),
      ).rejects.toThrow(/positive/i)
      await expect(
        creditOutversBalance(db, { userId: 'u_c', amountRupees: -10, source: 'referral' }),
      ).rejects.toThrow(/positive/i)
    })

    it('persists the optional reason in the audit payload', async () => {
      await creditOutversBalance(db, {
        userId: 'u_c',
        amountRupees: 250,
        source: 'referral',
        reason: 'invitee_first_booking',
      })
      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'wallet.credit_outvers_credit'))
      expect((rows[0]?.payload as Record<string, unknown>).reason).toBe(
        'invitee_first_booking',
      )
    })
  })

  describe('requestCashout', () => {
    function makeStubRazorpay(): {
      client: RazorpaySdkLike
      refundCalls: Array<{ paymentId: string; params: { amount: number } }>
    } {
      const refundCalls: Array<{ paymentId: string; params: { amount: number } }> = []
      const client: RazorpaySdkLike = {
        orders: {
          create: vi.fn(),
        },
        payments: {
          capture: vi.fn(),
          refund: vi.fn(async (paymentId, params) => {
            refundCalls.push({ paymentId, params })
            return {
              id: `rfnd_${refundCalls.length}`,
              amount: params.amount,
              payment_id: paymentId,
              status: 'pending' as const,
            }
          }),
        },
      }
      return { client, refundCalls }
    }

    it('debits refund_balance, creates a refund_requests row, calls Razorpay, and audits', async () => {
      const bookingId = await seedBooking()
      await db.insert(payments).values({
        bookingId,
        razorpayPaymentId: 'pay_abc123',
        amount: '3000.00',
        captureTrigger: 'booking_create',
      })
      await seedBalance('u_c', 'refund_balance', 1500)
      const { client, refundCalls } = makeStubRazorpay()
      _setRazorpayClientForTests(client)

      const result = await requestCashout(db, {
        userId: 'u_c',
        amountRupees: 1000,
        originalPaymentId: 'pay_abc123',
      })

      expect(result.razorpayRefundId).toBe('rfnd_1')
      expect(result.refundRequestId).toMatch(/^[0-9a-f-]{36}$/)
      // Refund balance debited
      expect(await readBalance('u_c', 'refund_balance')).toBe(500)
      // Razorpay called in paise
      expect(refundCalls).toHaveLength(1)
      expect(refundCalls[0]!.paymentId).toBe('pay_abc123')
      expect(refundCalls[0]!.params.amount).toBe(100_000)
      // refund_requests row created
      const [reqRow] = await db
        .select()
        .from(refundRequests)
        .where(eq(refundRequests.id, result.refundRequestId))
      expect(reqRow?.destination).toBe('original_payment_method')
      expect(reqRow?.state).toBe('pending')
      expect(reqRow?.amount).toBe('1000.00')
      expect(reqRow?.bookingId).toBe(bookingId)
      expect(reqRow?.requestedByUserId).toBe('u_c')
      // Audit row — written BEFORE the Razorpay call so a webhook-side
      // refund.processed audit is the linkage point for razorpayRefundId.
      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'wallet.request_cashout'))
      expect(rows).toHaveLength(1)
      const payload = rows[0]?.payload as Record<string, unknown>
      expect(payload.amountRupees).toBe(1000)
      expect(payload.bookingId).toBe(bookingId)
      expect(payload.refundRequestId).toBe(result.refundRequestId)
      expect(payload.razorpayRefundId).toBeUndefined()
    })

    it('rejects when refund_balance is insufficient', async () => {
      const bookingId = await seedBooking()
      await db.insert(payments).values({
        bookingId,
        razorpayPaymentId: 'pay_abc123',
        amount: '3000.00',
        captureTrigger: 'booking_create',
      })
      await seedBalance('u_c', 'refund_balance', 500)
      const { client } = makeStubRazorpay()
      _setRazorpayClientForTests(client)

      await expect(
        requestCashout(db, {
          userId: 'u_c',
          amountRupees: 1000,
          originalPaymentId: 'pay_abc123',
        }),
      ).rejects.toThrow(/insufficient/i)
      // Refund balance unchanged
      expect(await readBalance('u_c', 'refund_balance')).toBe(500)
      // No refund_requests rows
      const reqs = await db.select().from(refundRequests)
      expect(reqs).toHaveLength(0)
    })

    it('rejects when the originalPaymentId is not on file', async () => {
      await seedBalance('u_c', 'refund_balance', 5000)
      const { client } = makeStubRazorpay()
      _setRazorpayClientForTests(client)
      await expect(
        requestCashout(db, {
          userId: 'u_c',
          amountRupees: 1000,
          originalPaymentId: 'pay_unknown',
        }),
      ).rejects.toThrow(/payment.*not.*found/i)
    })

    it('rejects a cashout against another customer’s payment id (ownership check)', async () => {
      // Seed a second customer and a payment that belongs to *them*.
      await db.insert(users).values({ id: 'u_other', email: 'o@example.com' })
      const bookingId = await seedBooking()
      // Re-anchor that booking to u_other so the payment is owned by u_other.
      await db
        .update(bookings)
        .set({ customerUserId: 'u_other' })
        .where(eq(bookings.id, bookingId))
      await db.insert(payments).values({
        bookingId,
        razorpayPaymentId: 'pay_other',
        amount: '3000.00',
        captureTrigger: 'booking_create',
      })
      // u_c has plenty of refund_balance but does not own pay_other.
      await seedBalance('u_c', 'refund_balance', 5000)
      const { client, refundCalls } = makeStubRazorpay()
      _setRazorpayClientForTests(client)

      await expect(
        requestCashout(db, {
          userId: 'u_c',
          amountRupees: 1000,
          originalPaymentId: 'pay_other',
        }),
      ).rejects.toThrow(/payment.*not.*found/i)
      // Balance untouched
      expect(await readBalance('u_c', 'refund_balance')).toBe(5000)
      // Razorpay never called
      expect(refundCalls).toHaveLength(0)
      // No refund_request row
      const reqs = await db.select().from(refundRequests)
      expect(reqs).toHaveLength(0)
    })

    it('rejects non-positive amount', async () => {
      const bookingId = await seedBooking()
      await db.insert(payments).values({
        bookingId,
        razorpayPaymentId: 'pay_abc123',
        amount: '3000.00',
        captureTrigger: 'booking_create',
      })
      await expect(
        requestCashout(db, {
          userId: 'u_c',
          amountRupees: 0,
          originalPaymentId: 'pay_abc123',
        }),
      ).rejects.toThrow(/positive/i)
    })

    it('rejects non-integer amount', async () => {
      const bookingId = await seedBooking()
      await db.insert(payments).values({
        bookingId,
        razorpayPaymentId: 'pay_abc123',
        amount: '3000.00',
        captureTrigger: 'booking_create',
      })
      await expect(
        requestCashout(db, {
          userId: 'u_c',
          amountRupees: 100.5,
          originalPaymentId: 'pay_abc123',
        }),
      ).rejects.toThrow(/integer/i)
    })
  })
})
