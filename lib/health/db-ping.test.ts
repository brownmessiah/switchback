import { describe, expect, it } from 'vitest'

import { pingDatabase } from './db-ping'

/**
 * Deep DB health probe (ADR-0019). Used by the /api/healthz deep check + the
 * Cloud Run startup probe + the deploy smoke test. Must be fast and never hang —
 * a short timeout maps an unreachable DB to "unhealthy", not a stuck request.
 */
describe('pingDatabase', () => {
  it('returns true when SELECT 1 resolves', async () => {
    const db = { execute: async () => [{ '?column?': 1 }] }
    expect(await pingDatabase(db, 1000)).toBe(true)
  })

  it('returns false when the query rejects (DB unreachable)', async () => {
    const db = {
      execute: async () => {
        throw new Error('ECONNREFUSED')
      },
    }
    expect(await pingDatabase(db, 1000)).toBe(false)
  })

  it('returns false without hanging when the query exceeds the timeout', async () => {
    const db = { execute: () => new Promise<never>(() => {}) } // never settles
    const start = Date.now()
    expect(await pingDatabase(db, 20)).toBe(false)
    expect(Date.now() - start).toBeLessThan(500)
  })
})
