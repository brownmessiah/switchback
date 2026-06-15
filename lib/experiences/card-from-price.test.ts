import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiencePricingVariations } from '@/db/schema/experience-pricing-variations'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { loadCardFromPriceResolver } from './card-from-price'

/**
 * Batch "From ₹X" resolver for listing cards (issue #08). Returns, per
 * Experience id, the LOWEST ACTIVE pricing-variation price in whole rupees — or
 * null when the Experience has no active variations (the card then shows the
 * plain base/bracket price). One query for the whole card grid (no N+1).
 */
describe('loadCardFromPriceResolver', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([{ id: 'u_cfp', email: 'cfp@test.com' }])
    await db.insert(vendorProfiles).values({
      userId: 'u_cfp',
      businessName: 'CFP Vendor',
      slug: 'cfp-vendor',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)
  })

  async function seedExp(slug: string): Promise<string> {
    const [row] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_cfp',
        slug,
        title: `Exp ${slug}`,
        activitySlug: 'kayaking',
        regionSlug: 'goa',
        pricePerPerson_1_2: '2500.00',
        pricePerPerson_3_5: '2000.00',
        pricePerPerson_6_plus: '1500.00',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        status: 'published',
      })
      .returning({ id: experiences.id })
    return row!.id
  }

  it('returns the lowest ACTIVE variation price as whole rupees', async () => {
    const expId = await seedExp('cfp-a')
    await db.insert(experiencePricingVariations).values([
      { experienceId: expId, name: 'low', pricePerPerson: '1800.50', isActive: true },
      { experienceId: expId, name: 'high', pricePerPerson: '3200.00', isActive: true },
    ])
    const resolve = await loadCardFromPriceResolver(db, [expId])
    // floor(1800.50) = 1800
    expect(resolve(expId)).toBe(1800)
  })

  it('ignores inactive variations', async () => {
    const expId = await seedExp('cfp-b')
    await db.insert(experiencePricingVariations).values([
      { experienceId: expId, name: 'cheapest-but-off', pricePerPerson: '900.00', isActive: false },
      { experienceId: expId, name: 'active', pricePerPerson: '1500.00', isActive: true },
    ])
    const resolve = await loadCardFromPriceResolver(db, [expId])
    expect(resolve(expId)).toBe(1500)
  })

  it('returns null for an Experience with no active variations', async () => {
    const expId = await seedExp('cfp-c')
    await db.insert(experiencePricingVariations).values([
      { experienceId: expId, name: 'off', pricePerPerson: '900.00', isActive: false },
    ])
    const resolve = await loadCardFromPriceResolver(db, [expId])
    expect(resolve(expId)).toBeNull()
  })

  it('returns null for an Experience with no variations at all', async () => {
    const expId = await seedExp('cfp-d')
    const resolve = await loadCardFromPriceResolver(db, [expId])
    expect(resolve(expId)).toBeNull()
  })

  it('handles an empty id list (returns null for everything)', async () => {
    const resolve = await loadCardFromPriceResolver(db, [])
    expect(resolve('anything')).toBeNull()
  })

  it('scopes from-prices per Experience id', async () => {
    const a = await seedExp('cfp-multi-a')
    const b = await seedExp('cfp-multi-b')
    await db.insert(experiencePricingVariations).values([
      { experienceId: a, name: 'a', pricePerPerson: '1100.00', isActive: true },
      { experienceId: b, name: 'b', pricePerPerson: '2400.00', isActive: true },
    ])
    const resolve = await loadCardFromPriceResolver(db, [a, b])
    expect(resolve(a)).toBe(1100)
    expect(resolve(b)).toBe(2400)
  })
})
