import { z } from 'zod'

import { payments } from '@/db/schema/payments'
import { writeAuditLog } from '@/lib/audit/write'
import { getRedis } from '@/lib/redis'

import type { DBOrTx } from './commission-resolver'
import { verifyWebhookSignature } from './razorpay-signature'

/**
 * Razorpay webhook handler — idempotent ingestion of `payment.captured`,
 * `payment.failed`, and `refund.processed` events per ADR-0001.
 *
 * Idempotency is layered:
 *   1. Upstash Redis dedup on the Razorpay event id (14-day TTL). Fast
 *      path — 99% of replays hit this before any DB work.
 *   2. payments.razorpay_payment_id UNIQUE constraint with Drizzle's
 *      .onConflictDoNothing() — the structural floor for the rare case
 *      where Redis evicts a key inside Razorpay's 24-retry window.
 *
 * The 1000x replay verification test (lib/payments/razorpay-webhook.test.ts)
 * exercises both layers: a serial replay produces 999 dedup hits + 1 real
 * insert.
 *
 * Status code policy (informed by the Task 11 review carry-over):
 *   - Missing secret           → 500 (operator-correctable; Razorpay retries)
 *   - Invalid signature        → 401 (adversarial / misconfigured caller)
 *   - Malformed JSON / payload → 400 (do not retry — structural bug upstream)
 *   - Unknown event type       → 200 ignored (ack, no work)
 *   - Duplicate event id       → 200 deduped
 *   - Success                  → 200
 *   - Internal DB error        → 500 (retry)
 *
 * The handler does NOT change booking state on payment.failed in M2 —
 * we record the failure to audit_logs and let the M3 capture worker /
 * vendor inbox decide what to do.
 */

const DEDUP_TTL_SECONDS = 14 * 24 * 60 * 60

const PaymentEntitySchema = z.object({
  id: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  order_id: z.string().nullable().optional(),
  status: z.string(),
  notes: z.record(z.string(), z.unknown()).optional(),
  captured: z.boolean().optional(),
  error_code: z.string().nullable().optional(),
  error_description: z.string().nullable().optional(),
  error_source: z.string().nullable().optional(),
  error_reason: z.string().nullable().optional(),
})

const RefundEntitySchema = z.object({
  id: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  payment_id: z.string().min(1),
  notes: z.record(z.string(), z.unknown()).optional(),
  status: z.string(),
})

const WebhookEventSchema = z.object({
  entity: z.literal('event'),
  event: z.string().min(1),
  id: z.string().optional(),
  contains: z.array(z.string()).optional(),
  payload: z
    .object({
      payment: z.object({ entity: PaymentEntitySchema }).optional(),
      refund: z.object({ entity: RefundEntitySchema }).optional(),
    })
    .passthrough(),
  created_at: z.number().optional(),
})

type WebhookEvent = z.infer<typeof WebhookEventSchema>
type PaymentEntity = z.infer<typeof PaymentEntitySchema>
type RefundEntity = z.infer<typeof RefundEntitySchema>

export interface ProcessRazorpayWebhookArgs {
  db: DBOrTx
  body: string
  signature: string
  /** Value of the `X-Razorpay-Event-Id` header, or null/undefined if absent. */
  eventIdHeader: string | null | undefined
  secret: string
}

export interface RazorpayWebhookResult {
  status: 200 | 400 | 401 | 500
  body: Record<string, unknown>
  /** True iff Redis dedup short-circuited the request. */
  deduped?: boolean
  /** True iff the event type was not one we handle. */
  ignored?: boolean
}

export async function processRazorpayWebhook(
  args: ProcessRazorpayWebhookArgs,
): Promise<RazorpayWebhookResult> {
  const { db, body, signature, eventIdHeader, secret } = args

  if (!secret) {
    return {
      status: 500,
      body: { error: 'webhook secret not configured' },
    }
  }

  if (!verifyWebhookSignature(body, signature, secret)) {
    return { status: 401, body: { error: 'invalid signature' } }
  }

  let event: WebhookEvent
  try {
    const parsed = JSON.parse(body) as unknown
    event = WebhookEventSchema.parse(parsed)
  } catch {
    return { status: 400, body: { error: 'invalid event body' } }
  }

  const eventId =
    (typeof eventIdHeader === 'string' && eventIdHeader.length > 0
      ? eventIdHeader
      : event.id) ?? null
  if (!eventId) {
    return { status: 400, body: { error: 'event id missing' } }
  }

  const redis = getRedis()
  const dedupKey = `razorpay-event:${eventId}`
  const seen = await redis.get(dedupKey)
  if (seen) {
    return { status: 200, body: { ok: true, deduped: true }, deduped: true }
  }

  // Set the dedup key BEFORE doing DB work so concurrent retries within
  // the 14-day window also short-circuit. The DB unique constraint is
  // the structural floor if Redis evicts the key before all retries land.
  await redis.set(dedupKey, '1', { ex: DEDUP_TTL_SECONDS })

  const handled = new Set(['payment.captured', 'payment.failed', 'refund.processed'])
  if (!handled.has(event.event)) {
    return {
      status: 200,
      body: { ok: true, ignored: event.event },
      ignored: true,
    }
  }

  try {
    if (event.event === 'payment.captured') {
      const payment = event.payload.payment?.entity
      if (!payment) {
        return { status: 400, body: { error: 'payment.captured missing payload.payment' } }
      }
      const bookingId = extractBookingId(payment.notes)
      if (!bookingId) {
        return { status: 400, body: { error: 'payment.captured notes missing booking_id' } }
      }
      await persistPaymentCaptured({ db, payment, bookingId, event })
    } else if (event.event === 'payment.failed') {
      const payment = event.payload.payment?.entity
      if (!payment) {
        return { status: 400, body: { error: 'payment.failed missing payload.payment' } }
      }
      const bookingId = extractBookingId(payment.notes)
      if (!bookingId) {
        return { status: 400, body: { error: 'payment.failed notes missing booking_id' } }
      }
      await recordPaymentFailed({ db, payment, bookingId, event })
    } else if (event.event === 'refund.processed') {
      const refund = event.payload.refund?.entity
      if (!refund) {
        return { status: 400, body: { error: 'refund.processed missing payload.refund' } }
      }
      await recordRefundProcessed({ db, refund, event })
    }
    return { status: 200, body: { ok: true } }
  } catch {
    // Clear the dedup key so Razorpay's retry policy (24 deliveries over
    // ~24h) can land the payment on a transient DB / network blip. Without
    // this, the next retry would see the key, return 200 deduped, and the
    // payment row would never get written.
    try {
      await redis.del(dedupKey)
    } catch {
      // If Redis itself is the failure mode, swallowing the secondary
      // error is fine — the primary 500 still flows back and the missing
      // dedup key just means future retries re-enter the DB path.
    }
    // Do NOT echo the internal error message back to Razorpay. Postgres /
    // Drizzle messages typically include the offending constraint or
    // table name, which would leak schema details into Razorpay's
    // dashboard logs. Operators read the application's own server logs.
    return {
      status: 500,
      body: { error: 'internal error processing webhook' },
    }
  }
}

function extractBookingId(notes: Record<string, unknown> | undefined): string | null {
  if (!notes) return null
  const raw = notes.booking_id
  if (typeof raw === 'string' && raw.length > 0) return raw
  return null
}

interface PersistPaymentCapturedArgs {
  db: DBOrTx
  payment: PaymentEntity
  bookingId: string
  event: WebhookEvent
}

async function persistPaymentCaptured(args: PersistPaymentCapturedArgs): Promise<void> {
  const { db, payment, bookingId, event } = args
  const amountRupees = (payment.amount / 100).toFixed(2)

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(payments)
      .values({
        bookingId,
        razorpayPaymentId: payment.id,
        razorpayOrderId: payment.order_id ?? null,
        amount: amountRupees,
        captureTrigger: 'booking_create',
        rawWebhookPayload: event as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: payments.razorpayPaymentId })
      .returning({ id: payments.id })

    // If the insert was a no-op (duplicate via DB-level unique), skip the
    // audit row — the original capture event already logged.
    if (inserted.length === 0) return

    await writeAuditLog(tx, {
      actorUserId: null,
      action: 'webhook.payment.captured',
      entityType: 'payment',
      entityId: payment.id,
      payload: {
        bookingId,
        razorpayPaymentId: payment.id,
        razorpayOrderId: payment.order_id ?? null,
        amountRupees,
        status: payment.status,
        eventId: event.id ?? null,
      },
    })
  })
}

interface RecordPaymentFailedArgs {
  db: DBOrTx
  payment: PaymentEntity
  bookingId: string
  event: WebhookEvent
}

async function recordPaymentFailed(args: RecordPaymentFailedArgs): Promise<void> {
  const { db, payment, bookingId, event } = args

  // M2 contract: only record the failure to audit_logs. M3's capture
  // worker decides whether to retry, mark the Booking as failed, or
  // surface to the Vendor inbox.
  await writeAuditLog(db, {
    actorUserId: null,
    action: 'webhook.payment.failed',
    entityType: 'payment',
    entityId: payment.id,
    payload: {
      bookingId,
      razorpayPaymentId: payment.id,
      errorCode: payment.error_code ?? null,
      errorDescription: payment.error_description ?? null,
      errorSource: payment.error_source ?? null,
      errorReason: payment.error_reason ?? null,
      eventId: event.id ?? null,
    },
  })
}

interface RecordRefundProcessedArgs {
  db: DBOrTx
  refund: RefundEntity
  event: WebhookEvent
}

async function recordRefundProcessed(args: RecordRefundProcessedArgs): Promise<void> {
  const { db, refund, event } = args
  const amountRupees = (refund.amount / 100).toFixed(2)

  // M2 contract: record only. The wallet credit + booking state
  // transition fire from lib/payments/refund-flow.ts (Task 14) which
  // calls the SDK directly; the webhook is the Razorpay-side ack.
  await writeAuditLog(db, {
    actorUserId: null,
    action: 'webhook.refund.processed',
    entityType: 'refund',
    entityId: refund.id,
    payload: {
      razorpayRefundId: refund.id,
      razorpayPaymentId: refund.payment_id,
      amountRupees,
      status: refund.status,
      bookingId: extractBookingId(refund.notes) ?? null,
      eventId: event.id ?? null,
    },
  })
}
