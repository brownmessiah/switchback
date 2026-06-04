import { and, eq, gte } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { availabilityPatterns } from '@/db/schema/availability-patterns'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { DEFAULT_AVAILABILITY_DAYS, seedDefaultAvailability } from './seed-availability'

describe('seedDefaultAvailability', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let expId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values({ id: 'u_av', email: 'av@example.com' })
    await db
      .insert(vendorProfiles)
      .values({ userId: 'u_av', businessName: 'AV', slug: 'av', kycTier: 'business' })
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_av',
        slug: 'av-exp',
        title: 'AV Exp',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1000',
        pricePerPerson_3_5: '900',
        pricePerPerson_6_plus: '800',
        regionSlug: 'goa',
        activitySlug: 'kayaking',
        status: 'published',
      })
      .returning({ id: experiences.id })
    expId = exp!.id
  })

  afterAll(async () => {
    await teardown()
  })

  async function futureBookableCount(): Promise<number> {
    const rows = await db
      .select({ id: availabilitySlots.id })
      .from(availabilitySlots)
      .where(
        and(
          eq(availabilitySlots.experienceId, expId),
          eq(availabilitySlots.status, 'open'),
          gte(availabilitySlots.startAt, new Date()),
        ),
      )
    return rows.length
  }

  it('creates one weekly pattern per default day and materializes many future slots', async () => {
    await seedDefaultAvailability(db, expId, { daysForward: 90 })

    const patterns = await db
      .select({ dayOfWeek: availabilityPatterns.dayOfWeek })
      .from(availabilityPatterns)
      .where(eq(availabilityPatterns.experienceId, expId))
    expect(patterns.length).toBe(DEFAULT_AVAILABILITY_DAYS.length)
    expect(patterns.map((p) => p.dayOfWeek).sort()).toEqual([...DEFAULT_AVAILABILITY_DAYS].sort())

    // 5 days/week over 90 days → comfortably more than a single sparse slot.
    expect(await futureBookableCount()).toBeGreaterThanOrEqual(40)
  })

  it('is idempotent — re-running adds no duplicate patterns or slots', async () => {
    const slotsBefore = await futureBookableCount()
    const patternsBefore = (
      await db
        .select({ id: availabilityPatterns.id })
        .from(availabilityPatterns)
        .where(eq(availabilityPatterns.experienceId, expId))
    ).length

    await seedDefaultAvailability(db, expId, { daysForward: 90 })

    expect(await futureBookableCount()).toBe(slotsBefore)
    const patternsAfter = (
      await db
        .select({ id: availabilityPatterns.id })
        .from(availabilityPatterns)
        .where(eq(availabilityPatterns.experienceId, expId))
    ).length
    expect(patternsAfter).toBe(patternsBefore)
  })

  it('leaves two weekdays unbooked-by-default so the calendar shows real Unavailable days', () => {
    // Realism: not every day is available (the critique flagged "looks fake").
    expect(DEFAULT_AVAILABILITY_DAYS.length).toBeLessThan(7)
    expect(DEFAULT_AVAILABILITY_DAYS.length).toBeGreaterThanOrEqual(4)
  })
})
