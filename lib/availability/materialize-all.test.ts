import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilityPatterns } from '@/db/schema/availability-patterns'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { materializeAllSlots } from './materialize-all'

/**
 * Rolling slot-materialization sweep (ADR-0020 launch dependency): date
 * search only surfaces Experiences whose slots are MATERIALIZED, and
 * `materializeSlots` used to run only on vendor actions/seeds. The cron
 * core sweeps every PUBLISHED experience that has recurring patterns and
 * extends its concrete slots ~90 days forward, idempotently.
 */

describe('materializeAllSlots (PGlite)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let publishedId: string
  let draftId: string
  let patternlessId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
    await db.insert(users).values([{ id: 'u_v', email: 'v@t.com', name: 'V' }])
    await db.insert(vendorProfiles).values({
      userId: 'u_v',
      businessName: 'Cron Adventures',
      slug: 'cron-adventures',
      responseTimeSlaScore: '100.00',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  async function seedExperience(slug: string, status: 'published' | 'draft'): Promise<string> {
    const [row] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug,
        title: slug,
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1000.00',
        pricePerPerson_3_5: '900.00',
        pricePerPerson_6_plus: '800.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status,
      })
      .returning({ id: experiences.id })
    return row!.id
  }

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE availability_slots, availability_patterns, experiences CASCADE`,
    )
    publishedId = await seedExperience('cron-published', 'published')
    draftId = await seedExperience('cron-draft', 'draft')
    patternlessId = await seedExperience('cron-patternless', 'published')

    for (const experienceId of [publishedId, draftId]) {
      await db.insert(availabilityPatterns).values({
        experienceId,
        dayOfWeek: 1, // Mondays
        startTime: '06:00',
        endTime: '09:00',
        capacity: 10,
      })
    }
  })

  it('materializes slots for PUBLISHED experiences with patterns only', async () => {
    const result = await materializeAllSlots(db, 30)

    expect(result.experiencesSwept).toBe(1)
    expect(result.created).toBeGreaterThanOrEqual(4) // ~4-5 Mondays in 30 days

    const published = await db
      .select()
      .from(availabilitySlots)
      .where(eq(availabilitySlots.experienceId, publishedId))
    expect(published.length).toBeGreaterThanOrEqual(4)

    const draft = await db
      .select()
      .from(availabilitySlots)
      .where(eq(availabilitySlots.experienceId, draftId))
    expect(draft).toHaveLength(0)

    const patternless = await db
      .select()
      .from(availabilitySlots)
      .where(eq(availabilitySlots.experienceId, patternlessId))
    expect(patternless).toHaveLength(0)
  })

  it('is idempotent — a second sweep creates nothing new', async () => {
    const first = await materializeAllSlots(db, 30)
    expect(first.created).toBeGreaterThan(0)

    const second = await materializeAllSlots(db, 30)
    expect(second.created).toBe(0)
    expect(second.skipped).toBeGreaterThanOrEqual(first.created)
  })
})
