import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilityPatterns } from '@/db/schema/availability-patterns'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { executeMaterializeSlots } from './materialize-core'

/**
 * FIX 3 (issue #03 review) — `materializeSlotsAction` gates the ACTING user on
 * `availability:manage`, then passed the client-supplied `experienceId` straight
 * into `materializeSlots` with NO ownership check. A Vendor could materialize
 * slots onto ANOTHER vendor's Experience (cross-vendor write bypass). The
 * ownership-checked core proves the fix: the acting user's id must own the
 * Experience or NO slots are written.
 */
describe('executeMaterializeSlots — ownership-gated (FIX 3)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let ownExperienceId: string
  let foreignExperienceId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_mat_owner', email: 'mat-owner@test.com' },
      { id: 'u_mat_other', email: 'mat-other@test.com' },
    ])
    await db.insert(vendorProfiles).values([
      { userId: 'u_mat_owner', businessName: 'Mat Owner', slug: 'mat-owner' },
      { userId: 'u_mat_other', businessName: 'Mat Other', slug: 'mat-other' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE availability_slots CASCADE`)
    await db.execute(sql`TRUNCATE TABLE availability_patterns CASCADE`)
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)

    // The acting user's own Experience.
    const [own] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_mat_owner',
        slug: 'mat-own-exp',
        title: 'Mat Own',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500',
        pricePerPerson_3_5: '1300',
        pricePerPerson_6_plus: '1100',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    ownExperienceId = own.id

    // Another vendor's Experience.
    const [foreign] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_mat_other',
        slug: 'mat-foreign-exp',
        title: 'Mat Foreign',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500',
        pricePerPerson_3_5: '1300',
        pricePerPerson_6_plus: '1100',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    foreignExperienceId = foreign.id

    // Both Experiences have a daily pattern so materialize WOULD create slots
    // if it ran. (dayOfWeek 0..6 covered to be robust to "today".)
    for (const expId of [ownExperienceId, foreignExperienceId]) {
      await db.insert(availabilityPatterns).values(
        [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
          experienceId: expId,
          dayOfWeek: dow,
          startTime: '06:00',
          endTime: '09:00',
          capacity: 10,
        })),
      )
    }
  })

  it('materializes slots for the acting user OWN experience', async () => {
    const result = await executeMaterializeSlots(db, 'u_mat_owner', ownExperienceId, 7)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.created).toBeGreaterThan(0)
    }
  })

  it("REJECTS materializing onto ANOTHER vendor's experience — no slots written", async () => {
    const result = await executeMaterializeSlots(db, 'u_mat_owner', foreignExperienceId, 7)
    expect(result.ok).toBe(false)

    // Critically: NOT A SINGLE slot was written on the foreign Experience.
    const slots = await db
      .select({ id: availabilitySlots.id })
      .from(availabilitySlots)
      .where(eq(availabilitySlots.experienceId, foreignExperienceId))
    expect(slots).toHaveLength(0)
  })

  it('rejects a non-existent experience id', async () => {
    const result = await executeMaterializeSlots(
      db,
      'u_mat_owner',
      '00000000-0000-0000-0000-000000000000',
      7,
    )
    expect(result.ok).toBe(false)
  })
})
