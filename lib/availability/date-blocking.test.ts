import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { executeBlockDate, executeUnblockDate } from './date-blocking'

describe('Date Blocking', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_block_vendor', email: 'block-vendor@test.com' },
      { id: 'u_block_other', email: 'block-other@test.com' },
    ])
    await db.insert(vendorProfiles).values([
      { userId: 'u_block_vendor', businessName: 'Block Vendor', slug: 'block-vendor' },
      { userId: 'u_block_other', businessName: 'Other Block Vendor', slug: 'block-other-vendor' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE availability_slots CASCADE`)
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)

    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_block_vendor',
        slug: 'block-test-exp',
        title: 'Block Test',
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

    // Insert two slots for 2026-06-15
    await db.insert(availabilitySlots).values([
      {
        experienceId,
        startAt: new Date('2026-06-15T06:00:00.000Z'),
        endAt: new Date('2026-06-15T09:00:00.000Z'),
        capacity: 10,
      },
      {
        experienceId,
        startAt: new Date('2026-06-15T14:00:00.000Z'),
        endAt: new Date('2026-06-15T17:00:00.000Z'),
        capacity: 8,
      },
    ])
  })

  describe('block date', () => {
    it('sets open slots to closed for the given date', async () => {
      const result = await executeBlockDate(db, 'u_block_vendor', experienceId, '2026-06-15')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.affected).toBe(2)
      }

      const slots = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.experienceId, experienceId))

      for (const slot of slots) {
        expect(slot.status).toBe('closed')
      }
    })

    it('rejects non-owner', async () => {
      const result = await executeBlockDate(db, 'u_block_other', experienceId, '2026-06-15')
      expect(result.ok).toBe(false)
    })

    it('returns 0 affected for a date with no slots', async () => {
      const result = await executeBlockDate(db, 'u_block_vendor', experienceId, '2026-07-01')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.affected).toBe(0)
      }
    })
  })

  describe('unblock date', () => {
    it('sets closed slots back to open', async () => {
      // First block
      await executeBlockDate(db, 'u_block_vendor', experienceId, '2026-06-15')

      // Then unblock
      const result = await executeUnblockDate(db, 'u_block_vendor', experienceId, '2026-06-15')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.affected).toBe(2)
      }

      const slots = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.experienceId, experienceId))

      for (const slot of slots) {
        expect(slot.status).toBe('open')
      }
    })

    it('rejects non-owner', async () => {
      const result = await executeUnblockDate(db, 'u_block_other', experienceId, '2026-06-15')
      expect(result.ok).toBe(false)
    })
  })
})
