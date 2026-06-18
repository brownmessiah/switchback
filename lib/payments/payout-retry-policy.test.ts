import { describe, expect, it } from 'vitest'

import { decidePayoutRetry, type PayoutRetryDecision } from './payout-retry-policy'

/**
 * Pure retry policy for failed Payout Batches per ADR-0016 (2026-06-18
 * amendment, D5 + "Payout failures"): "3 retries with exponential backoff,
 * then admin queue."
 *
 * RETRY-COUNT CONTRACT (orchestrator-locked):
 *   failureCount = number of FAILED attempts so far, INCLUDING the current one.
 *     1 → retry (backoff b1)
 *     2 → retry (backoff b2 > b1)
 *     3 → retry (backoff b3 > b2)
 *     ≥4 → admin_queue
 *
 * The money-critical invariant is BOUNDED retries (max 3) then admin queue.
 * The actual day-level retry spacing is provided by the daily cron cadence;
 * backoffMs is only asserted to GROW across attempts here.
 */
describe('decidePayoutRetry (ADR-0016 — 3 retries then admin queue)', () => {
  it('failureCount 1 → retry with a positive backoff', () => {
    const decision = decidePayoutRetry({ failureCount: 1 })
    expect(decision.action).toBe('retry')
    if (decision.action === 'retry') {
      expect(decision.backoffMs).toBeGreaterThan(0)
    }
  })

  it('failureCount 2 → retry with a backoff strictly greater than attempt 1', () => {
    const first = decidePayoutRetry({ failureCount: 1 })
    const second = decidePayoutRetry({ failureCount: 2 })
    expect(second.action).toBe('retry')
    if (first.action === 'retry' && second.action === 'retry') {
      expect(second.backoffMs).toBeGreaterThan(first.backoffMs)
    }
  })

  it('failureCount 3 → retry with a backoff strictly greater than attempt 2', () => {
    const second = decidePayoutRetry({ failureCount: 2 })
    const third = decidePayoutRetry({ failureCount: 3 })
    expect(third.action).toBe('retry')
    if (second.action === 'retry' && third.action === 'retry') {
      expect(third.backoffMs).toBeGreaterThan(second.backoffMs)
    }
  })

  it('failureCount 4 → admin_queue (retries exhausted)', () => {
    const decision = decidePayoutRetry({ failureCount: 4 })
    expect(decision.action).toBe('admin_queue')
  })

  it('failureCount > 4 → admin_queue (stays exhausted, never re-retries)', () => {
    for (const failureCount of [5, 6, 10, 100]) {
      const decision: PayoutRetryDecision = decidePayoutRetry({ failureCount })
      expect(decision.action).toBe('admin_queue')
    }
  })

  it('backoff grows monotonically across the three retry attempts', () => {
    const backoffs = [1, 2, 3].map((failureCount) => {
      const decision = decidePayoutRetry({ failureCount })
      if (decision.action !== 'retry') {
        throw new Error(`expected retry at failureCount ${failureCount}`)
      }
      return decision.backoffMs
    })
    expect(backoffs[0]).toBeLessThan(backoffs[1]!)
    expect(backoffs[1]).toBeLessThan(backoffs[2]!)
  })
})
