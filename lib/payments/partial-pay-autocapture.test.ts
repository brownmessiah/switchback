import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { payments } from '@/db/schema/payments'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import {
  _resetRazorpayClientForTests,
  _setRazorpayClientForTests,
  RazorpayClientError,
  type RazorpaySdkLike,
} from '@/lib/payments/razorpay-client'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { processPartialPayAutocapture } from './partial-pay-autocapture'

/**
 * Partial-pay auto-capture worker per ADR-0001. Run every 15 minutes by
 * Vercel Cron. For each Booking in state=confirmed with payment_mode=
 * partial_pay whose slot.startAt is between (now+23.5h) and (now+24.5h),
 * the worker captures the remaining 75% via the Razorpay client.
 *
 * Idempotency: the worker filters out bookings that already have a
 * payments row with capture_trigger='auto_capture_t_minus_24h'. A
 * concurrent second run sees the existing row and skips. Task 17 lands
 * the structural partial unique index as defense-in-depth.
 *
 * Retry policy: retryable Razorpay errors (UPSTREAM_5XX, rate limited)
 * back off with the injected delay function up to maxAttempts times.
 * Non-retryable errors (auth, bad_request, not_found) terminate
 * immediately. On terminal failure: audit + booking.state →
 * awaiting_completion + Pusher event so the Vendor inbox flags it.
 */
describe('processPartialPayAutocapture (ADR-0001)', () => {
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
    _resetRazorpayClientForTests()
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'rafting-day',
        title: 'Rafting Day',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront', 'partial_pay'],
        pricePerPerson_1_2: '2000.00',
        pricePerPerson_3_5: '1800.00',
        pricePerPerson_6_plus: '1500.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    experienceId = exp!.id
  })

  /**
   * Seed a partial-pay booking + the original 25% advance payment row.
   * Returns the bookingId and the advance Razorpay payment id so tests
   * can assert the autocapture row references the correct upstream id.
   */
  async function seedPartialPayBooking(args: {
    hoursAhead: number
    state?: 'confirmed' | 'completed' | 'cancelled_by_customer'
    paymentMode?: 'partial_pay' | 'full_upfront'
    grossRupees?: number
  }): Promise<{ bookingId: string; advancePaymentId: string }> {
    const startAt = new Date(Date.now() + args.hoursAhead * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })
    const gross = args.grossRupees ?? 4000
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_c',
        experienceId,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: args.paymentMode ?? 'partial_pay',
        state: args.state ?? 'confirmed',
        grossTotalSnapshot: gross.toFixed(2),
        pricePerParticipantSnapshot: (gross / 2).toFixed(2),
        pricingBasisSnapshot: 'experience_bracket:1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: 'flexible',
        tdsAmountSnapshot: (gross * 0.01).toFixed(2),
        gstRateOnCommissionSnapshot: '18.00',
        vendorPanSnapshot: 'ABCDE1234F',
        vendorIsResidentSnapshot: true,
        payoutMethodSnapshot: 'upi',
        payoutDestinationSnapshot: { vpa: 'vendor@upi' },
      })
      .returning({ id: bookings.id })
    const advancePaymentId = `pay_advance_${booking!.id.slice(0, 8)}`
    await db.insert(payments).values({
      bookingId: booking!.id,
      razorpayPaymentId: advancePaymentId,
      amount: Math.floor(gross * 0.25).toFixed(2),
      captureTrigger: 'booking_create',
    })
    return { bookingId: booking!.id, advancePaymentId }
  }

  interface StubResult {
    client: RazorpaySdkLike
    captures: Array<{ paymentId: string; amount: number }>
  }

  function makeStubRazorpay(opts?: {
    fail?: 'retryable' | 'non_retryable' | { failTimes: number }
  }): StubResult {
    const captures: Array<{ paymentId: string; amount: number }> = []
    let callCount = 0
    const client: RazorpaySdkLike = {
      orders: { create: vi.fn() },
      payments: {
        capture: vi.fn(async (paymentId, amount) => {
          callCount++
          if (opts?.fail === 'retryable') {
            throw new RazorpayClientError(
              'UPSTREAM_5XX',
              true,
              'simulated 502',
              502,
            )
          }
          if (opts?.fail === 'non_retryable') {
            throw new RazorpayClientError(
              'RAZORPAY_BAD_REQUEST',
              false,
              'simulated 400',
              400,
            )
          }
          if (
            typeof opts?.fail === 'object' &&
            callCount <= opts.fail.failTimes
          ) {
            throw new RazorpayClientError(
              'UPSTREAM_5XX',
              true,
              `simulated 502 attempt ${callCount}`,
              502,
            )
          }
          captures.push({ paymentId, amount })
          return {
            id: `pay_autocapture_${captures.length}`,
            amount,
            status: 'captured',
            captured: true,
          }
        }),
        refund: vi.fn(),
      },
    }
    return { client, captures }
  }

  describe('window selection', () => {
    it('processes a booking whose slot is in the 23.5h-24.5h window', async () => {
      const { bookingId } = await seedPartialPayBooking({ hoursAhead: 24 })
      const { client, captures } = makeStubRazorpay()
      _setRazorpayClientForTests(client)

      const result = await processPartialPayAutocapture({ db })

      expect(result.processed).toBe(1)
      expect(result.succeeded).toBe(1)
      expect(result.failed).toBe(0)
      // Razorpay called with 75% of 4000 = 3000 rupees → 300000 paise
      expect(captures).toHaveLength(1)
      expect(captures[0]!.amount).toBe(300_000)
      // New payment row written
      const captureRows = await db
        .select()
        .from(payments)
        .where(eq(payments.captureTrigger, 'auto_capture_t_minus_24h'))
      expect(captureRows).toHaveLength(1)
      expect(captureRows[0]!.bookingId).toBe(bookingId)
      expect(captureRows[0]!.amount).toBe('3000.00')
    })

    it('skips a booking whose slot is outside the window (e.g. 30h ahead)', async () => {
      await seedPartialPayBooking({ hoursAhead: 30 })
      const { client, captures } = makeStubRazorpay()
      _setRazorpayClientForTests(client)

      const result = await processPartialPayAutocapture({ db })
      expect(result.processed).toBe(0)
      expect(captures).toHaveLength(0)
    })

    it('skips a booking with payment_mode=full_upfront', async () => {
      await seedPartialPayBooking({ hoursAhead: 24, paymentMode: 'full_upfront' })
      const { client, captures } = makeStubRazorpay()
      _setRazorpayClientForTests(client)
      const result = await processPartialPayAutocapture({ db })
      expect(result.processed).toBe(0)
      expect(captures).toHaveLength(0)
    })

    it('skips a booking already past confirmed (cancelled, completed)', async () => {
      await seedPartialPayBooking({
        hoursAhead: 24,
        state: 'cancelled_by_customer',
      })
      const { client } = makeStubRazorpay()
      _setRazorpayClientForTests(client)
      const result = await processPartialPayAutocapture({ db })
      expect(result.processed).toBe(0)
    })

    it('processes multiple in-window bookings in one run', async () => {
      await seedPartialPayBooking({ hoursAhead: 24 })
      await seedPartialPayBooking({ hoursAhead: 23.7 })
      await seedPartialPayBooking({ hoursAhead: 24.3 })
      const { client, captures } = makeStubRazorpay()
      _setRazorpayClientForTests(client)
      const result = await processPartialPayAutocapture({ db })
      expect(result.processed).toBe(3)
      expect(result.succeeded).toBe(3)
      expect(captures).toHaveLength(3)
    })
  })

  describe('idempotency', () => {
    it('skips a booking that already has an auto_capture row (re-entrant)', async () => {
      const { bookingId, advancePaymentId } = await seedPartialPayBooking({
        hoursAhead: 24,
      })
      // Simulate prior cron run
      await db.insert(payments).values({
        bookingId,
        razorpayPaymentId: `${advancePaymentId}_autocap`,
        amount: '3000.00',
        captureTrigger: 'auto_capture_t_minus_24h',
      })
      const { client, captures } = makeStubRazorpay()
      _setRazorpayClientForTests(client)

      const result = await processPartialPayAutocapture({ db })
      expect(result.processed).toBe(1)
      expect(result.skipped).toBe(1)
      expect(result.succeeded).toBe(0)
      expect(captures).toHaveLength(0)
    })

    it('produces exactly one auto_capture row even if invoked twice serially', async () => {
      await seedPartialPayBooking({ hoursAhead: 24 })
      const { client } = makeStubRazorpay()
      _setRazorpayClientForTests(client)

      await processPartialPayAutocapture({ db })
      await processPartialPayAutocapture({ db })
      const captureRows = await db
        .select()
        .from(payments)
        .where(eq(payments.captureTrigger, 'auto_capture_t_minus_24h'))
      expect(captureRows).toHaveLength(1)
    })
  })

  describe('retry policy', () => {
    it('retries a retryable error and succeeds on the second attempt', async () => {
      await seedPartialPayBooking({ hoursAhead: 24 })
      const { client, captures } = makeStubRazorpay({ fail: { failTimes: 1 } })
      _setRazorpayClientForTests(client)

      const delays: number[] = []
      const result = await processPartialPayAutocapture({
        db,
        delayMs: (attempt) => {
          delays.push(attempt)
          return 0
        },
        maxAttempts: 3,
      })
      expect(result.succeeded).toBe(1)
      expect(result.failed).toBe(0)
      // One failed call, one successful — capture only recorded on success
      expect(captures).toHaveLength(1)
      expect(delays).toEqual([1]) // delay before the second attempt
    })

    it('gives up after maxAttempts on persistent retryable errors', async () => {
      const { bookingId } = await seedPartialPayBooking({ hoursAhead: 24 })
      const { client, captures } = makeStubRazorpay({ fail: 'retryable' })
      _setRazorpayClientForTests(client)

      const result = await processPartialPayAutocapture({
        db,
        delayMs: () => 0,
        maxAttempts: 3,
      })
      expect(result.failed).toBe(1)
      expect(result.succeeded).toBe(0)
      expect(captures).toHaveLength(0)

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'partial_pay.autocapture_failed'))
      expect(auditRows).toHaveLength(1)
      expect(auditRows[0]!.entityId).toBe(bookingId)
      // Booking remains in 'confirmed' state — moving to awaiting_completion
      // would let M3's auto-complete trigger silently close an unpaid
      // Booking at end_at+24h. Vendor inbox sees the Pusher event +
      // audit row and decides next step.
      const [bookingRow] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(bookingRow?.state).toBe('confirmed')
    })

    it('does not retry a non-retryable error', async () => {
      const { bookingId } = await seedPartialPayBooking({ hoursAhead: 24 })
      const { client } = makeStubRazorpay({ fail: 'non_retryable' })
      _setRazorpayClientForTests(client)

      const attempts: number[] = []
      const result = await processPartialPayAutocapture({
        db,
        delayMs: (a) => {
          attempts.push(a)
          return 0
        },
        maxAttempts: 3,
      })
      expect(result.failed).toBe(1)
      // No retries for non-retryable
      expect(attempts).toEqual([])

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'partial_pay.autocapture_failed'))
      expect(auditRows).toHaveLength(1)
      const payload = auditRows[0]?.payload as Record<string, unknown>
      expect(payload.razorpayCode).toBe('RAZORPAY_BAD_REQUEST')
      const [bookingRow] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(bookingRow?.state).toBe('confirmed')
    })
  })

  describe('money math + amount validation', () => {
    it('captures gross-minus-floor(advance) on odd-rupee gross (no residue lost)', async () => {
      await seedPartialPayBooking({ hoursAhead: 24, grossRupees: 4001 })
      // floor(4001 * 0.25) = 1000 advance → autocapture = 4001 - 1000 = 3001
      const { client, captures } = makeStubRazorpay()
      _setRazorpayClientForTests(client)
      await processPartialPayAutocapture({ db })
      expect(captures).toHaveLength(1)
      // 3001 rupees * 100 paise = 300_100 paise
      expect(captures[0]!.amount).toBe(300_100)
    })

    it('refuses to commit a payment row when Razorpay returns a mismatched amount', async () => {
      const { bookingId } = await seedPartialPayBooking({ hoursAhead: 24 })
      const mismatchClient: RazorpaySdkLike = {
        orders: { create: vi.fn() },
        payments: {
          capture: vi.fn(async (paymentId, amount) => ({
            id: 'pay_tampered',
            // Returns half the requested amount — must be rejected.
            amount: Math.floor(amount / 2),
            status: 'captured',
            captured: true,
          })),
          refund: vi.fn(),
        },
      }
      _setRazorpayClientForTests(mismatchClient)
      const result = await processPartialPayAutocapture({
        db,
        delayMs: () => 0,
        maxAttempts: 1,
      })
      expect(result.failed).toBe(1)
      const captureRows = await db
        .select()
        .from(payments)
        .where(eq(payments.captureTrigger, 'auto_capture_t_minus_24h'))
      expect(captureRows).toHaveLength(0)
      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'partial_pay.autocapture_failed'))
      expect(auditRows).toHaveLength(1)
      expect(auditRows[0]!.entityId).toBe(bookingId)
    })
  })

  describe('audit + state', () => {
    it('writes a successful partial_pay.autocaptured audit row including 75% amount', async () => {
      const { bookingId } = await seedPartialPayBooking({ hoursAhead: 24 })
      const { client } = makeStubRazorpay()
      _setRazorpayClientForTests(client)
      await processPartialPayAutocapture({ db })

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'partial_pay.autocaptured'))
      expect(auditRows).toHaveLength(1)
      expect(auditRows[0]!.entityId).toBe(bookingId)
      const payload = auditRows[0]?.payload as Record<string, unknown>
      expect(payload.amountRupees).toBe(3000)
      expect(payload.bookingId).toBe(bookingId)
    })

    it('keeps booking state=confirmed on success (M3 handles transition to awaiting_completion at end_at)', async () => {
      const { bookingId } = await seedPartialPayBooking({ hoursAhead: 24 })
      const { client } = makeStubRazorpay()
      _setRazorpayClientForTests(client)
      await processPartialPayAutocapture({ db })

      const [bookingRow] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(bookingRow?.state).toBe('confirmed')
    })
  })

  describe('booking without an Advance payment row', () => {
    it('audits the failure when no booking_create payment row is on file', async () => {
      // Create a booking but skip the advance payment seeding
      const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
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
          paymentMode: 'partial_pay',
          state: 'confirmed',
          grossTotalSnapshot: '4000.00',
          pricePerParticipantSnapshot: '2000.00',
          pricingBasisSnapshot: 'experience_bracket:1_2',
          commissionRateSnapshot: '20.00',
          commissionBasisSnapshot: 'vendor_default',
          cancellationPresetSnapshot: 'flexible',
          tdsAmountSnapshot: '40.00',
          gstRateOnCommissionSnapshot: '18.00',
          vendorPanSnapshot: 'ABCDE1234F',
          vendorIsResidentSnapshot: true,
          payoutMethodSnapshot: 'upi',
          payoutDestinationSnapshot: { vpa: 'vendor@upi' },
        })
        .returning({ id: bookings.id })
      const { client } = makeStubRazorpay()
      _setRazorpayClientForTests(client)

      const result = await processPartialPayAutocapture({ db })
      expect(result.failed).toBe(1)
      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'partial_pay.autocapture_failed'))
      expect(auditRows).toHaveLength(1)
      expect(auditRows[0]!.entityId).toBe(booking!.id)
      const payload = auditRows[0]?.payload as Record<string, unknown>
      expect(payload.reason).toBe('advance_payment_not_found')
      // Booking state unchanged — vendor inbox triages via the audit
      // row + Pusher event, the booking is not silently progressed.
      const [bookingRow] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, booking!.id))
      expect(bookingRow?.state).toBe('confirmed')
    })
  })
})
