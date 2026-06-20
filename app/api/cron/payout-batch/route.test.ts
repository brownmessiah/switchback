import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Cron auth contract for the Payout Batch route per ADR-0016. Mirrors the
 * partial-pay-autocapture route exactly:
 *
 *   no CRON_SECRET configured   → 500
 *   missing / wrong Bearer      → 401 (constant-time compare)
 *   valid Bearer                → 200 with the worker result
 *   worker throws               → 500 with a generic body (no leak)
 *
 * The actual Payout Batch send logic lives in lib/payments/payout-batch.ts and
 * is exercised against PGlite in payout-batch.test.ts; here we only assert the
 * route's auth gate and response shape, with the worker + db mocked out.
 */

const headersMock = vi.fn()
const processPayoutBatchMock = vi.fn()
let cronSecret: string | undefined
let runCronRoutes: string | undefined

vi.mock('next/headers', () => ({
  headers: () => headersMock(),
}))

vi.mock('@/db/client', () => ({ db: {} }))

vi.mock('@/lib/env', () => ({
  get env() {
    return { CRON_SECRET: cronSecret, RUN_CRON_ROUTES: runCronRoutes }
  },
}))

vi.mock('@/lib/payments/payout-batch', () => ({
  processPayoutBatch: (...args: unknown[]) => processPayoutBatchMock(...args),
}))

function headersWith(authorization: string | null): { get: (k: string) => string | null } {
  return { get: (k: string) => (k === 'authorization' ? authorization : null) }
}

describe('POST /api/cron/payout-batch (auth contract)', () => {
  beforeEach(() => {
    cronSecret = 'top-secret'
    runCronRoutes = 'true'
    headersMock.mockReset()
    processPayoutBatchMock.mockReset()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns 404 when RUN_CRON_ROUTES is not enabled (public surface)', async () => {
    runCronRoutes = undefined
    headersMock.mockResolvedValue(headersWith('Bearer top-secret'))
    const { POST } = await import('./route')
    const res = await POST()
    expect(res.status).toBe(404)
    expect(processPayoutBatchMock).not.toHaveBeenCalled()
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    cronSecret = undefined
    headersMock.mockResolvedValue(headersWith('Bearer whatever'))
    const { POST } = await import('./route')
    const res = await POST()
    expect(res.status).toBe(500)
    expect(processPayoutBatchMock).not.toHaveBeenCalled()
  })

  it('returns 401 when the Authorization header is missing', async () => {
    headersMock.mockResolvedValue(headersWith(null))
    const { POST } = await import('./route')
    const res = await POST()
    expect(res.status).toBe(401)
    expect(processPayoutBatchMock).not.toHaveBeenCalled()
  })

  it('returns 401 when the Bearer token is wrong', async () => {
    headersMock.mockResolvedValue(headersWith('Bearer wrong'))
    const { POST } = await import('./route')
    const res = await POST()
    expect(res.status).toBe(401)
    expect(processPayoutBatchMock).not.toHaveBeenCalled()
  })

  it('returns 200 with the worker result on a valid Bearer', async () => {
    headersMock.mockResolvedValue(headersWith('Bearer top-secret'))
    processPayoutBatchMock.mockResolvedValue({
      batchesPlanned: 2,
      sent: 1,
      skippedAdminQueue: 1,
      alreadySent: 0,
    })
    const { POST } = await import('./route')
    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      batchesPlanned: 2,
      sent: 1,
      skippedAdminQueue: 1,
      alreadySent: 0,
    })
    expect(processPayoutBatchMock).toHaveBeenCalledOnce()
  })

  it('returns 500 with a generic body when the worker throws', async () => {
    headersMock.mockResolvedValue(headersWith('Bearer top-secret'))
    processPayoutBatchMock.mockRejectedValue(new Error('db exploded with secret schema detail'))
    const { POST } = await import('./route')
    const res = await POST()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'internal error' })
  })
})
