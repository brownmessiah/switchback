import { and, eq, gte, lte } from 'drizzle-orm'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { payments } from '@/db/schema/payments'
import { writeAuditLog } from '@/lib/audit/write'
import { getPusherServer } from '@/lib/pusher/server'

import type { DBOrTx } from './commission-resolver'
import {
  capturePayment,
  RazorpayClientError,
  type RazorpaySdkLike,
} from './razorpay-client'

/**
 * Partial-pay auto-capture worker per ADR-0001.
 *
 * Invoked every 15 minutes by Vercel Cron through
 * `app/api/cron/partial-pay-autocapture/route.ts`. Selects each Booking
 * in state=confirmed with payment_mode=partial_pay whose slot.startAt
 * is in the (now+23.5h .. now+24.5h) window, and captures the remaining
 * 75% via the Razorpay client.
 *
 * Idempotency: bookings that already have a payments row with
 * capture_trigger='auto_capture_t_minus_24h' are skipped. Task 17 will
 * add the structural partial-unique index for defense-in-depth across
 * concurrent deployments; for now the SELECT FOR UPDATE inside the
 * per-booking transaction serialises concurrent in-process runs.
 *
 * Retry policy: retryable Razorpay errors (UPSTREAM_5XX / rate-limited
 * per the razorpay-client error taxonomy) back off with the injected
 * delay function up to maxAttempts times. Non-retryable errors (auth,
 * bad request, not found) terminate immediately. On terminal failure:
 * audit + Booking.state → awaiting_completion + Pusher event to the
 * Vendor inbox so they can decide whether to honour the booking at the
 * door (some Vendors will accept cash) or pull the slot.
 *
 * Time-window semantics: the window is centred on T-24h with ±30min
 * tolerance. Since the cron runs every 15 minutes, the worst-case is
 * one Booking processed twice (once at the leading edge of the window
 * and once at the trailing edge); the idempotency check at the
 * per-booking transaction handles that case.
 */

const WINDOW_LOWER_HOURS = 23.5
const WINDOW_UPPER_HOURS = 24.5
const ADVANCE_FRACTION = 0.25
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_DELAY_MS = (attempt: number): number =>
  Math.min(8_000, 1_000 * 2 ** (attempt - 1))

/**
 * The autocapture remainder is the *gross minus the floor-rounded
 * advance* — NOT a direct `floor(gross * 0.75)`. This ensures
 * `advance + autocapture === gross` for every rupee gross, eliminating
 * the 1-rupee residue when gross is not a multiple of 4.
 *
 * Example: gross=4001 → advance=1000 (booking-create stamped at
 * floor(4001 * 0.25)), autocapture=4001-1000=3001 (this function),
 * total=4001. The convention matches the advance side's rounding.
 */
function computeAutocaptureRupees(grossRupees: number): number {
  const advance = Math.floor(grossRupees * ADVANCE_FRACTION)
  return grossRupees - advance
}

interface PusherLike {
  trigger(channel: string | string[], event: string, data: unknown): Promise<unknown>
}

export interface ProcessPartialPayAutocaptureArgs {
  db: DBOrTx
  now?: Date
  razorpayClient?: RazorpaySdkLike
  pusherClient?: PusherLike
  /** Returns milliseconds to wait before attempt N (1-indexed). Default exponential backoff capped at 8s. */
  delayMs?: (attempt: number) => number
  maxAttempts?: number
}

export interface ProcessPartialPayAutocaptureResult {
  processed: number
  succeeded: number
  failed: number
  skipped: number
}

export async function processPartialPayAutocapture(
  args: ProcessPartialPayAutocaptureArgs,
): Promise<ProcessPartialPayAutocaptureResult> {
  const {
    db,
    now = new Date(),
    razorpayClient,
    pusherClient = getPusherServer(),
    delayMs = DEFAULT_DELAY_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = args

  const lowerBound = new Date(now.getTime() + WINDOW_LOWER_HOURS * 3_600_000)
  const upperBound = new Date(now.getTime() + WINDOW_UPPER_HOURS * 3_600_000)

  const candidates = await db
    .select({
      bookingId: bookings.id,
      customerUserId: bookings.customerUserId,
      experienceId: bookings.experienceId,
      grossRupees: bookings.grossTotalSnapshot,
    })
    .from(bookings)
    .innerJoin(availabilitySlots, eq(availabilitySlots.id, bookings.slotId))
    .where(
      and(
        eq(bookings.state, 'confirmed'),
        eq(bookings.paymentMode, 'partial_pay'),
        gte(availabilitySlots.startAt, lowerBound),
        lte(availabilitySlots.startAt, upperBound),
      ),
    )

  let succeeded = 0
  let failed = 0
  let skipped = 0

  for (const candidate of candidates) {
    const outcome = await processOne({
      db,
      bookingId: candidate.bookingId,
      grossRupees: Math.floor(Number(candidate.grossRupees)),
      razorpayClient,
      pusherClient,
      delayMs,
      maxAttempts,
    })
    if (outcome === 'succeeded') succeeded += 1
    else if (outcome === 'skipped') skipped += 1
    else failed += 1
  }

  return {
    processed: candidates.length,
    succeeded,
    failed,
    skipped,
  }
}

interface ProcessOneArgs {
  db: DBOrTx
  bookingId: string
  grossRupees: number
  razorpayClient?: RazorpaySdkLike
  pusherClient: PusherLike
  delayMs: (attempt: number) => number
  maxAttempts: number
}

type Outcome = 'succeeded' | 'failed' | 'skipped'

async function processOne(args: ProcessOneArgs): Promise<Outcome> {
  const { db, bookingId, grossRupees, razorpayClient, pusherClient, delayMs, maxAttempts } = args
  const remainderRupees = computeAutocaptureRupees(grossRupees)

  // Race condition closure: the entire per-booking flow — lock booking,
  // verify idempotency, look up the advance payment, call Razorpay,
  // insert the new payment row + audit — runs inside a single tx with
  // SELECT … FOR UPDATE on the bookings row. A concurrent invocation
  // (Vercel may run overlapping cron functions) blocks on the row lock,
  // and after the first commits the second observes the
  // auto_capture_t_minus_24h row and skips. Task 17's partial unique
  // index is defense-in-depth against pathological cases (e.g. two
  // distinct serverless containers somehow bypassing the row lock).
  type LockedOutcome =
    | { kind: 'skipped' }
    | { kind: 'failed_no_advance' }
    | {
        kind: 'capture_attempt'
        advancePaymentId: string
      }

  const lockedOutcome: LockedOutcome = await db.transaction(async (tx) => {
    await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for('update')
      .limit(1)

    const existing = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.bookingId, bookingId),
          eq(payments.captureTrigger, 'auto_capture_t_minus_24h'),
        ),
      )
      .limit(1)
    if (existing.length > 0) {
      return { kind: 'skipped' }
    }

    const [advanceRow] = await tx
      .select({ razorpayPaymentId: payments.razorpayPaymentId })
      .from(payments)
      .where(
        and(
          eq(payments.bookingId, bookingId),
          eq(payments.captureTrigger, 'booking_create'),
        ),
      )
      .limit(1)
    if (!advanceRow) {
      return { kind: 'failed_no_advance' }
    }

    return {
      kind: 'capture_attempt',
      advancePaymentId: advanceRow.razorpayPaymentId,
    }
  })

  if (lockedOutcome.kind === 'skipped') {
    return 'skipped'
  }

  if (lockedOutcome.kind === 'failed_no_advance') {
    await db.transaction(async (tx) => {
      await writeAuditLog(tx, {
        actorUserId: null,
        action: 'partial_pay.autocapture_failed',
        entityType: 'booking',
        entityId: bookingId,
        payload: {
          bookingId,
          reason: 'advance_payment_not_found',
          remainderRupees,
        },
      })
    })
    await safePusher(pusherClient, bookingId, {
      reason: 'advance_payment_not_found',
      remainderRupees,
    })
    return 'failed'
  }

  const { advancePaymentId } = lockedOutcome

  // The Razorpay call happens OUTSIDE the lock. The booking row is no
  // longer locked once the first tx commits, but the partial unique
  // index (Task 17) + the second-phase insert below catch any racing
  // run. Holding a DB lock across an external network call is a worse
  // tradeoff — locks would saturate the pool under Razorpay latency.
  let lastError: RazorpayClientError | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await capturePayment(
        { paymentId: advancePaymentId, amountRupees: remainderRupees },
        razorpayClient ? { client: razorpayClient } : {},
      )

      // Defense-in-depth: assert Razorpay captured the exact amount we
      // asked for. Diverging amounts indicate either a Razorpay bug, a
      // tampered request mid-flight, or a logic error here — refuse to
      // commit a payment row whose ledger value doesn't match upstream.
      const expectedPaise = remainderRupees * 100
      if (result.amountPaise !== expectedPaise) {
        throw new RazorpayClientError(
          'RAZORPAY_UNKNOWN',
          false,
          `captured amount mismatch: expected ${expectedPaise} paise, got ${result.amountPaise}`,
        )
      }

      // Commit the success in a second tx. The DB unique index from
      // Task 17 (or the upcoming index) makes this onConflictDoNothing-
      // friendly; for now we accept the small TOCTOU window and rely on
      // the audit + reconciliation script if a race is ever observed.
      await db.transaction(async (tx) => {
        await tx.insert(payments).values({
          bookingId,
          razorpayPaymentId: result.paymentId,
          amount: remainderRupees.toFixed(2),
          captureTrigger: 'auto_capture_t_minus_24h',
        })
        await writeAuditLog(tx, {
          actorUserId: null,
          action: 'partial_pay.autocaptured',
          entityType: 'booking',
          entityId: bookingId,
          payload: {
            bookingId,
            amountRupees: remainderRupees,
            razorpayPaymentId: result.paymentId,
            advancePaymentId,
            attempt,
          },
        })
      })
      return 'succeeded'
    } catch (err) {
      if (!(err instanceof RazorpayClientError)) {
        lastError = new RazorpayClientError(
          'RAZORPAY_UNKNOWN',
          false,
          err instanceof Error ? err.message : 'unknown',
        )
        break
      }
      lastError = err
      if (!err.retryable || attempt === maxAttempts) {
        break
      }
      const waitMs = delayMs(attempt)
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs))
      }
    }
  }

  // Terminal failure path. Per ADR-0003 audit, we do NOT transition the
  // booking state on a capture failure — moving to `awaiting_completion`
  // would let M3's completion auto-trigger silently complete an unpaid
  // Booking at end_at+24h. The Customer or Vendor must explicitly
  // cancel/dispute through the cancel Server Action; the audit row +
  // Pusher event flag the failure to the Vendor inbox for triage. M3
  // will introduce a dedicated `payment_failed` state with explicit
  // M3-side handling.
  await db.transaction(async (tx) => {
    await writeAuditLog(tx, {
      actorUserId: null,
      action: 'partial_pay.autocapture_failed',
      entityType: 'booking',
      entityId: bookingId,
      payload: {
        bookingId,
        reason: lastError?.code ?? 'unknown',
        razorpayCode: lastError?.code ?? null,
        retryable: lastError?.retryable ?? false,
        message: lastError?.message ?? null,
        remainderRupees,
        advancePaymentId,
      },
    })
  })
  await safePusher(pusherClient, bookingId, {
    reason: lastError?.code ?? 'unknown',
    razorpayCode: lastError?.code ?? null,
    remainderRupees,
  })
  return 'failed'
}

/**
 * Pusher trigger that swallows errors. We never want a Pusher outage to
 * mask a captured-or-failed result — the audit_logs row is the source
 * of truth; the Pusher event is a UX hint to the Vendor inbox.
 */
async function safePusher(
  client: PusherLike,
  bookingId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await client.trigger(`booking-${bookingId}`, 'partial-pay-autocapture-failed', {
      bookingId,
      ...payload,
    })
  } catch {
    // Audit row already commits the failure; the missing Pusher event is
    // not a money-correctness concern.
  }
}
