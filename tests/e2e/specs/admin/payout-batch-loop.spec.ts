/**
 * E2E — Razorpay X vendor-payout SEND loop (slices 04 + 06 + 07, ADR-0016
 * 2026-06-18 amendment).
 *
 * Exercises the full send path against the live dev server + switchback_e2e DB +
 * the deterministic Razorpay X demo stub (RAZORPAY_TEST_MODE=true):
 *
 *   cron auth → cron sends a Payout Batch → at-most-once → webhook processed →
 *   webhook replay deduped → webhook failed (re-queue) → webhook reversed
 *   (admin-gated).
 *
 * API-level (the Playwright `request` fixture) because every effect is a DB +
 * route contract, not a UI surface — no page selectors, no a11y. Uses
 * `test.describe.serial` so the loop steps share the staged + sent state.
 *
 * Staging (beforeAll): the seed's dedicated payout vendor (`u_seed_v_payout`)
 * has six completed + matured pending-payout Bookings but NO payout snapshot and
 * NO vendor_fund_accounts row (created at runtime). For each chosen Booking we
 *   1. set a known payout_destination_snapshot + method (so the cron's candidate
 *      filter keeps it and the planner can fingerprint the destination),
 *   2. insert the matching vendor_fund_accounts row (coolingOffUntil in the PAST
 *      → resolver returns ok), and
 *   3. open the first-3 gate (manual_payouts_remaining=0) so a `pending` Payout
 *      is batch-eligible.
 *
 * Each `pnpm e2e` invocation resets + reseeds switchback_e2e via globalSetup, so no
 * cross-run state persists — all staging happens in this run's beforeAll.
 */

import { expect, test } from '@playwright/test'

import { destinationFingerprint } from '@/lib/payments/payout-destination'

import {
  countPayoutBatchAuditRows,
  countPayoutBatchesForKey,
  getBookingPayoutBatchId,
  getBookingPayoutState,
  getPayoutBatchById,
  getPayoutBatchMemberBookings,
  getPayoutBatchesForVendor,
  getUnbatchedCompletedBookingsForVendor,
  insertVendorFundAccount,
  setBookingPayoutSnapshot,
  setBookingPayoutStateForTest,
  setVendorManualPayoutsRemaining,
} from '../../helpers/db-assertions'

const PAYOUT_VENDOR = 'u_seed_v_payout'
const CRON_SECRET = 'e2e-cron-secret'

// A known UPI destination we both snapshot onto the Bookings AND provision a
// fund account for, so `destinationFingerprint(snapshot)` matches the resolver's
// row. One destination → one (vendor, destination) group → one Payout Batch.
const STAGED_DESTINATION = { vpa: 'apex-batch-loop@upi' } as const
const STAGED_FINGERPRINT = destinationFingerprint(STAGED_DESTINATION)
const STAGED_FUND_ACCOUNT_ID = 'fa_e2e_batch_loop'

// A DISTINCT destination for the failure scenario. The at-most-once guard keys a
// Payout Batch on (vendor, destination, batchDay), so a fresh batch on the SAME
// day requires a DIFFERENT destination (different fingerprint → different group)
// — otherwise the cron re-finds the primary batch and links nothing.
const FAIL_DESTINATION = { vpa: 'apex-batch-loop-fail@upi' } as const
const FAIL_FINGERPRINT = destinationFingerprint(FAIL_DESTINATION)
const FAIL_FUND_ACCOUNT_ID = 'fa_e2e_batch_loop_fail'

/** A Date safely in the PAST so the fund-account resolver returns `ok`. */
const COOLED_OFF = new Date(Date.now() - 24 * 60 * 60 * 1000)

interface WebhookPayload {
  event: 'payout.processed' | 'payout.failed' | 'payout.reversed'
  referenceId: string
  payoutId?: string
  amountPaise?: number
  status?: string
}

function webhookBody(p: WebhookPayload): string {
  return JSON.stringify({
    entity: 'event',
    event: p.event,
    payload: {
      payout: {
        entity: {
          id: p.payoutId ?? `pout_demo_e2e_${Date.now()}`,
          entity: 'payout',
          amount: p.amountPaise ?? 0,
          currency: 'INR',
          status: p.status ?? p.event.split('.')[1],
          reference_id: p.referenceId,
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  })
}

test.describe.serial('Razorpay X payout-batch send loop (slices 04/06/07)', () => {
  // Two staged Bookings: one drives the primary processed→reversed scenarios on
  // a batch sent against the staged destination; a second feeds a fresh batch
  // for the failed→re-queue scenario (kept on a separate batchDay-equivalent
  // staging path to avoid sharing one batch across processed + failed).
  let stagedBookingIds: string[] = []

  test.beforeAll(async () => {
    const candidates = await getUnbatchedCompletedBookingsForVendor(PAYOUT_VENDOR)
    expect(
      candidates.length,
      'seed must provide unbatched completed Bookings for the payout vendor',
    ).toBeGreaterThanOrEqual(2)

    // Open the first-3 gate so `pending` Payouts are batch-eligible (the planner
    // batches pending only when manual_payouts_remaining === 0).
    await setVendorManualPayoutsRemaining(PAYOUT_VENDOR, 0)

    // Provision the fund accounts both staged destinations resolve to.
    await insertVendorFundAccount({
      vendorUserId: PAYOUT_VENDOR,
      destinationFingerprint: STAGED_FINGERPRINT,
      razorpayFundAccountId: STAGED_FUND_ACCOUNT_ID,
      coolingOffUntil: COOLED_OFF,
    })
    await insertVendorFundAccount({
      vendorUserId: PAYOUT_VENDOR,
      destinationFingerprint: FAIL_FINGERPRINT,
      razorpayFundAccountId: FAIL_FUND_ACCOUNT_ID,
      coolingOffUntil: COOLED_OFF,
    })

    // Stage the first two Bookings onto the known destination + a clean pending
    // state (the prior admin-flows run may have left some approved/held/rejected;
    // we reset to pending — eligible via the open gate).
    stagedBookingIds = candidates.slice(0, 2).map((c) => c.bookingId)
    for (const bookingId of stagedBookingIds) {
      await setBookingPayoutStateForTest(bookingId, 'pending')
      await setBookingPayoutSnapshot({
        bookingId,
        payoutMethod: 'upi',
        payoutDestination: STAGED_DESTINATION,
      })
    }
  })

  // Captured across the serial steps.
  let primaryPayoutId = ''
  let primaryBatchDay = ''

  test('cron auth: 401 without / with a wrong bearer', async ({ request }) => {
    const noAuth = await request.post('/api/cron/payout-batch')
    expect(noAuth.status()).toBe(401)

    const wrong = await request.post('/api/cron/payout-batch', {
      headers: { authorization: 'Bearer wrong' },
    })
    expect(wrong.status()).toBe(401)
  })

  test('cron sends a Payout Batch: payouts row processing + bookings linked', async ({
    request,
  }) => {
    const res = await request.post('/api/cron/payout-batch', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { batchesPlanned: number; sent: number }
    expect(body.sent).toBeGreaterThanOrEqual(1)

    // One (vendor, destination) group → one Payout Batch carrying both members.
    const batches = await getPayoutBatchesForVendor(PAYOUT_VENDOR)
    const batch = batches.find((b) => b.destinationFingerprint === STAGED_FINGERPRINT)
    expect(batch, 'a Payout Batch for the staged destination must exist').toBeTruthy()
    expect(['processing', 'paid']).toContain(batch!.status)
    // The transfer was sent → a Razorpay X demo payout id is persisted.
    expect(batch!.razorpayPayoutId).toMatch(/^pout_demo_/)
    expect(batch!.amountNetRupees).toBeGreaterThan(0)

    primaryPayoutId = batch!.id
    primaryBatchDay = batch!.batchDay

    // The staged Bookings are now linked + advanced to processing.
    for (const bookingId of stagedBookingIds) {
      expect(await getBookingPayoutBatchId(bookingId)).toBe(primaryPayoutId)
      const state = await getBookingPayoutState(bookingId)
      expect(state?.payoutState).toBe('processing')
    }
  })

  test('at-most-once: a second cron run adds no payouts row for the same key', async ({
    request,
  }) => {
    const before = await countPayoutBatchesForKey({
      vendorUserId: PAYOUT_VENDOR,
      destinationFingerprint: STAGED_FINGERPRINT,
      batchDay: primaryBatchDay,
    })
    expect(before).toBe(1)

    const res = await request.post('/api/cron/payout-batch', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
    expect(res.status()).toBe(200)

    const after = await countPayoutBatchesForKey({
      vendorUserId: PAYOUT_VENDOR,
      destinationFingerprint: STAGED_FINGERPRINT,
      batchDay: primaryBatchDay,
    })
    expect(after).toBe(1)
  })

  test('webhook processed → batch paid + member bookings paid', async ({ request }) => {
    const res = await request.post('/api/webhooks/razorpayx', {
      headers: {
        'x-razorpay-signature': 'e2e-test-mode-bypass',
        'x-razorpay-event-id': `evt_processed_${Date.now()}`,
        'content-type': 'application/json',
      },
      data: webhookBody({
        event: 'payout.processed',
        referenceId: primaryPayoutId,
        amountPaise: 1_000_00,
        status: 'processed',
      }),
    })
    expect(res.status()).toBe(200)

    const batch = await getPayoutBatchById(primaryPayoutId)
    expect(batch?.status).toBe('paid')

    const members = await getPayoutBatchMemberBookings(primaryPayoutId)
    expect(members.length).toBe(stagedBookingIds.length)
    for (const m of members) expect(m.payoutState).toBe('paid')

    expect(await countPayoutBatchAuditRows('payout.webhook_processed', primaryPayoutId)).toBe(1)
  })

  test('webhook replay deduped: same event id is a no-op (still paid, one audit)', async ({
    request,
  }) => {
    const eventId = `evt_replay_${Date.now()}`
    const send = () =>
      request.post('/api/webhooks/razorpayx', {
        headers: {
          'x-razorpay-signature': 'e2e-test-mode-bypass',
          'x-razorpay-event-id': eventId,
          'content-type': 'application/json',
        },
        data: webhookBody({
          event: 'payout.processed',
          referenceId: primaryPayoutId,
          status: 'processed',
        }),
      })

    const first = await send()
    expect(first.status()).toBe(200)
    const second = await send()
    expect(second.status()).toBe(200)
    expect((await second.json()).deduped).toBe(true)

    // Still paid, and the guarded transition never re-ran (the only processed
    // audit is the one from the prior test; this replayed pair added none).
    const batch = await getPayoutBatchById(primaryPayoutId)
    expect(batch?.status).toBe('paid')
    expect(await countPayoutBatchAuditRows('payout.webhook_processed', primaryPayoutId)).toBe(1)
  })

  test('webhook failed → batch failed + members re-queued (pending, batch link cleared)', async ({
    request,
  }) => {
    // Stage a SECOND, fresh batch: take a third unbatched Booking, snapshot it
    // onto a DISTINCT destination (so it forms its own (vendor, destination)
    // group rather than re-finding the primary paid batch), and send the cron. A
    // failure of this NEW batch is the first failure for the group →
    // decidePayoutRetry re-queues.
    const candidates = await getUnbatchedCompletedBookingsForVendor(PAYOUT_VENDOR)
    const failBookingId = candidates[0]?.bookingId
    expect(failBookingId, 'a third unbatched Booking must be available').toBeTruthy()

    await setBookingPayoutStateForTest(failBookingId!, 'pending')
    await setBookingPayoutSnapshot({
      bookingId: failBookingId!,
      payoutMethod: 'upi',
      payoutDestination: FAIL_DESTINATION,
    })

    const cron = await request.post('/api/cron/payout-batch', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
    expect(cron.status()).toBe(200)

    const failBatchId = await getBookingPayoutBatchId(failBookingId!)
    expect(failBatchId, 'the third Booking must be batched by the second cron run').toBeTruthy()
    expect(failBatchId).not.toBe(primaryPayoutId)

    const fail = await request.post('/api/webhooks/razorpayx', {
      headers: {
        'x-razorpay-signature': 'e2e-test-mode-bypass',
        'x-razorpay-event-id': `evt_failed_${Date.now()}`,
        'content-type': 'application/json',
      },
      data: webhookBody({
        event: 'payout.failed',
        referenceId: failBatchId!,
        status: 'failed',
      }),
    })
    expect(fail.status()).toBe(200)

    const batch = await getPayoutBatchById(failBatchId!)
    expect(batch?.status).toBe('failed')

    // First failure (≤3) → member re-queued: pending + batch link cleared so the
    // next cron re-picks it.
    const reverted = await getBookingPayoutState(failBookingId!)
    expect(reverted?.payoutState).toBe('pending')
    expect(await getBookingPayoutBatchId(failBookingId!)).toBeNull()
  })

  test('webhook reversed → batch reversed + members reversed, NOT re-queued (admin-gated)', async ({
    request,
  }) => {
    // The primary batch is `paid` (from the processed test). A reversal of a paid
    // batch is the DANGEROUS path: mark reversed, revert members, KEEP the batch
    // link so the cron never re-picks them.
    const reverse = await request.post('/api/webhooks/razorpayx', {
      headers: {
        'x-razorpay-signature': 'e2e-test-mode-bypass',
        'x-razorpay-event-id': `evt_reversed_${Date.now()}`,
        'content-type': 'application/json',
      },
      data: webhookBody({
        event: 'payout.reversed',
        referenceId: primaryPayoutId,
        status: 'reversed',
      }),
    })
    expect(reverse.status()).toBe(200)

    const batch = await getPayoutBatchById(primaryPayoutId)
    expect(batch?.status).toBe('reversed')

    const members = await getPayoutBatchMemberBookings(primaryPayoutId)
    expect(members.length).toBe(stagedBookingIds.length)
    for (const m of members) expect(m.payoutState).toBe('reversed')

    // Admin-gated: the batch link is KEPT (members stay attached, never re-queued).
    for (const bookingId of stagedBookingIds) {
      expect(await getBookingPayoutBatchId(bookingId)).toBe(primaryPayoutId)
    }
  })
})
