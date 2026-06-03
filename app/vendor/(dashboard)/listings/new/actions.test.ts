import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { loadItinerary } from '@/lib/experiences/itinerary'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { executeCreateExperience, type CreateExperienceInput } from './actions'

/**
 * Core (db-injected) create logic for the Vendor authoring form (issue 05).
 * Mirrors `executeUpdateExperience`: the `'use server'` wrapper resolves the
 * session and delegates to this testable core. Covers the ADR-0017 structured
 * scalar/array facets + itinerary persisted on the initial DRAFT, validated
 * through the shared Zod bounds.
 */
describe('executeCreateExperience', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([{ id: 'u_vendor_new', email: 'vendor-new@test.com' }])
    await db.insert(vendorProfiles).values({
      userId: 'u_vendor_new',
      businessName: 'New Test Vendor',
      slug: 'new-test-vendor',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)
  })

  function validInput(overrides: Partial<CreateExperienceInput> = {}): CreateExperienceInput {
    return {
      title: 'Sunset Kayaking',
      shortDescription: 'A scenic paddle',
      activitySlug: 'kayaking',
      regionSlug: 'goa',
      pricePerPerson_1_2: 2500,
      pricePerPerson_3_5: 2000,
      pricePerPerson_6_plus: 1500,
      cancellationPreset: 'flexible',
      ...overrides,
    }
  }

  it('creates a draft experience and returns its id', async () => {
    const result = await executeCreateExperience(db, 'u_vendor_new', validInput())
    expect(result.ok).toBe(true)
    if (result.ok) {
      const [row] = await db
        .select()
        .from(experiences)
        .where(eq(experiences.id, result.experienceId))
      expect(row.status).toBe('draft')
      expect(row.title).toBe('Sunset Kayaking')
      expect(row.vendorUserId).toBe('u_vendor_new')
    }
  })

  it('persists provided structured scalar/array fields on create', async () => {
    const result = await executeCreateExperience(
      db,
      'u_vendor_new',
      validInput({
        difficulty: 'moderate',
        durationMinutes: 180,
        minAge: 10,
        maxGroupSize: 6,
        languages: ['en', 'hi'],
        meetingPoint: 'Palolem beach shack',
        seasonMonths: [10, 11, 12],
        highlights: ['Sunset views', 'Calm backwaters'],
        inclusions: ['Kayak', 'Life jacket'],
        exclusions: ['Snacks'],
        whatToBring: ['Sunscreen'],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [row] = await db
      .select()
      .from(experiences)
      .where(eq(experiences.id, result.experienceId))

    expect(row.difficulty).toBe('moderate')
    expect(row.durationMinutes).toBe(180)
    expect(row.minAge).toBe(10)
    expect(row.maxGroupSize).toBe(6)
    expect(row.languages).toEqual(['en', 'hi'])
    expect(row.meetingPoint).toBe('Palolem beach shack')
    expect(row.seasonMonths).toEqual([10, 11, 12])
    expect(row.highlights).toEqual(['Sunset views', 'Calm backwaters'])
    expect(row.inclusions).toEqual(['Kayak', 'Life jacket'])
    expect(row.exclusions).toEqual(['Snacks'])
    expect(row.whatToBring).toEqual(['Sunscreen'])
  })

  it('persists a supplied itinerary, ordered by stepOrder', async () => {
    const result = await executeCreateExperience(
      db,
      'u_vendor_new',
      validInput({
        itinerary: [
          { title: 'Briefing', durationMinutes: 20 },
          { title: 'Paddle out', durationMinutes: 120 },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const steps = await loadItinerary(db, result.experienceId)
    expect(steps.map((s) => s.title)).toEqual(['Briefing', 'Paddle out'])
    expect(steps[0]!.stepOrder).toBe(0)
    expect(steps[1]!.stepOrder).toBe(1)
  })

  it('rejects a missing title', async () => {
    const result = await executeCreateExperience(
      db,
      'u_vendor_new',
      validInput({ title: '' }),
    )
    expect(result.ok).toBe(false)
  })

  it('rejects a non-positive price', async () => {
    const result = await executeCreateExperience(
      db,
      'u_vendor_new',
      validInput({ pricePerPerson_1_2: 0 }),
    )
    expect(result.ok).toBe(false)
  })

  it('rejects invalid structured input (too many highlights) via the shared Zod schema', async () => {
    const result = await executeCreateExperience(
      db,
      'u_vendor_new',
      validInput({ highlights: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
    )
    expect(result.ok).toBe(false)
  })
})
