import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilityPatterns } from '@/db/schema/availability-patterns'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeCreatePattern,
  executeDeletePattern,
  executeUpdatePattern,
  listPatterns,
  type CreatePatternInput,
} from './pattern-crud'

describe('Pattern CRUD', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_pat_vendor', email: 'pat-vendor@test.com' },
      { id: 'u_pat_other', email: 'pat-other@test.com' },
    ])
    await db.insert(vendorProfiles).values([
      { userId: 'u_pat_vendor', businessName: 'Pattern Vendor', slug: 'pattern-vendor' },
      { userId: 'u_pat_other', businessName: 'Other Vendor', slug: 'pat-other-vendor' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE availability_patterns CASCADE`)
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)

    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_pat_vendor',
        slug: 'pat-test-exp',
        title: 'Pattern Test',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500',
        pricePerPerson_3_5: '1300',
        pricePerPerson_6_plus: '1100',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })

    experienceId = exp.id
  })

  function validInput(overrides: Partial<CreatePatternInput> = {}): CreatePatternInput {
    return {
      experienceId,
      dayOfWeek: 1, // Monday
      startTime: '06:00',
      endTime: '09:00',
      capacity: 10,
      effectiveFrom: null,
      effectiveUntil: null,
      ...overrides,
    }
  }

  describe('create', () => {
    it('creates an availability_patterns row', async () => {
      const result = await executeCreatePattern(db, 'u_pat_vendor', validInput())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.pattern.experienceId).toBe(experienceId)
        expect(result.pattern.dayOfWeek).toBe(1)
        expect(result.pattern.startTime).toBe('06:00')
        expect(result.pattern.endTime).toBe('09:00')
        expect(result.pattern.capacity).toBe(10)
      }
    })

    it('rejects invalid day of week', async () => {
      const result = await executeCreatePattern(db, 'u_pat_vendor', validInput({ dayOfWeek: 7 }))
      expect(result.ok).toBe(false)
    })

    it('rejects invalid time format', async () => {
      const result = await executeCreatePattern(db, 'u_pat_vendor', validInput({ startTime: '6am' }))
      expect(result.ok).toBe(false)
    })

    it('rejects zero capacity', async () => {
      const result = await executeCreatePattern(db, 'u_pat_vendor', validInput({ capacity: 0 }))
      expect(result.ok).toBe(false)
    })

    it('rejects non-owner vendor', async () => {
      const result = await executeCreatePattern(db, 'u_pat_other', validInput())
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('You do not own this experience.')
      }
    })

    it('accepts effective date range', async () => {
      const result = await executeCreatePattern(
        db,
        'u_pat_vendor',
        validInput({ effectiveFrom: '2026-06-01', effectiveUntil: '2026-12-31' }),
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.pattern.effectiveFrom).toBe('2026-06-01')
        expect(result.pattern.effectiveUntil).toBe('2026-12-31')
      }
    })
  })

  describe('update', () => {
    it('updates pattern fields', async () => {
      const createResult = await executeCreatePattern(db, 'u_pat_vendor', validInput())
      if (!createResult.ok) throw new Error('Setup failed')

      const result = await executeUpdatePattern(db, 'u_pat_vendor', {
        id: createResult.pattern.id,
        capacity: 20,
        startTime: '07:00',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.pattern.capacity).toBe(20)
        expect(result.pattern.startTime).toBe('07:00')
        // Unchanged fields preserved
        expect(result.pattern.endTime).toBe('09:00')
        expect(result.pattern.dayOfWeek).toBe(1)
      }
    })

    it('rejects non-owner update', async () => {
      const createResult = await executeCreatePattern(db, 'u_pat_vendor', validInput())
      if (!createResult.ok) throw new Error('Setup failed')

      const result = await executeUpdatePattern(db, 'u_pat_other', {
        id: createResult.pattern.id,
        capacity: 20,
      })
      expect(result.ok).toBe(false)
    })
  })

  describe('delete', () => {
    it('deletes a pattern', async () => {
      const createResult = await executeCreatePattern(db, 'u_pat_vendor', validInput())
      if (!createResult.ok) throw new Error('Setup failed')

      const result = await executeDeletePattern(db, 'u_pat_vendor', createResult.pattern.id)
      expect(result.ok).toBe(true)

      const remaining = await listPatterns(db, experienceId)
      expect(remaining).toHaveLength(0)
    })

    it('rejects non-owner delete', async () => {
      const createResult = await executeCreatePattern(db, 'u_pat_vendor', validInput())
      if (!createResult.ok) throw new Error('Setup failed')

      const result = await executeDeletePattern(db, 'u_pat_other', createResult.pattern.id)
      expect(result.ok).toBe(false)
    })

    it('returns error for non-existent pattern', async () => {
      const result = await executeDeletePattern(
        db,
        'u_pat_vendor',
        '00000000-0000-0000-0000-000000000000',
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Pattern not found.')
      }
    })
  })

  describe('list', () => {
    it('returns all patterns for an experience', async () => {
      await executeCreatePattern(db, 'u_pat_vendor', validInput({ dayOfWeek: 1 }))
      await executeCreatePattern(db, 'u_pat_vendor', validInput({ dayOfWeek: 3 }))
      await executeCreatePattern(db, 'u_pat_vendor', validInput({ dayOfWeek: 5 }))

      const patterns = await listPatterns(db, experienceId)
      expect(patterns).toHaveLength(3)
    })
  })
})
