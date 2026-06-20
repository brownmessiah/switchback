import { describe, expect, it } from 'vitest'

import {
  classifyPayoutQueueItem,
  PAYOUT_QUEUE_CATEGORIES,
  payoutQueueCategoryLabel,
  type PayoutQueueCategory,
  type PayoutQueueItemInput,
} from './payout-queue'

/**
 * Pure classifier for the admin payout queue (slice 05, PRD stories 11 + 14).
 *
 * Given a per-Booking Payout's facts — its payout_state, maturity, the Vendor's
 * first-3 gate (manualPayoutsRemaining), whether it has already been batched,
 * and (for matured-eligible-unbatched Payouts) the Fund Account resolution —
 * the classifier names the queue category the admin sees. PURE: no I/O, no
 * clock; the caller injects `now` and the pre-resolved Fund Account status.
 *
 * Category set:
 *   not_matured          completedAt + window > now (not yet eligible)
 *   awaiting_approval    matured + pending + manualPayoutsRemaining > 0 (first-3)
 *   auto_pending         matured + eligible + unbatched + fund account ok
 *   blocked_fund_account matured + eligible + unbatched + fund account missing/cooling-off
 *   processing|paid|failed|reversed   the Payout Batch send lifecycle
 *   rejected|held        terminal/frozen admin decisions
 */

const NOW = new Date('2026-06-18T11:30:00.000Z')
// Completed 30 days ago → matured under both T+7 and T+30 windows.
const MATURED_AT = new Date(NOW.getTime() - 30 * 86_400_000)
// Completed 3 days ago → NOT matured under the default T+7 window.
const FRESH_AT = new Date(NOW.getTime() - 3 * 86_400_000)

function base(overrides: Partial<PayoutQueueItemInput> = {}): PayoutQueueItemInput {
  return {
    payoutState: 'pending',
    completedAt: MATURED_AT,
    permitRequired: false,
    multiDay: false,
    manualPayoutsRemaining: 0,
    alreadyBatched: false,
    fundAccount: { status: 'ok', fundAccountId: 'fa_test' },
    now: NOW,
    ...overrides,
  }
}

describe('classifyPayoutQueueItem', () => {
  it('classifies a matured pending Payout with manual approvals remaining as awaiting_approval', () => {
    expect(
      classifyPayoutQueueItem(base({ payoutState: 'pending', manualPayoutsRemaining: 2 })),
    ).toBe('awaiting_approval')
  })

  it('classifies a matured pending Payout with the gate open (remaining 0) and a resolvable fund account as auto_pending', () => {
    expect(
      classifyPayoutQueueItem(
        base({ payoutState: 'pending', manualPayoutsRemaining: 0, fundAccount: { status: 'ok', fundAccountId: 'fa_test' } }),
      ),
    ).toBe('auto_pending')
  })

  it('classifies a matured approved Payout (gate already consumed) with a resolvable fund account as auto_pending', () => {
    expect(
      classifyPayoutQueueItem(
        base({ payoutState: 'approved', manualPayoutsRemaining: 3, fundAccount: { status: 'ok', fundAccountId: 'fa_test' } }),
      ),
    ).toBe('auto_pending')
  })

  it('classifies a matured eligible Payout with a MISSING fund account as blocked_fund_account', () => {
    expect(
      classifyPayoutQueueItem(
        base({
          payoutState: 'approved',
          fundAccount: { status: 'admin_queue', reason: 'missing' },
        }),
      ),
    ).toBe('blocked_fund_account')
  })

  it('classifies a matured eligible Payout whose fund account is still cooling off as blocked_fund_account', () => {
    expect(
      classifyPayoutQueueItem(
        base({
          payoutState: 'pending',
          manualPayoutsRemaining: 0,
          fundAccount: { status: 'admin_queue', reason: 'cooling_off' },
        }),
      ),
    ).toBe('blocked_fund_account')
  })

  it('classifies a not-yet-matured pending Payout as not_matured (regardless of fund account)', () => {
    expect(
      classifyPayoutQueueItem(
        base({ payoutState: 'pending', completedAt: FRESH_AT, manualPayoutsRemaining: 0 }),
      ),
    ).toBe('not_matured')
  })

  it('classifies a not-yet-matured approved Payout as not_matured', () => {
    expect(
      classifyPayoutQueueItem(base({ payoutState: 'approved', completedAt: FRESH_AT })),
    ).toBe('not_matured')
  })

  it('treats a Payout with no completedAt as not_matured', () => {
    expect(classifyPayoutQueueItem(base({ completedAt: null }))).toBe('not_matured')
  })

  it('honours the extended T+30 window: a permit-required Payout matured under T+7 but not T+30 is not_matured', () => {
    const tenDaysAgo = new Date(NOW.getTime() - 10 * 86_400_000)
    expect(
      classifyPayoutQueueItem(
        base({ payoutState: 'approved', completedAt: tenDaysAgo, permitRequired: true }),
      ),
    ).toBe('not_matured')
  })

  it('honours the extended T+30 window for a multi-day Payout', () => {
    const tenDaysAgo = new Date(NOW.getTime() - 10 * 86_400_000)
    expect(
      classifyPayoutQueueItem(
        base({ payoutState: 'approved', completedAt: tenDaysAgo, multiDay: true }),
      ),
    ).toBe('not_matured')
  })

  it('classifies a held Payout as held (frozen, regardless of maturity)', () => {
    expect(classifyPayoutQueueItem(base({ payoutState: 'held' }))).toBe('held')
    expect(classifyPayoutQueueItem(base({ payoutState: 'held', completedAt: FRESH_AT }))).toBe(
      'held',
    )
  })

  it('classifies a rejected Payout as rejected (terminal)', () => {
    expect(classifyPayoutQueueItem(base({ payoutState: 'rejected' }))).toBe('rejected')
  })

  it('maps the Payout Batch send lifecycle states straight through', () => {
    expect(classifyPayoutQueueItem(base({ payoutState: 'processing', alreadyBatched: true }))).toBe(
      'processing',
    )
    expect(classifyPayoutQueueItem(base({ payoutState: 'paid', alreadyBatched: true }))).toBe('paid')
    expect(classifyPayoutQueueItem(base({ payoutState: 'failed', alreadyBatched: true }))).toBe(
      'failed',
    )
    expect(classifyPayoutQueueItem(base({ payoutState: 'reversed', alreadyBatched: true }))).toBe(
      'reversed',
    )
  })

  it('classifies an already-batched Payout still showing pending/approved as processing (it has been sent)', () => {
    // Defensive: a batched Booking should have payout_state advanced to
    // processing, but if a row lags, alreadyBatched wins over the stale state.
    expect(
      classifyPayoutQueueItem(base({ payoutState: 'approved', alreadyBatched: true })),
    ).toBe('processing')
  })
})

describe('payoutQueueCategoryLabel', () => {
  it('gives a human label for every category (the queue can render any of them)', () => {
    for (const category of PAYOUT_QUEUE_CATEGORIES) {
      const label = payoutQueueCategoryLabel(category)
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('surfaces the two admin-visible exceptions distinctly (stories 11 + 14)', () => {
    expect(payoutQueueCategoryLabel('awaiting_approval')).toBe('Awaiting approval')
    expect(payoutQueueCategoryLabel('blocked_fund_account')).toBe('Fund account blocked')
  })

  it('PAYOUT_QUEUE_CATEGORIES lists exactly the classifier categories', () => {
    const sample: PayoutQueueCategory[] = [
      'not_matured',
      'awaiting_approval',
      'auto_pending',
      'blocked_fund_account',
      'processing',
      'paid',
      'failed',
      'reversed',
      'rejected',
      'held',
    ]
    expect([...PAYOUT_QUEUE_CATEGORIES].sort()).toEqual([...sample].sort())
  })
})
