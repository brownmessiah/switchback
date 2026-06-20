import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Env-gate contract (ADR-0019): cron handlers are absent from the PUBLIC web
 * service (RUN_CRON_ROUTES unset → 404) and served only on the private cron
 * service (RUN_CRON_ROUTES=true), where the existing CRON_SECRET check still
 * applies as defense-in-depth.
 */
let cronSecret: string | undefined
let runCronRoutes: string | undefined

vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }))
vi.mock('@/db/client', () => ({ db: {} }))
vi.mock('@/lib/env', () => ({
  get env() {
    return { CRON_SECRET: cronSecret, RUN_CRON_ROUTES: runCronRoutes }
  },
}))
vi.mock('@/lib/payments/partial-pay-autocapture', () => ({
  processPartialPayAutocapture: vi.fn(),
}))

describe('POST /api/cron/partial-pay-autocapture (env gate)', () => {
  beforeEach(() => {
    cronSecret = 'top-secret'
    runCronRoutes = 'true'
  })
  afterEach(() => {
    vi.resetModules()
  })

  it('returns 404 when RUN_CRON_ROUTES is not enabled (public surface)', async () => {
    runCronRoutes = undefined
    const { POST } = await import('./route')
    expect((await POST()).status).toBe(404)
  })

  it('passes the gate when RUN_CRON_ROUTES=true (reaches the CRON_SECRET check)', async () => {
    runCronRoutes = 'true'
    cronSecret = undefined // missing secret → 500, proving the gate is open (not 404)
    const { POST } = await import('./route')
    expect((await POST()).status).toBe(500)
  })
})
