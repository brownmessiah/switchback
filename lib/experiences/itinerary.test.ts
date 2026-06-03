import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { loadItinerary, replaceItinerary } from './itinerary'

describe('Experience itinerary loader (ADR-0017)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values({ id: 'u_vendor', email: 'vendor@test.com' })
    await db.insert(vendorProfiles).values({
      userId: 'u_vendor',
      businessName: 'Rishikesh Adventures',
      slug: 'rishikesh-adventures',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)
  })

  async function seedExperience(slug = 'itinerary-exp'): Promise<string> {
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_vendor',
        slug,
        title: 'Itinerary Experience',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '2500.00',
        pricePerPerson_3_5: '2200.00',
        pricePerPerson_6_plus: '1900.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'published',
      })
      .returning({ id: experiences.id })
    return exp!.id
  }

  it('returns an empty array for an Experience with no steps', async () => {
    const id = await seedExperience()
    expect(await loadItinerary(db, id)).toEqual([])
  })

  it('writes steps and loads them ordered by stepOrder', async () => {
    const id = await seedExperience()
    await replaceItinerary(db, id, [
      { title: 'Briefing' },
      { title: 'Rapids', description: 'Grade III', durationMinutes: 90 },
      { title: 'Debrief', dayOffset: 0 },
    ])

    const steps = await loadItinerary(db, id)
    expect(steps.map((s) => s.title)).toEqual(['Briefing', 'Rapids', 'Debrief'])
    expect(steps.map((s) => s.stepOrder)).toEqual([0, 1, 2])
    expect(steps[1]!.description).toBe('Grade III')
    expect(steps[1]!.durationMinutes).toBe(90)
  })

  it('idempotently replaces existing steps, leaving none of the old ones', async () => {
    const id = await seedExperience()
    await replaceItinerary(db, id, [
      { title: 'Old A' },
      { title: 'Old B' },
      { title: 'Old C' },
    ])

    await replaceItinerary(db, id, [{ title: 'New A' }, { title: 'New B' }])

    const steps = await loadItinerary(db, id)
    expect(steps.map((s) => s.title)).toEqual(['New A', 'New B'])
    expect(steps.map((s) => s.stepOrder)).toEqual([0, 1])
  })

  it('clears the itinerary when replaced with an empty array', async () => {
    const id = await seedExperience()
    await replaceItinerary(db, id, [{ title: 'Step 1' }, { title: 'Step 2' }])

    await replaceItinerary(db, id, [])

    expect(await loadItinerary(db, id)).toEqual([])
  })

  it('scopes loaded steps to the given Experience', async () => {
    const a = await seedExperience('exp-a')
    const b = await seedExperience('exp-b')
    await replaceItinerary(db, a, [{ title: 'A only' }])
    await replaceItinerary(db, b, [{ title: 'B only' }])

    const stepsA = await loadItinerary(db, a)
    expect(stepsA.map((s) => s.title)).toEqual(['A only'])
  })
})
