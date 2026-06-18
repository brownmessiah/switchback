import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'

import { bookings } from '@/db/schema/bookings'
import { payouts } from '@/db/schema/payouts'
import { writeAuditLog } from '@/lib/audit/write'
import { notifyPayoutStateChange, safeNotify } from '@/lib/notifications/booking-events'
import { getRedis } from '@/lib/redis'

import type { DBOrTx } from './commission-resolver'
import { verifyWebhookSignature } from './razorpay-signature'

/**
 * Razorpay X payout webhook handler — idempotent ingestion of
 * `payout.processed` per ADR-0016 (2026-06-18 amendment, D4).
 *
 * The X trust boundary is DISTINCT from the PG (collection) one: this handler
 *   - verifies against `RAZORPAYX_WEBHOOK_SECRET`, NOT the PG webhook secret;
 *   - dedups in a SEPARATE Redis namespace (`razorpayx-event:`) so a PG event
 *     id and an X event id can never collide.
 *
 * Idempotency is layered:
 *   1. Upstash Redis dedup on the X event id (14-day TTL). Fast path — 99% of
 *      replays short-circuit before any DB work.
 *   2. DB-level guard: the `payouts.status='paid'` UPDATE is conditioned on
 *      `status <> 'paid'` and uses .returning(); a replay that slips past Redis
 *      (TTL eviction inside Razorpay's retry window) finds the row already paid,
 *      transitions nothing, and skips the audit + notify side-effects. The
 *      1000x replay test proves exactly ONE transition + ONE audit + ONE notify
 *      per member Booking.
 *
 * Status code policy (mirrors razorpay-webhook.ts):
 *   - Missing secret           → 500 (operator-correctable; Razorpay retries)
 *   - Invalid signature        → 401 (adversarial / misconfigured caller)
 *   - Malformed JSON / payload → 400 (do not retry — structural bug upstream)
 *   - Missing event id         → 400
 *   - Unknown event type       → 200 ignored (ack, no work)
 *   - Duplicate event id       → 200 deduped
 *   - Unmatched reference      → 200 acked (a retry won't fix an unmatched ref)
 *   - Success                  → 200
 *   - Internal DB error        → clear dedup key + 500 (retry)
 *
 * Events handled here: `payout.processed` (→ paid + cascade + notify) and the
 * benign lifecycle acks `payout.initiated` / `payout.queued` (ack/ignore).
 * `payout.failed` / `payout.reversed` are admin-gated and land in slice 07.
 */

const DEDUP_TTL_SECONDS = 14 * 24 * 60 * 60

const PayoutEntitySchema = z.object({
  id: z.string().min(1),
  entity: z.string().optional(),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  status: z.string(),
  reference_id: z.string().nullable().optional(),
  notes: z.record(z.string(), z.unknown()).optional(),
})

const WebhookEventSchema = z.object({
  entity: z.literal('event'),
  event: z.string().min(1),
  id: z.string().optional(),
  contains: z.array(z.string()).optional(),
  payload: z
    .object({
      payout: z.object({ entity: PayoutEntitySchema }).optional(),
    })
    .passthrough(),
  created_at: z.number().optional(),
})

type WebhookEvent = z.infer<typeof WebhookEventSchema>
type PayoutEntity = z.infer<typeof PayoutEntitySchema>

export interface ProcessRazorpayXWebhookArgs {
  db: DBOrTx
  body: string
  signature: string
  /** Value of the `X-Razorpay-Event-Id` header, or null/undefined if absent. */
  eventIdHeader: string | null | undefined
  secret: string
}

export interface RazorpayXWebhookResult {
  status: 200 | 400 | 401 | 500
  body: Record<string, unknown>
  /** True iff Redis dedup short-circuited the request. */
  deduped?: boolean
  /** True iff the event type was not one we handle. */
  ignored?: boolean
  /** True iff no `payouts` row reconciled to the event (acked, not retried). */
  unmatched?: boolean
}

/** Lifecycle events we explicitly ack without side-effects. */
const ACK_ONLY_EVENTS = new Set(['payout.initiated', 'payout.queued'])

export async function processRazorpayXWebhook(
  args: ProcessRazorpayXWebhookArgs,
): Promise<RazorpayXWebhookResult> {
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
  // SEPARATE namespace from the PG webhook so a PG event id and an X event id
  // can never collide.
  const dedupKey = `razorpayx-event:${eventId}`
  const seen = await redis.get(dedupKey)
  if (seen) {
    return { status: 200, body: { ok: true, deduped: true }, deduped: true }
  }

  // Set the dedup key BEFORE doing DB work so concurrent retries within the
  // 14-day window also short-circuit. The DB `status <> 'paid'` guard is the
  // structural floor if Redis evicts the key before all retries land.
  await redis.set(dedupKey, '1', { ex: DEDUP_TTL_SECONDS })

  if (ACK_ONLY_EVENTS.has(event.event)) {
    return { status: 200, body: { ok: true, ignored: event.event }, ignored: true }
  }

  if (event.event !== 'payout.processed') {
    return {
      status: 200,
      body: { ok: true, ignored: event.event },
      ignored: true,
    }
  }

  const payout = event.payload.payout?.entity
  if (!payout) {
    return { status: 400, body: { error: 'payout.processed missing payload.payout' } }
  }

  try {
    return await handlePayoutProcessed({ db, payout, event, eventId })
  } catch {
    // Clear the dedup key so Razorpay's retry policy can land the transition on
    // a transient DB / network blip. Without this, the next retry would see the
    // key, return 200 deduped, and the Payout Batch would stay `processing`.
    try {
      await redis.del(dedupKey)
    } catch {
      // If Redis itself is the failure mode, swallowing the secondary error is
      // fine — the primary 500 still flows back.
    }
    // Do NOT echo the internal error message back to Razorpay — DB / Drizzle
    // messages leak schema details into Razorpay's dashboard logs.
    return {
      status: 500,
      body: { error: 'internal error processing webhook' },
    }
  }
}

interface HandlePayoutProcessedArgs {
  db: DBOrTx
  payout: PayoutEntity
  event: WebhookEvent
  eventId: string
}

async function handlePayoutProcessed(
  args: HandlePayoutProcessedArgs,
): Promise<RazorpayXWebhookResult> {
  const { db, payout, event, eventId } = args

  const payoutRowId = await reconcilePayoutRowId({ db, payout })
  if (!payoutRowId) {
    // No `payouts` row reconciled — ack (200) so Razorpay stops retrying; a
    // retry can't fix an unmatched reference. Record an audit trail for ops.
    await writeAuditLog(db, {
      actorUserId: null,
      action: 'payout.webhook_unmatched',
      entityType: 'payout_batch',
      entityId: payout.id,
      payload: {
        razorpayPayoutId: payout.id,
        referenceId: payout.reference_id ?? null,
        notesPayoutId: extractNotesPayoutId(payout.notes),
        eventId,
      },
    })
    return { status: 200, body: { ok: true, unmatched: true }, unmatched: true }
  }

  // Transition + cascade + audit atomically. The `status <> 'paid'` guard makes
  // a replay (past Redis) a no-op: .returning() comes back empty, so we skip the
  // audit + notify and report deduped.
  const transitioned = await db.transaction(async (tx) => {
    const updated = await tx
      .update(payouts)
      .set({ status: 'paid' })
      .where(and(eq(payouts.id, payoutRowId), ne(payouts.status, 'paid')))
      .returning({ id: payouts.id, vendorUserId: payouts.vendorUserId })

    if (updated.length === 0) {
      // Already paid — idempotent no-op. Skip the cascade + side-effects.
      return null
    }

    // Cascade member Bookings → payout_state='paid'. Safe to apply twice
    // (paid → paid is a no-op); the side-effect skip above means this only runs
    // on the real transition.
    await tx
      .update(bookings)
      .set({ payoutState: 'paid' })
      .where(eq(bookings.payoutBatchId, payoutRowId))

    await writeAuditLog(tx, {
      actorUserId: null,
      action: 'payout.webhook_processed',
      entityType: 'payout_batch',
      entityId: payoutRowId,
      payload: {
        razorpayPayoutId: payout.id,
        referenceId: payout.reference_id ?? null,
        amountRupees: (payout.amount / 100).toFixed(2),
        status: payout.status,
        eventId,
      },
    })

    return { vendorUserId: updated[0]!.vendorUserId }
  })

  if (!transitioned) {
    return { status: 200, body: { ok: true, deduped: true }, deduped: true }
  }

  // Notify the Vendor per member Booking AFTER commit — a notify failure must
  // never fail the money path. The per-(booking,state) eventId keeps notifies
  // idempotent if this event somehow re-runs.
  const memberBookings = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.payoutBatchId, payoutRowId))

  for (const member of memberBookings) {
    await safeNotify('payout.processed', () =>
      notifyPayoutStateChange(db, {
        bookingId: member.id,
        vendorUserId: transitioned.vendorUserId,
        state: 'paid',
      }),
    )
  }

  return { status: 200, body: { ok: true } }
}

/**
 * Reconcile the Razorpay X payout entity back to our `payouts` row id.
 *
 * Slice 04 called createPayout({ referenceId: payouts.id, ... }), so the X
 * payout's `reference_id` === our `payouts.id`. Order (per slice spec):
 *   1. `reference_id` → direct PK lookup (primary path).
 *   2. `notes.payout_id` if present → PK lookup (fallback).
 *   3. match `payouts.razorpayPayoutId === payout.entity.id` (fallback).
 * Returns null if nothing matches.
 */
async function reconcilePayoutRowId(args: {
  db: DBOrTx
  payout: PayoutEntity
}): Promise<string | null> {
  const { db, payout } = args

  // 1. reference_id → payouts.id (direct PK lookup).
  const referenceId = payout.reference_id
  if (typeof referenceId === 'string' && referenceId.length > 0) {
    const byRef = await lookupById(db, referenceId)
    if (byRef) return byRef
  }

  // 2. notes.payout_id → payouts.id.
  const notesPayoutId = extractNotesPayoutId(payout.notes)
  if (notesPayoutId) {
    const byNotes = await lookupById(db, notesPayoutId)
    if (byNotes) return byNotes
  }

  // 3. payouts.razorpay_payout_id === payout.entity.id.
  const [byPayoutId] = await db
    .select({ id: payouts.id })
    .from(payouts)
    .where(eq(payouts.razorpayPayoutId, payout.id))
    .limit(1)
  if (byPayoutId) return byPayoutId.id

  return null
}

/** PK lookup that tolerates a non-uuid candidate (returns null, never throws). */
async function lookupById(db: DBOrTx, candidate: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ id: payouts.id })
      .from(payouts)
      .where(eq(payouts.id, candidate))
      .limit(1)
    return row?.id ?? null
  } catch {
    // A non-uuid reference_id makes Postgres reject the uuid comparison. Treat
    // it as "no match" and fall through to the next reconciliation strategy.
    return null
  }
}

function extractNotesPayoutId(notes: Record<string, unknown> | undefined): string | null {
  if (!notes) return null
  const raw = notes.payout_id
  if (typeof raw === 'string' && raw.length > 0) return raw
  return null
}
