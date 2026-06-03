import { asc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { experienceItinerarySteps } from './experience-itinerary-steps'
import { experiences } from './experiences'
import { users } from './users'
import { vendorProfiles } from './vendor-profiles'

describe('experience_itinerary_steps (ADR-0017, mirrors ADR-0009 child-table pattern)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values({ id: 'u_v', email: 'v@example.com' })
    await db.insert(vendorProfiles).values({
      userId: 'u_v',
      businessName: 'Test Adventures',
      slug: 'test-adventures',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)
  })

  async function seedExperience(slug = 'itinerary-test'): Promise<string> {
    const [row] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug,
        title: 'Itinerary Test',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '500',
        pricePerPerson_3_5: '500',
        pricePerPerson_6_plus: '500',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    return row!.id
  }

  it('inserts steps and reads them back ordered by step_order', async () => {
    const experienceId = await seedExperience()
    await db.insert(experienceItinerarySteps).values([
      { experienceId, stepOrder: 2, title: 'Lunch by the river' },
      { experienceId, stepOrder: 1, title: 'Safety briefing', description: 'Gear + signals' },
      { experienceId, stepOrder: 3, title: 'Rapids run', dayOffset: 0, durationMinutes: 120 },
    ])
    const rows = await db
      .select()
      .from(experienceItinerarySteps)
      .where(eq(experienceItinerarySteps.experienceId, experienceId))
      .orderBy(asc(experienceItinerarySteps.stepOrder))
    expect(rows.map((r) => r.title)).toEqual([
      'Safety briefing',
      'Lunch by the river',
      'Rapids run',
    ])
    expect(rows[0]?.description).toBe('Gear + signals')
    expect(rows[2]?.durationMinutes).toBe(120)
  })

  it('enforces UNIQUE (experience_id, step_order)', async () => {
    const experienceId = await seedExperience()
    await db.insert(experienceItinerarySteps).values({
      experienceId,
      stepOrder: 1,
      title: 'First',
    })
    await expect(
      db.insert(experienceItinerarySteps).values({
        experienceId,
        stepOrder: 1,
        title: 'Duplicate order',
      }),
    ).rejects.toThrow()
  })

  it('allows the same step_order across different Experiences', async () => {
    const a = await seedExperience('itinerary-a')
    const b = await seedExperience('itinerary-b')
    await db.insert(experienceItinerarySteps).values({ experienceId: a, stepOrder: 1, title: 'A1' })
    await db.insert(experienceItinerarySteps).values({ experienceId: b, stepOrder: 1, title: 'B1' })
    const rows = await db.select().from(experienceItinerarySteps)
    expect(rows).toHaveLength(2)
  })

  it('cascades step deletion when the parent Experience is deleted', async () => {
    const experienceId = await seedExperience()
    await db.insert(experienceItinerarySteps).values({
      experienceId,
      stepOrder: 1,
      title: 'Will be cascaded',
    })
    await db.delete(experiences).where(eq(experiences.id, experienceId))
    const remaining = await db
      .select()
      .from(experienceItinerarySteps)
      .where(eq(experienceItinerarySteps.experienceId, experienceId))
    expect(remaining).toHaveLength(0)
  })

  it('enforces title NOT NULL', async () => {
    const experienceId = await seedExperience()
    await expect(
      db.execute(
        sql`INSERT INTO experience_itinerary_steps (experience_id, step_order, title)
            VALUES (${experienceId}, 1, NULL)`,
      ),
    ).rejects.toThrow()
  })
})
