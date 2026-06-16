import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiencePricingVariations } from '@/db/schema/experience-pricing-variations'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  loadPricingVariations,
  replacePricingVariations,
} from './pricing-variations-write'

/**
 * Ownership-safe upsert for the per-Experience pricing variations (issue #08).
 * `replacePricingVariations` inserts new rows (no id), updates existing rows
 * (by id, scoped to the Experience), and deletes rows that the form dropped —
 * all inside the caller's transaction. A variation id belonging to ANOTHER
 * Experience can never be moved or updated (never trust a client id).
 */
describe('replacePricingVariations', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([{ id: 'u_pv', email: 'pv-vendor@test.com' }])
    await db.insert(vendorProfiles).values({
      userId: 'u_pv',
      businessName: 'PV Vendor',
      slug: 'pv-vendor',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)
  })

  async function seedExperience(slug: string): Promise<string> {
    const [row] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_pv',
        slug,
        title: `Exp ${slug}`,
        activitySlug: 'kayaking',
        regionSlug: 'goa',
        pricePerPerson_1_2: '2500.00',
        pricePerPerson_3_5: '2000.00',
        pricePerPerson_6_plus: '1500.00',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        status: 'draft',
      })
      .returning({ id: experiences.id })
    return row!.id
  }

  it('inserts new variation rows (no id)', async () => {
    const expId = await seedExperience('exp-insert')
    await db.transaction((tx) =>
      replacePricingVariations(tx, expId, [
        {
          name: 'Sunrise batch',
          description: 'Early morning',
          pricePerPerson: '1800.00',
          durationMinutes: 90,
          isActive: true,
        },
        {
          name: 'Private session',
          description: null,
          pricePerPerson: '4200.00',
          durationMinutes: null,
          isActive: false,
        },
      ]),
    )

    const rows = await loadPricingVariations(db, expId)
    expect(rows).toHaveLength(2)
    const byName = new Map(rows.map((r) => [r.name, r]))
    expect(byName.get('Sunrise batch')?.pricePerPerson).toBe('1800.00')
    expect(byName.get('Sunrise batch')?.durationMinutes).toBe(90)
    expect(byName.get('Sunrise batch')?.isActive).toBe(true)
    expect(byName.get('Private session')?.isActive).toBe(false)
    expect(byName.get('Private session')?.description).toBeNull()
  })

  it('updates an existing variation by id and deletes the ones removed', async () => {
    const expId = await seedExperience('exp-upsert')
    await db.transaction((tx) =>
      replacePricingVariations(tx, expId, [
        { name: 'A', description: null, pricePerPerson: '1000.00', durationMinutes: null, isActive: true },
        { name: 'B', description: null, pricePerPerson: '2000.00', durationMinutes: null, isActive: true },
      ]),
    )
    const seeded = await loadPricingVariations(db, expId)
    const aId = seeded.find((r) => r.name === 'A')!.id

    // Keep A (renamed + repriced), drop B, add a brand-new C.
    await db.transaction((tx) =>
      replacePricingVariations(tx, expId, [
        { id: aId, name: 'A renamed', description: 'now described', pricePerPerson: '1100.00', durationMinutes: 60, isActive: false },
        { name: 'C', description: null, pricePerPerson: '3000.00', durationMinutes: null, isActive: true },
      ]),
    )

    const rows = await loadPricingVariations(db, expId)
    expect(rows.map((r) => r.name).sort()).toEqual(['A renamed', 'C'])
    const a = rows.find((r) => r.id === aId)
    expect(a?.name).toBe('A renamed')
    expect(a?.pricePerPerson).toBe('1100.00')
    expect(a?.durationMinutes).toBe(60)
    expect(a?.isActive).toBe(false)
    // The dropped B is gone.
    expect(rows.find((r) => r.name === 'B')).toBeUndefined()
  })

  it('clears all variations when passed an empty list', async () => {
    const expId = await seedExperience('exp-clear')
    await db.transaction((tx) =>
      replacePricingVariations(tx, expId, [
        { name: 'A', description: null, pricePerPerson: '1000.00', durationMinutes: null, isActive: true },
      ]),
    )
    await db.transaction((tx) => replacePricingVariations(tx, expId, []))
    expect(await loadPricingVariations(db, expId)).toHaveLength(0)
  })

  it('NEVER updates a variation id belonging to another Experience (ownership)', async () => {
    const expA = await seedExperience('exp-owner-a')
    const expB = await seedExperience('exp-owner-b')

    // A owns one variation.
    await db.transaction((tx) =>
      replacePricingVariations(tx, expA, [
        { name: 'A-var', description: null, pricePerPerson: '1000.00', durationMinutes: null, isActive: true },
      ]),
    )
    const aVarId = (await loadPricingVariations(db, expA))[0]!.id

    // B's form maliciously sends A's variation id. The id must NOT be hijacked:
    // A's row stays untouched (still owned by A), and B gets a fresh row.
    await db.transaction((tx) =>
      replacePricingVariations(tx, expB, [
        { id: aVarId, name: 'stolen', description: null, pricePerPerson: '9999.00', durationMinutes: null, isActive: true },
      ]),
    )

    // A's variation is unchanged and still belongs to A.
    const aRows = await loadPricingVariations(db, expA)
    expect(aRows).toHaveLength(1)
    expect(aRows[0]!.id).toBe(aVarId)
    expect(aRows[0]!.name).toBe('A-var')
    expect(aRows[0]!.pricePerPerson).toBe('1000.00')

    // B got a brand-new variation (a different id), priced as sent.
    const bRows = await loadPricingVariations(db, expB)
    expect(bRows).toHaveLength(1)
    expect(bRows[0]!.id).not.toBe(aVarId)
    expect(bRows[0]!.name).toBe('stolen')

    // Direct DB check: A's row is still owned by expA.
    const [stillA] = await db
      .select({ experienceId: experiencePricingVariations.experienceId })
      .from(experiencePricingVariations)
      .where(eq(experiencePricingVariations.id, aVarId))
    expect(stillA?.experienceId).toBe(expA)
  })
})
