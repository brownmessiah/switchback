import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /api/healthz contract (ADR-0019):
 *   ?shallow  → 200 process-up, NO DB call (liveness + LB backend check)
 *   default   → deep: 200 when DB reachable, 503 when not (startup probe + smoke)
 */

const executeMock = vi.fn()
vi.mock('@/db/client', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}))

function req(path: string): Request {
  return new Request(`http://localhost${path}`)
}

describe('GET /api/healthz', () => {
  beforeEach(() => {
    executeMock.mockReset()
  })
  afterEach(() => {
    vi.resetModules()
  })

  it('shallow check returns 200 without touching the DB', async () => {
    const { GET } = await import('./route')
    const res = await GET(req('/api/healthz?shallow'))
    expect(res.status).toBe(200)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('deep check returns 200 when the DB is reachable', async () => {
    executeMock.mockResolvedValue([{ '?column?': 1 }])
    const { GET } = await import('./route')
    const res = await GET(req('/api/healthz'))
    expect(res.status).toBe(200)
    expect(executeMock).toHaveBeenCalledTimes(1)
  })

  it('deep check returns 503 when the DB is unreachable', async () => {
    executeMock.mockRejectedValue(new Error('connection refused'))
    const { GET } = await import('./route')
    const res = await GET(req('/api/healthz'))
    expect(res.status).toBe(503)
  })
})
