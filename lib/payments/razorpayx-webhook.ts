import { and, count, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'

import { bookings } from '@/db/schema/bookings'
import { payouts } from '@/db/schema/payouts'
import { writeAuditLog } from '@/lib/audit/write'
import { notifyPayoutStateChange, safeNotify } from '@/lib/notifications/booking-events'
import { getRedis } from '@/lib/redis'

import type { DBOrTx } from './commission-resolver'
import { decidePayoutRetry } from './payout-retry-policy'
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
 * Events handled here:
 *   - `payout.processed` → paid + cascade + notify (slice 06).
 *   - `payout.failed` → mark failed, decide retry vs admin queue per
 *     ADR-0016 D5 (decidePayoutRetry): retry (≤3) re-queues member Bookings
 *     (pending + clear batch link → next cron re-picks); exhausted (≥4) routes
 *     to the admin queue (failed + keep batch link) + notifies the Vendor.
 *   - `payout.reversed` → the DANGEROUS path: money returned after `processed`.
 *     Mark reversed, revert member Bookings from paid, KEEP the batch link
 *     (admin-gated — NEVER auto-retransfer), always notify the Vendor.
 *   - benign lifecycle acks `payout.initiated` / `payout.queued` (ack/ignore).
 *
 * Idempotency for the slice-07 events is a GUARDED status transition:
 *   - failed:   `status='processing' → 'failed'` (RETURNING gates side-effects).
 *   - reversed: `status='paid' → 'reversed'` (RETURNING gates side-effects).
 * A replay past Redis finds 0 rows transitioned and skips every side-effect.
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
  /** Razorpay X failure/reversal detail (best-effort — shape varies). */
  status_details: z.record(z.string(), z.unknown()).nullable().optional(),
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

/** Events that drive a state transition + cascade + audit + (maybe) notify. */
const HANDLED_EVENTS = new Set(['payout.processed', 'payout.failed', 'payout.reversed'])

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

  if (!HANDLED_EVENTS.has(event.event)) {
    return {
      status: 200,
      body: { ok: true, ignored: event.event },
      ignored: true,
    }
  }

  const payout = event.payload.payout?.entity
  if (!payout) {
    return { status: 400, body: { error: `${event.event} missing payload.payout` } }
  }

  try {
    switch (event.event) {
      case 'payout.failed':
        return await handlePayoutFailed({ db, payout, eventId })
      case 'payout.reversed':
        return await handlePayoutReversed({ db, payout, eventId })
      default:
        return await handlePayoutProcessed({ db, payout, event, eventId })
    }
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

interface HandlePayoutFailedArgs {
  db: DBOrTx
  payout: PayoutEntity
  eventId: string
}

/**
 * Handle `payout.failed` per ADR-0016 D5.
 *
 * GUARDED transition `status='processing' → 'failed'`. Only on a REAL transition
 * (RETURNING non-empty) do we count failed attempts for the group, decide via
 * the pure `decidePayoutRetry`, and apply the booking reverts + audit:
 *   - retry (failureCount ≤ 3): member Bookings → `pending`, clear
 *     `payout_batch_id` → the next daily cron re-picks them (a NEW payouts row,
 *     new batch_day). Transient — the Vendor is NOT notified.
 *   - admin_queue (failureCount ≥ 4): member Bookings → `failed`, KEEP
 *     `payout_batch_id` → the cron does NOT re-pick; slice-05's classifier shows
 *     category 'failed' to the Admin. The Vendor IS notified (state 'failed').
 *
 * failureCount = COUNT(payouts WHERE vendor + destination AND status='failed'),
 * read AFTER marking the current row failed so it includes the current failure.
 */
async function handlePayoutFailed(
  args: HandlePayoutFailedArgs,
): Promise<RazorpayXWebhookResult> {
  const { db, payout, eventId } = args

  const payoutRowId = await reconcilePayoutRowId({ db, payout })
  if (!payoutRowId) {
    await writeUnmatchedAudit({ db, payout, eventId })
    return { status: 200, body: { ok: true, unmatched: true }, unmatched: true }
  }

  const failureReason = extractFailureReason(payout)

  const outcome = await db.transaction(async (tx) => {
    // GUARDED transition: only `processing` → `failed` is a real failure. A
    // replay (past Redis) finds status already `failed` → 0 rows → skip
    // everything (no re-revert, no re-notify, no double attemptCount).
    const updated = await tx
      .update(payouts)
      .set({
        status: 'failed',
        failureReason,
        attemptCount: sql`${payouts.attemptCount} + 1`,
      })
      .where(and(eq(payouts.id, payoutRowId), eq(payouts.status, 'processing')))
      .returning({
        id: payouts.id,
        vendorUserId: payouts.vendorUserId,
        destinationFingerprint: payouts.destinationFingerprint,
      })

    if (updated.length === 0) {
      return null
    }
    const { vendorUserId, destinationFingerprint } = updated[0]!

    // failureCount = total failed attempts for the (vendor, destination) group,
    // now including the row we just marked failed.
    const [countRow] = await tx
      .select({ failedCount: count() })
      .from(payouts)
      .where(
        and(
          eq(payouts.vendorUserId, vendorUserId),
          eq(payouts.destinationFingerprint, destinationFingerprint),
          eq(payouts.status, 'failed'),
        ),
      )
    const failureCount = countRow!.failedCount

    const decision = decidePayoutRetry({ failureCount })

    if (decision.action === 'retry') {
      // Re-queue: pending + clear the batch link → next cron re-picks them.
      await tx
        .update(bookings)
        .set({ payoutState: 'pending', payoutBatchId: null })
        .where(eq(bookings.payoutBatchId, payoutRowId))
    } else {
      // Retries exhausted → route to admin queue: failed + KEEP the batch link.
      await tx
        .update(bookings)
        .set({ payoutState: 'failed' })
        .where(eq(bookings.payoutBatchId, payoutRowId))
    }

    await writeAuditLog(tx, {
      actorUserId: null,
      action: 'payout.webhook_failed',
      entityType: 'payout_batch',
      entityId: payoutRowId,
      payload: {
        razorpayPayoutId: payout.id,
        referenceId: payout.reference_id ?? null,
        reason: failureReason,
        failureCount,
        decision: decision.action,
        ...(decision.action === 'retry' ? { backoffMs: decision.backoffMs } : {}),
        eventId,
      },
    })

    return { vendorUserId, decision: decision.action }
  })

  if (!outcome) {
    return { status: 200, body: { ok: true, deduped: true }, deduped: true }
  }

  // Only notify the Vendor when retries are exhausted (admin queue). A retry is
  // transient + re-queued silently — notifying would cry wolf, and the per-
  // (booking,state) eventId would suppress the LATER exhaustion notify.
  if (outcome.decision === 'admin_queue') {
    await notifyVendorPerMemberBooking({
      db,
      payoutRowId,
      vendorUserId: outcome.vendorUserId,
      state: 'failed',
      label: 'payout.failed',
    })
  }

  return { status: 200, body: { ok: true } }
}

interface HandlePayoutReversedArgs {
  db: DBOrTx
  payout: PayoutEntity
  eventId: string
}

/**
 * Handle `payout.reversed` per ADR-0016 D5 — THE DANGEROUS PATH.
 *
 * Money returned after the transfer was `processed` (bad beneficiary). GUARDED
 * transition `status='paid' → 'reversed'` (reversal is only valid from paid).
 * On a real transition: revert member Bookings from `paid` → `reversed` and
 * KEEP `payout_batch_id` so the cron NEVER re-picks them. We NEVER call
 * createPayout / re-send — re-pay is ADMIN-GATED. Surface loudly: always notify
 * the Vendor (state 'reversed').
 */
async function handlePayoutReversed(
  args: HandlePayoutReversedArgs,
): Promise<RazorpayXWebhookResult> {
  const { db, payout, eventId } = args

  const payoutRowId = await reconcilePayoutRowId({ db, payout })
  if (!payoutRowId) {
    await writeUnmatchedAudit({ db, payout, eventId })
    return { status: 200, body: { ok: true, unmatched: true }, unmatched: true }
  }

  const failureReason = extractFailureReason(payout) ?? 'payout reversed'

  const transitioned = await db.transaction(async (tx) => {
    // GUARDED transition: reversal is only valid from `paid`. A replay (or a
    // reversal of a non-paid batch) finds 0 rows → skip ALL side-effects.
    const updated = await tx
      .update(payouts)
      .set({ status: 'reversed', failureReason })
      .where(and(eq(payouts.id, payoutRowId), eq(payouts.status, 'paid')))
      .returning({ id: payouts.id, vendorUserId: payouts.vendorUserId })

    if (updated.length === 0) {
      return null
    }

    // Revert member Bookings from paid → reversed. KEEP the batch link — this is
    // admin-gated and must NOT re-enter the cron's candidate set.
    await tx
      .update(bookings)
      .set({ payoutState: 'reversed' })
      .where(eq(bookings.payoutBatchId, payoutRowId))

    await writeAuditLog(tx, {
      actorUserId: null,
      action: 'payout.webhook_reversed',
      entityType: 'payout_batch',
      entityId: payoutRowId,
      payload: {
        razorpayPayoutId: payout.id,
        referenceId: payout.reference_id ?? null,
        reason: failureReason,
        eventId,
      },
    })

    return { vendorUserId: updated[0]!.vendorUserId }
  })

  if (!transitioned) {
    return { status: 200, body: { ok: true, deduped: true }, deduped: true }
  }

  // ALWAYS notify the Vendor — reversal is loud + admin-gated. NEVER re-send.
  await notifyVendorPerMemberBooking({
    db,
    payoutRowId,
    vendorUserId: transitioned.vendorUserId,
    state: 'reversed',
    label: 'payout.reversed',
  })

  return { status: 200, body: { ok: true } }
}

/**
 * Notify the Vendor once per member Booking AFTER commit. A notify failure must
 * never fail the money path (safeNotify), and the per-(booking,state) eventId
 * keeps it idempotent across replays.
 */
async function notifyVendorPerMemberBooking(args: {
  db: DBOrTx
  payoutRowId: string
  vendorUserId: string
  state: 'failed' | 'reversed'
  label: string
}): Promise<void> {
  const { db, payoutRowId, vendorUserId, state, label } = args
  const memberBookings = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.payoutBatchId, payoutRowId))

  for (const member of memberBookings) {
    await safeNotify(label, () =>
      notifyPayoutStateChange(db, {
        bookingId: member.id,
        vendorUserId,
        state,
      }),
    )
  }
}

/** Append the standard unmatched-reference audit row + ack (200). */
async function writeUnmatchedAudit(args: {
  db: DBOrTx
  payout: PayoutEntity
  eventId: string
}): Promise<void> {
  const { db, payout, eventId } = args
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
}

/**
 * Best-effort failure/reversal reason from the X payout entity. Shape varies
 * across X versions, so we read `status_details.reason` / `.description` and
 * fall back to the entity `status`. Returns null only when nothing is present.
 */
function extractFailureReason(payout: PayoutEntity): string | null {
  const details = payout.status_details
  if (details) {
    const reason = details.reason
    if (typeof reason === 'string' && reason.length > 0) return reason
    const description = details.description
    if (typeof description === 'string' && description.length > 0) return description
  }
  return payout.status || null
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
