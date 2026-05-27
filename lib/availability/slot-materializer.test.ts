import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilityPatterns } from '@/db/schema/availability-patterns'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { experiences } from '@/db/schema/experiences'
import { regionClosures } from '@/db/schema/region-closures'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { materializeSlots } from './slot-materializer'

describe('Slot Materializer', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values({ id: 'u_mat_vendor', email: 'mat-vendor@test.com' })
    await db.insert(vendorProfiles).values({
      userId: 'u_mat_vendor',
      businessName: 'Materializer Vendor',
      slug: 'materializer-vendor',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE availability_slots CASCADE`)
    await db.execute(sql`TRUNCATE TABLE availability_patterns CASCADE`)
    await db.execute(sql`TRUNCATE TABLE region_closures CASCADE`)
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)

    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_mat_vendor',
        slug: 'mat-test-exp',
        title: 'Materializer Test',
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

  describe('generates slots from weekly pattern', () => {
    it('creates slots for matching days of week', async () => {
      // Create a Monday pattern (dayOfWeek=1)
      await db.insert(availabilityPatterns).values({
        experienceId,
        dayOfWeek: 1, // Monday
        startTime: '06:00',
        endTime: '09:00',
        capacity: 10,
      })

      const result = await materializeSlots(db, experienceId, 14) // 2 weeks

      // In 14 days there should be exactly 2 Mondays
      expect(result.created).toBe(2)
      expect(result.skipped).toBe(0)

      // Verify the slots have correct properties
      const slots = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.experienceId, experienceId))

      expect(slots).toHaveLength(2)
      for (const slot of slots) {
        expect(slot.capacity).toBe(10)
        expect(slot.capacityTaken).toBe(0)
        expect(slot.status).toBe('open')
        expect(slot.startAt.getUTCHours()).toBe(6)
        expect(slot.endAt.getUTCHours()).toBe(9)
        // Verify it's a Monday
        expect(slot.startAt.getUTCDay()).toBe(1)
      }
    })

    it('handles multiple patterns on different days', async () => {
      // Mon, Wed, Fri
      await db.insert(availabilityPatterns).values([
        { experienceId, dayOfWeek: 1, startTime: '06:00', endTime: '09:00', capacity: 10 },
        { experienceId, dayOfWeek: 3, startTime: '06:00', endTime: '09:00', capacity: 8 },
        { experienceId, dayOfWeek: 5, startTime: '06:00', endTime: '09:00', capacity: 12 },
      ])

      const result = await materializeSlots(db, experienceId, 7) // 1 week

      // In 7 days from today, there should be 1 each of Mon, Wed, Fri
      // (could be 0-1 depending on which day today is, but at least some)
      expect(result.created).toBeGreaterThanOrEqual(1)
      expect(result.skipped).toBe(0)
    })

    it('returns zero for experience with no patterns', async () => {
      const result = await materializeSlots(db, experienceId, 14)
      expect(result.created).toBe(0)
      expect(result.skipped).toBe(0)
    })

    it('returns zero for non-existent experience', async () => {
      const result = await materializeSlots(
        db,
        '00000000-0000-0000-0000-000000000000',
        14,
      )
      expect(result.created).toBe(0)
      expect(result.skipped).toBe(0)
    })
  })

  describe('idempotency', () => {
    it('running twice produces same number of slots (second run skips all)', async () => {
      await db.insert(availabilityPatterns).values({
        experienceId,
        dayOfWeek: 1, // Monday
        startTime: '06:00',
        endTime: '09:00',
        capacity: 10,
      })

      const first = await materializeSlots(db, experienceId, 14)
      expect(first.created).toBeGreaterThan(0)

      const second = await materializeSlots(db, experienceId, 14)
      expect(second.created).toBe(0)
      expect(second.skipped).toBe(first.created) // all skipped

      // Total slots in DB should be from first run only
      const slots = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.experienceId, experienceId))

      expect(slots).toHaveLength(first.created)
    })
  })

  describe('booked slots preserved on pattern change', () => {
    it('does not overwrite slots with bookings when pattern is deleted and recreated', async () => {
      // Create pattern and materialize
      const [pattern] = await db.insert(availabilityPatterns).values({
        experienceId,
        dayOfWeek: 1,
        startTime: '06:00',
        endTime: '09:00',
        capacity: 10,
      }).returning()

      await materializeSlots(db, experienceId, 14)

      // Simulate a booking on the first slot
      const [firstSlot] = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.experienceId, experienceId))
        .limit(1)

      await db
        .update(availabilitySlots)
        .set({ capacityTaken: 3 })
        .where(eq(availabilitySlots.id, firstSlot.id))

      // Delete the pattern
      await db.delete(availabilityPatterns).where(eq(availabilityPatterns.id, pattern.id))

      // Recreate with different capacity
      await db.insert(availabilityPatterns).values({
        experienceId,
        dayOfWeek: 1,
        startTime: '06:00',
        endTime: '09:00',
        capacity: 20, // Different capacity
      })

      // Re-materialize — the booked slot should NOT be overwritten
      await materializeSlots(db, experienceId, 14)

      // The booked slot should still have capacity=10 (original) and capacityTaken=3
      const [bookedSlot] = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.id, firstSlot.id))

      expect(bookedSlot.capacity).toBe(10) // NOT 20 — ON CONFLICT DO NOTHING
      expect(bookedSlot.capacityTaken).toBe(3) // Preserved
    })
  })

  describe('region closure filtering', () => {
    it('skips dates within a region closure', async () => {
      // Create a pattern for every day of the week
      const allDays = [0, 1, 2, 3, 4, 5, 6]
      await db.insert(availabilityPatterns).values(
        allDays.map((dow) => ({
          experienceId,
          dayOfWeek: dow,
          startTime: '06:00',
          endTime: '09:00',
          capacity: 10,
        })),
      )

      // Create a closure that covers 3 days starting tomorrow
      const tomorrow = new Date()
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
      tomorrow.setUTCHours(0, 0, 0, 0)

      const closureEnd = new Date(tomorrow)
      closureEnd.setUTCDate(closureEnd.getUTCDate() + 3)

      await db.insert(regionClosures).values({
        regionSlug: 'rishikesh',
        startAt: tomorrow,
        endAt: closureEnd,
        reason: 'Monsoon flooding',
        source: 'admin',
      })

      // Materialize for 7 days
      const result = await materializeSlots(db, experienceId, 7)

      // Without closure: 7 slots (one per day). With 3-day closure: 4 slots.
      // But today is also included and may or may not match patterns.
      // The key assertion: fewer slots than days because of closure
      const allSlots = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.experienceId, experienceId))

      // We should have slots for non-closure days only.
      // 7 days minus 3 closure days = 4 days of slots
      expect(allSlots.length).toBeLessThanOrEqual(7)
      expect(allSlots.length).toBe(7 - 3) // exactly 4 non-closed days
    })

    it('does not filter closures from different regions', async () => {
      await db.insert(availabilityPatterns).values(
        [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
          experienceId,
          dayOfWeek: dow,
          startTime: '06:00',
          endTime: '09:00',
          capacity: 10,
        })),
      )

      // Closure in a different region
      const tomorrow = new Date()
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
      tomorrow.setUTCHours(0, 0, 0, 0)

      const closureEnd = new Date(tomorrow)
      closureEnd.setUTCDate(closureEnd.getUTCDate() + 3)

      await db.insert(regionClosures).values({
        regionSlug: 'manali', // Different region
        startAt: tomorrow,
        endAt: closureEnd,
        reason: 'Manali closure',
        source: 'admin',
      })

      const result = await materializeSlots(db, experienceId, 7)

      // All 7 days should have slots — closure is for a different region
      expect(result.created).toBe(7)
    })
  })

  describe('effective_from / effective_until date range', () => {
    it('only generates slots within the effective date range', async () => {
      // Create a pattern with a narrow effective window
      const today = new Date()
      const effectiveFrom = new Date(Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + 7, // starts 1 week from now
      ))
      const effectiveUntil = new Date(Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + 14, // ends 2 weeks from now
      ))

      const fromStr = effectiveFrom.toISOString().split('T')[0]
      const untilStr = effectiveUntil.toISOString().split('T')[0]

      // Pattern for every day, but only effective for 1 week
      await db.insert(availabilityPatterns).values(
        [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
          experienceId,
          dayOfWeek: dow,
          startTime: '06:00',
          endTime: '09:00',
          capacity: 10,
          effectiveFrom: fromStr,
          effectiveUntil: untilStr,
        })),
      )

      // Materialize for 30 days
      const result = await materializeSlots(db, experienceId, 30)

      // Should only generate slots for the 8 days in the effective window
      // (day 7 through day 14 inclusive = 8 days)
      expect(result.created).toBeGreaterThan(0)
      expect(result.created).toBeLessThanOrEqual(8) // At most 8 days in the window

      // Verify all slots are within the effective range
      const slots = await db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.experienceId, experienceId))

      for (const slot of slots) {
        const slotDate = slot.startAt.toISOString().split('T')[0]
        expect(slotDate >= fromStr).toBe(true)
        expect(slotDate <= untilStr).toBe(true)
      }
    })

    it('treats null effective dates as unbounded', async () => {
      await db.insert(availabilityPatterns).values(
        [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
          experienceId,
          dayOfWeek: dow,
          startTime: '06:00',
          endTime: '09:00',
          capacity: 10,
          effectiveFrom: null,
          effectiveUntil: null,
        })),
      )

      const result = await materializeSlots(db, experienceId, 14)

      // All 14 days should have slots
      expect(result.created).toBe(14)
    })
  })
})
