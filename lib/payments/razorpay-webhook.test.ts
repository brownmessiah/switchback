import { createHmac } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { payments } from '@/db/schema/payments'
import { orders } from '@/db/schema/orders'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { _resetRedisCacheForTests, getRedis } from '@/lib/redis'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { createBooking } from './booking-create'
import {
  processRazorpayWebhook,
  type RazorpayWebhookResult,
} from './razorpay-webhook'

/**
 * Razorpay webhook handler — the idempotency-critical entry point for
 * `payment.captured`, `payment.failed`, and `refund.processed`.
 *
 * Layered idempotency per ADR-0001:
 *   1. Upstash Redis dedup on the event id, 14-day TTL — fast path.
 *   2. payments.razorpay_payment_id UNIQUE constraint with
 *      .onConflictDoNothing() — structural floor.
 *
 * 1000x replay must produce exactly one payments row. The Redis layer
 * eliminates 99% of redundant DB work; the unique constraint catches
 * the remaining race where a TTL has expired but the event is replayed
 * by Razorpay's 24-retry backoff window.
 */
const WEBHOOK_SECRET = 'whsec_test_outvers'

function sign(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
}

function buildPaymentCapturedBody(args: {
  eventId: string
  paymentId: string
  orderId: string
  bookingId: string
  amountPaise: number
}): string {
  return JSON.stringify({
    entity: 'event',
    account_id: 'acc_test',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: args.paymentId,
          entity: 'payment',
          amount: args.amountPaise,
          currency: 'INR',
          status: 'captured',
          order_id: args.orderId,
          notes: { booking_id: args.bookingId },
          captured: true,
          created_at: 1_700_000_000,
        },
      },
    },
    created_at: 1_700_000_000,
    id: args.eventId,
  })
}


function buildOrderScopedCapturedBody(args: {
  eventId: string
  paymentId: string
  dbOrderId: string
  rzpOrderId: string
  amountPaise: number
}): string {
  return JSON.stringify({
    entity: 'event',
    account_id: 'acc_test',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: args.paymentId,
          entity: 'payment',
          amount: args.amountPaise,
          currency: 'INR',
          status: 'captured',
          order_id: args.rzpOrderId,
          notes: { order_id: args.dbOrderId },
          captured: true,
          created_at: 1_700_000_000,
        },
      },
    },
    created_at: 1_700_000_000,
    id: args.eventId,
  })
}

function buildPaymentFailedBody(args: {
  eventId: string
  paymentId: string
  bookingId: string
  amountPaise: number
}): string {
  return JSON.stringify({
    entity: 'event',
    account_id: 'acc_test',
    event: 'payment.failed',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: args.paymentId,
          entity: 'payment',
          amount: args.amountPaise,
          currency: 'INR',
          status: 'failed',
          order_id: 'order_X',
          notes: { booking_id: args.bookingId },
          error_code: 'BAD_REQUEST_ERROR',
          error_description: 'card declined',
          created_at: 1_700_000_000,
        },
      },
    },
    created_at: 1_700_000_000,
    id: args.eventId,
  })
}

describe('processRazorpayWebhook (ADR-0001)', () => {
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
      businessName: 'Webhook Test Vendor',
      slug: 'webhook-test',
      // Identity-verified (ADR-0007 Tier 2) so the seeded within-cap
      // Experience can accept Bookings through createBooking's tier re-check.
      kycTier: 'identity',
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
      sql`TRUNCATE TABLE audit_logs, payments, refund_requests, bookings, commission_tiers, pricing_tiers, availability_slots, experiences CASCADE`,
    )
    _resetRedisCacheForTests()

    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'webhook-exp',
        title: 'Webhook Test Exp',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '2500.00',
        pricePerPerson_3_5: '2200.00',
        pricePerPerson_6_plus: '2000.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })

    // T+7d PINNED to 06:00-10:00 UTC so the slot stays inside one UTC
    // calendar day regardless of the wall-clock run time — otherwise the
    // Tier-2 single-day cap spuriously fires on the identity Vendor when
    // the suite runs late in the UTC day.
    const base = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const startAt = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 6, 0, 0),
    )
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId: exp!.id, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })

    const booking = await createBooking(db, {
      customerUserId: 'u_c',
      experienceId: exp!.id,
      slotId: slot!.id,
      participantCount: 2,
      paymentMode: 'full_upfront',
      idempotencyKey: crypto.randomUUID(),
    })
    bookingId = booking.bookingId
  })

  async function call(args: {
    body: string
    signature?: string
    eventIdHeader?: string | null
  }): Promise<RazorpayWebhookResult> {
    const signature = args.signature ?? sign(args.body)
    return processRazorpayWebhook({
      db,
      body: args.body,
      signature,
      eventIdHeader: args.eventIdHeader ?? null,
      secret: WEBHOOK_SECRET,
    })
  }

  describe('signature verification', () => {
    it('returns 401 on a tampered signature and writes nothing', async () => {
      const body = buildPaymentCapturedBody({
        eventId: 'evt_1',
        paymentId: 'pay_1',
        orderId: 'order_1',
        bookingId,
        amountPaise: 500_000,
      })
      const result = await call({ body, signature: 'a'.repeat(64) })
      expect(result.status).toBe(401)

      const paymentRows = await db.select().from(payments)
      expect(paymentRows).toHaveLength(0)
      const auditRows = await db.select().from(auditLogs)
      // booking.create audit row was already written by createBooking; no
      // new rows must appear from the rejected webhook.
      expect(auditRows.filter((r) => r.action.startsWith('webhook.'))).toHaveLength(0)
    })

    it('returns 401 on an empty signature header', async () => {
      const body = buildPaymentCapturedBody({
        eventId: 'evt_X',
        paymentId: 'pay_X',
        orderId: 'order_X',
        bookingId,
        amountPaise: 500_000,
      })
      const result = await call({ body, signature: '' })
      expect(result.status).toBe(401)
    })

    it('returns 500 (not 401) when the webhook secret is missing/empty — operator-correctable', async () => {
      const body = buildPaymentCapturedBody({
        eventId: 'evt_S',
        paymentId: 'pay_S',
        orderId: 'order_S',
        bookingId,
        amountPaise: 500_000,
      })
      const result = await processRazorpayWebhook({
        db,
        body,
        signature: 'whatever',
        eventIdHeader: null,
        secret: '',
      })
      expect(result.status).toBe(500)
    })
  })

  describe('payment.captured', () => {
    it('writes a payment row + audit row for a fresh event', async () => {
      const body = buildPaymentCapturedBody({
        eventId: 'evt_capture_1',
        paymentId: 'pay_capture_1',
        orderId: 'order_capture_1',
        bookingId,
        amountPaise: 500_000,
      })
      const result = await call({ body })
      expect(result.status).toBe(200)

      const paymentRows = await db.select().from(payments)
      expect(paymentRows).toHaveLength(1)
      expect(paymentRows[0]?.razorpayPaymentId).toBe('pay_capture_1')
      expect(paymentRows[0]?.razorpayOrderId).toBe('order_capture_1')
      expect(paymentRows[0]?.amount).toBe('5000.00')
      expect(paymentRows[0]?.captureTrigger).toBe('booking_create')
      expect(paymentRows[0]?.bookingId).toBe(bookingId)
      expect(paymentRows[0]?.rawWebhookPayload).toBeDefined()

      const webhookAuditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'webhook.payment.captured'))
      expect(webhookAuditRows).toHaveLength(1)
      expect(webhookAuditRows[0]?.entityId).toBe('pay_capture_1')
    })

    it('returns 200 with deduped=true for a duplicate event id (Redis hit)', async () => {
      const body = buildPaymentCapturedBody({
        eventId: 'evt_dup_1',
        paymentId: 'pay_dup_1',
        orderId: 'order_dup_1',
        bookingId,
        amountPaise: 500_000,
      })

      const first = await call({ body })
      expect(first.status).toBe(200)
      expect(first.deduped).toBeFalsy()

      const second = await call({ body })
      expect(second.status).toBe(200)
      expect(second.deduped).toBe(true)

      const paymentRows = await db.select().from(payments)
      expect(paymentRows).toHaveLength(1)
    })

    it('reads event id from X-Razorpay-Event-Id header in preference to body id', async () => {
      const body = buildPaymentCapturedBody({
        eventId: 'evt_body',
        paymentId: 'pay_h_1',
        orderId: 'order_h_1',
        bookingId,
        amountPaise: 500_000,
      })
      const first = await call({ body, eventIdHeader: 'evt_header' })
      expect(first.status).toBe(200)

      // Same body, same body-id ('evt_body'), but a DIFFERENT header id —
      // dedup should miss (header wins) and the structural DB unique
      // index on razorpay_payment_id catches the duplicate write.
      const second = await call({ body, eventIdHeader: 'evt_header_2' })
      expect(second.status).toBe(200)

      const paymentRows = await db.select().from(payments)
      // Exactly one row: the DB unique constraint defends against the
      // second insert when Redis dedup misses on a different header id.
      expect(paymentRows).toHaveLength(1)
    })

    it('falls back to body.id when no header is supplied (still dedups across replays)', async () => {
      const body = buildPaymentCapturedBody({
        eventId: 'evt_fallback',
        paymentId: 'pay_fb_1',
        orderId: 'order_fb_1',
        bookingId,
        amountPaise: 500_000,
      })
      const first = await call({ body, eventIdHeader: null })
      expect(first.status).toBe(200)

      const second = await call({ body, eventIdHeader: null })
      expect(second.status).toBe(200)
      expect(second.deduped).toBe(true)
    })

    it('1000x replay produces exactly one payments row (per PLAN.md verification)', async () => {
      const body = buildPaymentCapturedBody({
        eventId: 'evt_replay',
        paymentId: 'pay_replay_1',
        orderId: 'order_replay_1',
        bookingId,
        amountPaise: 500_000,
      })

      // 1000 sequential replays. Test uses serial calls (concurrent replays
      // would also produce one row, but that exercises the DB unique index,
      // not the Redis dedup we want to verify here).
      const results: RazorpayWebhookResult[] = []
      for (let i = 0; i < 1000; i++) {
        results.push(await call({ body }))
      }
      expect(results.every((r) => r.status === 200)).toBe(true)
      expect(results.filter((r) => r.deduped === true)).toHaveLength(999)

      const paymentRows = await db.select().from(payments)
      expect(paymentRows).toHaveLength(1)
    })

    it('replaying the SAME captured event N times yields a SINGLE Booking + one state transition (#35 idempotency)', async () => {
      // AC: assert exactly one Booking / one state transition after N
      // replays. The webhook records a capture against an existing Booking;
      // the "single state transition" invariant is one webhook.payment.captured
      // audit row + an unchanged Booking count, regardless of how many times
      // Razorpay re-delivers the same event.
      const bookingsBefore = await db.select().from(bookings)
      expect(bookingsBefore).toHaveLength(1)

      const body = buildPaymentCapturedBody({
        eventId: 'evt_single_transition',
        paymentId: 'pay_single_transition',
        orderId: 'order_single_transition',
        bookingId,
        amountPaise: 500_000,
      })

      const N = 25
      for (let i = 0; i < N; i++) {
        const r = await call({ body })
        expect(r.status).toBe(200)
      }

      // Exactly one capture row applied (no double-capture across replays).
      const paymentRows = await db.select().from(payments)
      expect(paymentRows).toHaveLength(1)

      // Exactly one state transition: a single webhook.payment.captured
      // audit row despite N deliveries.
      const captureAudit = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'webhook.payment.captured'))
      expect(captureAudit).toHaveLength(1)

      // No second Booking was created by the replays.
      const bookingsAfter = await db.select().from(bookings)
      expect(bookingsAfter).toHaveLength(1)
      expect(bookingsAfter[0]!.id).toBe(bookingId)
    })

    it('replaying the same captured event after a Redis eviction still applies ONE capture + ONE audit row (#35)', async () => {
      // Combines the DB-floor path with the single-state-transition AC: even
      // when Redis evicts the dedup key between deliveries (so every replay
      // re-enters the DB transaction), the razorpay_payment_id unique index
      // + onConflictDoNothing keep it at one capture row and one audit row.
      const body = buildPaymentCapturedBody({
        eventId: 'evt_evict_replay',
        paymentId: 'pay_evict_replay',
        orderId: 'order_evict_replay',
        bookingId,
        amountPaise: 500_000,
      })

      for (let i = 0; i < 5; i++) {
        // New event id each delivery + cache wipe ⇒ Redis dedup always misses,
        // forcing the DB unique constraint to be the sole idempotency floor.
        _resetRedisCacheForTests()
        const reDelivered = buildPaymentCapturedBody({
          eventId: `evt_evict_replay_${i}`,
          paymentId: 'pay_evict_replay', // same payment id across deliveries
          orderId: 'order_evict_replay',
          bookingId,
          amountPaise: 500_000,
        })
        const r = await call({ body: i === 0 ? body : reDelivered })
        expect(r.status).toBe(200)
      }

      const paymentRows = await db.select().from(payments)
      expect(paymentRows).toHaveLength(1)
      const captureAudit = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'webhook.payment.captured'))
      // onConflictDoNothing skips the audit write on the duplicate inserts,
      // so exactly one capture audit row survives all deliveries.
      expect(captureAudit).toHaveLength(1)
      const bookingsAfter = await db.select().from(bookings)
      expect(bookingsAfter).toHaveLength(1)
    })

    it('DB-level idempotency: when Redis evicts the dedup key, a re-delivered event with a new event id no-ops via ON CONFLICT', async () => {
      const body = buildPaymentCapturedBody({
        eventId: 'evt_db_1',
        paymentId: 'pay_db_unique',
        orderId: 'order_db_1',
        bookingId,
        amountPaise: 500_000,
      })
      const first = await call({ body })
      expect(first.status).toBe(200)

      // Simulate Redis eviction: clear the cache, then re-deliver the same
      // payment with a different event id (Razorpay can do this in theory
      // by re-signing). The payments.razorpay_payment_id UNIQUE constraint
      // + .onConflictDoNothing must prevent a second row.
      _resetRedisCacheForTests()

      const body2 = buildPaymentCapturedBody({
        eventId: 'evt_db_2',
        paymentId: 'pay_db_unique', // <— same payment id
        orderId: 'order_db_1',
        bookingId,
        amountPaise: 500_000,
      })
      const second = await call({ body: body2 })
      expect(second.status).toBe(200)

      const paymentRows = await db.select().from(payments)
      expect(paymentRows).toHaveLength(1)
    })
  })

  describe('payment.failed', () => {
    it('writes a webhook.payment.failed audit row + does NOT write a payment row + does not change booking state', async () => {
      const body = buildPaymentFailedBody({
        eventId: 'evt_fail_1',
        paymentId: 'pay_fail_1',
        bookingId,
        amountPaise: 500_000,
      })
      const result = await call({ body })
      expect(result.status).toBe(200)

      const paymentRows = await db.select().from(payments)
      expect(paymentRows).toHaveLength(0)

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'webhook.payment.failed'))
      expect(auditRows).toHaveLength(1)
      expect(auditRows[0]?.entityId).toBe('pay_fail_1')
      // Payload preserves Razorpay's error_code + description for ops.
      const payload = auditRows[0]?.payload as Record<string, unknown>
      expect(payload.errorCode).toBe('BAD_REQUEST_ERROR')
      expect(payload.errorDescription).toBe('card declined')

      const [bk] = await db.select().from(bookings).where(eq(bookings.id, bookingId))
      // Booking state remains confirmed; M3 handles state transition on
      // unrecoverable capture failure. In M2 we only record the failure.
      expect(bk?.state).toBe('confirmed')
    })

    it('records a sparse failure payload (no error_* fields, no order_id) with null fallbacks', async () => {
      // Razorpay does not always populate the structured error fields. The
      // handler must still record the failure, nulling the absent fields
      // rather than throwing — drives the `?? null` fallback arms.
      const body = JSON.stringify({
        entity: 'event',
        account_id: 'acc_test',
        event: 'payment.failed',
        contains: ['payment'],
        payload: {
          payment: {
            entity: {
              id: 'pay_fail_sparse',
              entity: 'payment',
              amount: 500_000,
              currency: 'INR',
              status: 'failed',
              notes: { booking_id: bookingId },
              created_at: 1_700_000_000,
            },
          },
        },
        created_at: 1_700_000_000,
        id: 'evt_fail_sparse',
      })

      const result = await call({ body })
      expect(result.status).toBe(200)

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'webhook.payment.failed'))
      expect(auditRows).toHaveLength(1)
      const payload = auditRows[0]?.payload as Record<string, unknown>
      expect(payload.errorCode).toBeNull()
      expect(payload.errorDescription).toBeNull()
      expect(payload.errorSource).toBeNull()
      expect(payload.errorReason).toBeNull()
    })
  })

  describe('refund.processed', () => {
    it('writes a webhook.refund.processed audit row (refund-flow handles the booking + wallet side in Task 14)', async () => {
      const body = JSON.stringify({
        entity: 'event',
        account_id: 'acc_test',
        event: 'refund.processed',
        contains: ['refund'],
        payload: {
          refund: {
            entity: {
              id: 'rfnd_1',
              entity: 'refund',
              amount: 250_000,
              currency: 'INR',
              payment_id: 'pay_X',
              notes: { booking_id: bookingId },
              status: 'processed',
              created_at: 1_700_000_000,
            },
          },
        },
        created_at: 1_700_000_000,
        id: 'evt_refund_1',
      })

      const result = await call({ body })
      expect(result.status).toBe(200)

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'webhook.refund.processed'))
      expect(auditRows).toHaveLength(1)
      expect(auditRows[0]?.entityId).toBe('rfnd_1')
    })

    it('records a refund with no notes (booking_id unresolvable) as null bookingId', async () => {
      // A refund.processed event whose entity carries no notes object —
      // extractBookingId returns null and the handler records the audit
      // row anyway. Drives the `if (!notes) return null` arm + the
      // `?? null` fallbacks for bookingId and eventId.
      const body = JSON.stringify({
        entity: 'event',
        account_id: 'acc_test',
        event: 'refund.processed',
        contains: ['refund'],
        payload: {
          refund: {
            entity: {
              id: 'rfnd_no_notes',
              entity: 'refund',
              amount: 100_000,
              currency: 'INR',
              payment_id: 'pay_Y',
              status: 'processed',
              created_at: 1_700_000_000,
            },
          },
        },
        created_at: 1_700_000_000,
        id: 'evt_refund_no_notes',
      })

      const result = await call({ body })
      expect(result.status).toBe(200)

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'webhook.refund.processed'))
      expect(auditRows).toHaveLength(1)
      const payload = auditRows[0]?.payload as Record<string, unknown>
      expect(payload.bookingId).toBeNull()
    })
  })

  describe('unknown / malformed events', () => {
    it('returns 200 + ignored=true for an event type we do not handle (e.g. subscription.charged)', async () => {
      const body = JSON.stringify({
        entity: 'event',
        event: 'subscription.charged',
        contains: ['subscription'],
        payload: { subscription: { entity: { id: 'sub_1' } } },
        created_at: 1_700_000_000,
        id: 'evt_unknown_1',
      })
      const result = await call({ body })
      expect(result.status).toBe(200)
      expect(result.ignored).toBe(true)
      const paymentRows = await db.select().from(payments)
      expect(paymentRows).toHaveLength(0)
    })

    it('returns 400 on unparseable JSON', async () => {
      const body = '{not json'
      const sig = sign(body)
      const result = await call({ body, signature: sig })
      expect(result.status).toBe(400)
    })

    it('returns 400 when neither the header nor body carries an event id', async () => {
      const body = JSON.stringify({
        entity: 'event',
        event: 'payment.captured',
        contains: ['payment'],
        payload: {
          payment: {
            entity: {
              id: 'pay_x',
              amount: 1,
              currency: 'INR',
              status: 'captured',
              notes: { booking_id: bookingId },
            },
          },
        },
        created_at: 1_700_000_000,
        // id missing on purpose
      })
      const result = await call({ body, eventIdHeader: null })
      expect(result.status).toBe(400)
    })

    it('returns 400 when payment.captured payload.payment is missing entirely', async () => {
      const body = JSON.stringify({
        entity: 'event',
        event: 'payment.captured',
        contains: ['payment'],
        payload: {},
        created_at: 1_700_000_000,
        id: 'evt_capmiss_1',
      })
      const result = await call({ body })
      expect(result.status).toBe(400)
    })

    it('returns 400 when payment.failed payload.payment is missing entirely', async () => {
      const body = JSON.stringify({
        entity: 'event',
        event: 'payment.failed',
        contains: ['payment'],
        payload: {},
        created_at: 1_700_000_000,
        id: 'evt_failmiss_1',
      })
      const result = await call({ body })
      expect(result.status).toBe(400)
    })

    it('returns 400 when payment.failed notes lack booking_id', async () => {
      const body = JSON.stringify({
        entity: 'event',
        event: 'payment.failed',
        contains: ['payment'],
        payload: {
          payment: {
            entity: {
              id: 'pay_failnobk',
              amount: 100_000,
              currency: 'INR',
              status: 'failed',
              notes: {},
            },
          },
        },
        created_at: 1_700_000_000,
        id: 'evt_failnobk_1',
      })
      const result = await call({ body })
      expect(result.status).toBe(400)
    })

    it('returns 400 when refund.processed payload.refund is missing entirely', async () => {
      const body = JSON.stringify({
        entity: 'event',
        event: 'refund.processed',
        contains: ['refund'],
        payload: {},
        created_at: 1_700_000_000,
        id: 'evt_refundmiss_1',
      })
      const result = await call({ body })
      expect(result.status).toBe(400)
    })

    it('returns 500 when the inner DB work throws (internal error path)', async () => {
      const body = buildPaymentCapturedBody({
        eventId: 'evt_internal_1',
        paymentId: 'pay_internal_1',
        orderId: 'order_internal_1',
        bookingId: 'not-a-real-uuid', // FK constraint will reject
        amountPaise: 500_000,
      })
      const result = await call({ body })
      expect(result.status).toBe(500)
      // Internal error message must NOT echo to the response — DB
      // constraint messages would leak schema details into Razorpay's
      // dashboard logs.
      expect(result.body).toEqual({ error: 'internal error processing webhook' })
    })

    it('clears the dedup key on DB failure so Razorpay retries can land the row', async () => {
      const body = buildPaymentCapturedBody({
        eventId: 'evt_retry_after_500',
        paymentId: 'pay_retry_after_500',
        orderId: 'order_retry_after_500',
        bookingId: 'not-a-real-uuid', // will fail FK
        amountPaise: 500_000,
      })
      const first = await call({ body })
      expect(first.status).toBe(500)

      // Without the key-cleanup fix, a retry would short-circuit via Redis
      // dedup and return 200 deduped — leaving the booking forever without
      // a payment row. The fix clears the key on 500 so the retry path
      // re-enters the DB transaction.
      const redis = getRedis()
      const stillCached = await redis.get('razorpay-event:evt_retry_after_500')
      expect(stillCached).toBeNull()
    })

    it('returns 400 when payment.captured payload has no booking_id in notes', async () => {
      const body = JSON.stringify({
        entity: 'event',
        event: 'payment.captured',
        contains: ['payment'],
        payload: {
          payment: {
            entity: {
              id: 'pay_nobk',
              amount: 100_000,
              currency: 'INR',
              order_id: 'order_nobk',
              status: 'captured',
              notes: {}, // no booking_id
              captured: true,
            },
          },
        },
        created_at: 1_700_000_000,
        id: 'evt_nobk_1',
      })
      const result = await call({ body })
      expect(result.status).toBe(400)
    })
  })
  describe('payment.captured — order-scoped (issue 12, ADR-0021)', () => {
    async function seedOrder(rzpOrderId: string): Promise<string> {
      const [order] = await db
        .insert(orders)
        .values({
          customerUserId: 'u_c',
          razorpayOrderId: rzpOrderId,
          amountTotalSnapshot: '5000.00',
        })
        .returning({ id: orders.id })
      return order!.id
    }

    it('records ONE order-scoped payment row (booking_id NULL) + audit + flips the order to paid', async () => {
      const dbOrderId = await seedOrder('order_rzp_cart_1')
      const body = buildOrderScopedCapturedBody({
        eventId: 'evt_order_1',
        paymentId: 'pay_order_1',
        dbOrderId,
        rzpOrderId: 'order_rzp_cart_1',
        amountPaise: 500_000,
      })
      const result = await call({ body })
      expect(result.status).toBe(200)

      const rows = await db
        .select()
        .from(payments)
        .where(eq(payments.razorpayPaymentId, 'pay_order_1'))
      expect(rows).toHaveLength(1)
      expect(rows[0]!.orderId).toBe(dbOrderId)
      expect(rows[0]!.bookingId).toBeNull()
      expect(rows[0]!.amount).toBe('5000.00')

      const [orderRow] = await db.select().from(orders).where(eq(orders.id, dbOrderId))
      expect(orderRow!.state).toBe('paid')

      const audits = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'webhook.payment.captured'))
      expect(audits.length).toBeGreaterThanOrEqual(1)
    })

    it('is idempotent against replay (dedup + unique payment id): 3 deliveries, one row', async () => {
      const dbOrderId = await seedOrder('order_rzp_cart_2')
      const body = buildOrderScopedCapturedBody({
        eventId: 'evt_order_2',
        paymentId: 'pay_order_2',
        dbOrderId,
        rzpOrderId: 'order_rzp_cart_2',
        amountPaise: 500_000,
      })
      const first = await call({ body })
      expect(first.status).toBe(200)
      const second = await call({ body })
      expect(second.deduped).toBe(true)
      // Simulate Redis eviction: the DB unique is the structural floor.
      _resetRedisCacheForTests()
      const third = await call({ body })
      expect(third.status).toBe(200)

      const rows = await db
        .select()
        .from(payments)
        .where(eq(payments.razorpayPaymentId, 'pay_order_2'))
      expect(rows).toHaveLength(1)
    })

    it('400 when notes carry NEITHER booking_id nor order_id', async () => {
      const body = buildOrderScopedCapturedBody({
        eventId: 'evt_order_3',
        paymentId: 'pay_order_3',
        dbOrderId: '',
        rzpOrderId: 'order_rzp_cart_3',
        amountPaise: 100,
      }).replace('"notes":{"order_id":""}', '"notes":{}')
      const result = await call({ body })
      expect(result.status).toBe(400)
    })
    it('order-scoped payment.failed is AUDITED, never dropped as 400 (M2)', async () => {
      const dbOrderId = await seedOrder('order_rzp_cart_fail')
      const body = JSON.stringify({
        entity: 'event',
        account_id: 'acc_test',
        event: 'payment.failed',
        contains: ['payment'],
        payload: {
          payment: {
            entity: {
              id: 'pay_order_fail_1',
              entity: 'payment',
              amount: 500_000,
              currency: 'INR',
              status: 'failed',
              order_id: 'order_rzp_cart_fail',
              notes: { order_id: dbOrderId },
              captured: false,
              created_at: 1_700_000_000,
              error_code: 'BAD_REQUEST_ERROR',
            },
          },
        },
        created_at: 1_700_000_000,
        id: 'evt_order_fail_1',
      })
      const result = await call({ body })
      expect(result.status).toBe(200)

      const audits = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'webhook.payment.failed'))
      const orderScoped = audits.filter(
        (a) => (a.payload as { orderId?: string }).orderId === dbOrderId,
      )
      expect(orderScoped).toHaveLength(1)
    })
  })
})
