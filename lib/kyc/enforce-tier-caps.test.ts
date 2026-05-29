import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { assertBookingWithinTier, assertExperienceWithinTier } from './enforce-tier-caps'

/**
 * DB-aware wiring around the pure Tier-2 cap guard (ADR-0007). These tests
 * exercise the "Experience not found" path, which must surface a dedicated
 * EXPERIENCE_NOT_FOUND violation code (it is written verbatim into audit
 * payloads by the callers, so reusing PRICE_OVER_CAP would corrupt them).
 */
describe('enforce-tier-caps DB wiring — missing Experience', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  const MISSING_ID = '00000000-0000-0000-0000-000000000000'

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  it('assertExperienceWithinTier returns EXPERIENCE_NOT_FOUND for a non-existent Experience', async () => {
    const result = await assertExperienceWithinTier(db, MISSING_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('EXPERIENCE_NOT_FOUND')
    }
  })

  it('assertBookingWithinTier returns EXPERIENCE_NOT_FOUND for a non-existent Experience', async () => {
    const result = await assertBookingWithinTier(db, MISSING_ID, {
      startAt: new Date('2026-06-01T09:00:00Z'),
      endAt: new Date('2026-06-01T12:00:00Z'),
      capacity: 4,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('EXPERIENCE_NOT_FOUND')
    }
  })
})
