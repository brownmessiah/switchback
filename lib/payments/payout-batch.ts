import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { payouts } from '@/db/schema/payouts'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { writeAuditLog } from '@/lib/audit/write'

import type { DBOrTx } from './commission-resolver'
import { resolveFundAccount } from './fund-account-resolver'
import {
  type EligiblePayoutInput,
  type PlannedBatch,
  planPayoutBatches,
} from './payout-batch-planner'
import {
  createPayout as realCreatePayout,
  type CreatePayoutInput,
  type CreatePayoutResult,
} from './razorpayx-client'

/**
 * Payout Batch cron worker per ADR-0016 (2026-06-18 amendment, D1+D3).
 *
 * Invoked once daily at 5pm IST by Vercel Cron through
 * `app/api/cron/payout-batch/route.ts`. Mirrors the db-injected,
 * stub-the-client discipline of `processPartialPayAutocapture`.
 *
 * Pipeline:
 *  1. SELECT every completed Booking with payout_batch_id IS NULL, joined to
 *     its experience (vendor + required permits), vendor profile (manual-
 *     approval state), and slot (multi-day detection).
 *  2. `planPayoutBatches` filters to the eligible, matured set and groups them
 *     into Payout Batches keyed on (vendor, destination, batchDay).
 *  3. For each planned Batch: `resolveFundAccount`.
 *      - admin_queue → audit `payout.batch_skipped` and CONTINUE (no payouts
 *        row, no Booking link — the Bookings stay unbatched so the admin queue
 *        surfaces them; provisioning is slice 03's eager path, never inline).
 *      - ok → INSERT a payouts row (status 'processing') with
 *        `onConflictDoNothing` on the unique (vendor, destination, batchDay)
 *        index, then SELECT the row. If it already carries a razorpayPayoutId
 *        the transfer was already sent on a prior (or overlapping) run — SKIP.
 *        Otherwise call the slice-02 createPayout, persist razorpayPayoutId,
 *        link the member Bookings (payout_batch_id), and audit `payout.batch_sent`.
 *
 * At-most-once: the unique index makes a double-INSERT a no-op; the
 * X-Payout-Idempotency header (= payouts.id) makes a double createPayout safe;
 * the razorpayPayoutId-present skip prevents a second transfer in-process.
 *
 * CRITICAL (ADR-0016, locked): this worker only READS manual_payouts_remaining
 * for the first-3 gate — it MUST NOT decrement it. The decrement happens only
 * on admin approve (slice 05); doing it here too would double-count.
 */

export interface ProcessPayoutBatchArgs {
  db: DBOrTx
  now?: Date
  batchDay?: string
  /** Injected for tests (a stub); production uses the slice-02 createPayout. */
  createPayout?: (input: CreatePayoutInput) => Promise<CreatePayoutResult>
}

export interface ProcessPayoutBatchResult {
  batchesPlanned: number
  sent: number
  skippedAdminQueue: number
  alreadySent: number
}

/** IST is UTC+5:30; the cron runs 5pm IST so the batch day is the IST date. */
const IST_OFFSET_MS = 5.5 * 3_600_000

function istBatchDay(now: Date): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS)
  // toISOString is UTC; we've already shifted into IST, so slice the date part.
  return ist.toISOString().slice(0, 10)
}

/** Two timestamps span more than one UTC calendar day. */
function isMultiDay(startAt: Date, endAt: Date): boolean {
  return startAt.toISOString().slice(0, 10) !== endAt.toISOString().slice(0, 10)
}

export async function processPayoutBatch(
  args: ProcessPayoutBatchArgs,
): Promise<ProcessPayoutBatchResult> {
  const {
    db,
    now = new Date(),
    batchDay = istBatchDay(now),
    createPayout = (input: CreatePayoutInput) => realCreatePayout(input),
  } = args

  // 1. Gather candidate Payouts: completed, not yet batched, with the joined
  //    facts the planner needs. Eligibility (maturity, approval gate) is the
  //    planner's job — we hand it everything it needs to decide.
  const candidates = await db
    .select({
      bookingId: bookings.id,
      vendorUserId: experiences.vendorUserId,
      completedAt: bookings.completedAt,
      requiredPermits: experiences.requiredPermits,
      slotStartAt: availabilitySlots.startAt,
      slotEndAt: availabilitySlots.endAt,
      payoutState: bookings.payoutState,
      manualPayoutsRemaining: vendorProfiles.manualPayoutsRemaining,
      payoutMethod: bookings.payoutMethodSnapshot,
      payoutDestinationSnapshot: bookings.payoutDestinationSnapshot,
      grossRupees: bookings.grossTotalSnapshot,
      commissionRatePercent: bookings.commissionRateSnapshot,
      gstRateOnCommissionPercent: bookings.gstRateOnCommissionSnapshot,
      tdsRupees: bookings.tdsAmountSnapshot,
      tcsRupees: bookings.tcsAmountSnapshot,
    })
    .from(bookings)
    .innerJoin(experiences, eq(experiences.id, bookings.experienceId))
    .innerJoin(vendorProfiles, eq(vendorProfiles.userId, experiences.vendorUserId))
    .innerJoin(availabilitySlots, eq(availabilitySlots.id, bookings.slotId))
    .where(and(eq(bookings.state, 'completed'), isNull(bookings.payoutBatchId)))

  const inputs: EligiblePayoutInput[] = candidates
    // A Booking without a payout destination snapshot can never be paid out;
    // it is held by the application layer until a destination is set (the
    // booking_payout_snapshot_consistency CHECK keeps method+destination in
    // lockstep). Skip defensively rather than fingerprinting a null.
    .filter((c) => c.payoutMethod !== null && c.payoutDestinationSnapshot !== null)
    .map((c) => ({
      bookingId: c.bookingId,
      vendorUserId: c.vendorUserId,
      completedAt: c.completedAt,
      permitRequired: (c.requiredPermits ?? []).length > 0,
      multiDay: isMultiDay(c.slotStartAt, c.slotEndAt),
      payoutState: c.payoutState as EligiblePayoutInput['payoutState'],
      vendorManualPayoutsRemaining: c.manualPayoutsRemaining,
      payoutMethod: c.payoutMethod as EligiblePayoutInput['payoutMethod'],
      payoutDestinationSnapshot: c.payoutDestinationSnapshot,
      grossRupees: Math.floor(Number(c.grossRupees)),
      commissionRatePercent: c.commissionRatePercent,
      gstRateOnCommissionPercent: c.gstRateOnCommissionPercent,
      tdsRupees: Math.floor(Number(c.tdsRupees)),
      tcsRupees: Math.floor(Number(c.tcsRupees)),
    }))

  const planned = planPayoutBatches({ payouts: inputs, now, batchDay })

  let sent = 0
  let skippedAdminQueue = 0
  let alreadySent = 0

  for (const batch of planned) {
    const outcome = await sendBatch({ db, batch, now, createPayout })
    if (outcome === 'sent') sent += 1
    else if (outcome === 'admin_queue') skippedAdminQueue += 1
    else alreadySent += 1
  }

  return {
    batchesPlanned: planned.length,
    sent,
    skippedAdminQueue,
    alreadySent,
  }
}

type SendBatchOutcome = 'sent' | 'admin_queue' | 'already_sent'

interface SendBatchArgs {
  db: DBOrTx
  batch: PlannedBatch
  now: Date
  createPayout: (input: CreatePayoutInput) => Promise<CreatePayoutResult>
}

async function sendBatch(args: SendBatchArgs): Promise<SendBatchOutcome> {
  const { db, batch, now, createPayout } = args

  const resolution = await resolveFundAccount(db, {
    vendorUserId: batch.vendorUserId,
    destinationFingerprint: batch.destinationFingerprint,
    now,
  })

  if (resolution.status === 'admin_queue') {
    // Drop to the admin queue: NO payouts row, NO Booking link. The Bookings
    // remain unbatched so a later run (or admin provisioning) re-surfaces them.
    await db.transaction(async (tx) => {
      await writeAuditLog(tx, {
        actorUserId: null,
        action: 'payout.batch_skipped',
        entityType: 'payout_batch',
        entityId: `${batch.vendorUserId}:${batch.destinationFingerprint}:${batch.batchDay}`,
        payload: {
          reason: resolution.reason,
          vendorUserId: batch.vendorUserId,
          destinationFingerprint: batch.destinationFingerprint,
          batchDay: batch.batchDay,
          memberBookingIds: batch.memberBookingIds,
        },
      })
    })
    return 'admin_queue'
  }

  const fundAccountId = resolution.fundAccountId

  // Reserve the Payout Batch row. onConflictDoNothing on the unique
  // (vendor, destination, batchDay) index makes a concurrent / repeat run a
  // no-op — we then re-SELECT to read whoever won the insert.
  await db
    .insert(payouts)
    .values({
      vendorUserId: batch.vendorUserId,
      destinationFingerprint: batch.destinationFingerprint,
      razorpayFundAccountId: fundAccountId,
      batchDay: batch.batchDay,
      status: 'processing',
      amountNetRupees: batch.amountNetRupees.toFixed(2),
      tdsTotal: batch.tdsTotal.toFixed(2),
      tcsTotal: batch.tcsTotal.toFixed(2),
    })
    .onConflictDoNothing({
      target: [payouts.vendorUserId, payouts.destinationFingerprint, payouts.batchDay],
    })

  const [row] = await db
    .select({ id: payouts.id, razorpayPayoutId: payouts.razorpayPayoutId })
    .from(payouts)
    .where(
      and(
        eq(payouts.vendorUserId, batch.vendorUserId),
        eq(payouts.destinationFingerprint, batch.destinationFingerprint),
        eq(payouts.batchDay, batch.batchDay),
      ),
    )
    .limit(1)

  // The row must exist (we just inserted-or-found it); guard for the type.
  if (!row) {
    throw new Error('payout-batch: payouts row not found after insert')
  }

  // Already sent on a prior / overlapping run — at-most-once.
  if (row.razorpayPayoutId !== null) {
    return 'already_sent'
  }

  // Send the single Razorpay X transfer for the summed net. The idempotency
  // header (= payouts.id) makes a repeat call safe even if a racing run got
  // here first; reference_id mirrors it for reconciliation.
  const payout = await createPayout({
    fundAccountId,
    amountRupees: batch.amountNetRupees,
    mode: batch.payoutMethod === 'upi' ? 'UPI' : 'IMPS',
    referenceId: row.id,
    idempotencyKey: row.id,
  })

  // Persist the transfer id, link the member Bookings, and audit — atomically.
  await db.transaction(async (tx) => {
    await tx
      .update(payouts)
      .set({ razorpayPayoutId: payout.payoutId, updatedAt: sql`now()` })
      .where(eq(payouts.id, row.id))
    await tx
      .update(bookings)
      .set({ payoutBatchId: row.id, payoutState: 'processing', updatedAt: sql`now()` })
      .where(inArray(bookings.id, batch.memberBookingIds))
    await writeAuditLog(tx, {
      actorUserId: null,
      action: 'payout.batch_sent',
      entityType: 'payout_batch',
      entityId: row.id,
      payload: {
        vendorUserId: batch.vendorUserId,
        destinationFingerprint: batch.destinationFingerprint,
        batchDay: batch.batchDay,
        razorpayPayoutId: payout.payoutId,
        amountNetRupees: batch.amountNetRupees,
        tdsTotal: batch.tdsTotal,
        tcsTotal: batch.tcsTotal,
        memberBookingIds: batch.memberBookingIds,
      },
    })
  })

  return 'sent'
}
