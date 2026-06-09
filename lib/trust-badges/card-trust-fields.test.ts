import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { loadTrustBadgeFieldResolver } from './card-trust-fields'

/**
 * Batch loader for the per-Experience + per-Vendor data that drives the trust
 * badges (issue 05). One query joins experiences → vendor_profiles, mirroring
 * loadCardBadgeResolver's batch shape (no N+1). The resolver yields safe
 * defaults for ids it has no row for (a bare card derives only the universal
 * Instant Confirmation badge).
 */
describe('loadTrustBadgeFieldResolver (PGlite)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let safeId: string
  let bareId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_v1', email: 'v1@test.com', name: 'V1' },
      { id: 'u_v2', email: 'v2@test.com', name: 'V2' },
    ])
    await db.insert(vendorProfiles).values([
      {
        userId: 'u_v1',
        businessName: 'Business Verified Co',
        slug: 'business-verified-co',
        responseTimeSlaScore: '100.00',
        kycTier: 'business',
      },
      {
        userId: 'u_v2',
        businessName: 'Phone Only Co',
        slug: 'phone-only-co',
        responseTimeSlaScore: '100.00',
        kycTier: 'phone',
      },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE experiences CASCADE`)

    const [safe] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v1',
        slug: 'rafting-safe',
        title: 'Rafting Safe',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront', 'partial_pay'],
        pricePerPerson_1_2: '1500.00',
        pricePerPerson_3_5: '1300.00',
        pricePerPerson_6_plus: '1100.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        requiresSafetyStack: true,
        status: 'published',
      })
      .returning({ id: experiences.id })
    const [bare] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v2',
        slug: 'camping-bare',
        title: 'Camping Bare',
        cancellationPreset: 'strict',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '900.00',
        pricePerPerson_3_5: '900.00',
        pricePerPerson_6_plus: '900.00',
        regionSlug: 'coorg',
        activitySlug: 'camping',
        requiresSafetyStack: false,
        status: 'published',
      })
      .returning({ id: experiences.id })
    safeId = safe!.id
    bareId = bare!.id
  })

  it('resolves the experience + vendor trust fields for a safety/flexible/business listing', async () => {
    const resolve = await loadTrustBadgeFieldResolver(db, [safeId, bareId])
    expect(resolve(safeId)).toEqual({
      vendorKycTier: 'business',
      requiresSafetyStack: true,
      cancellationPreset: 'flexible',
      paymentModesAllowed: ['full_upfront', 'partial_pay'],
    })
  })

  it('resolves the strict/no-safety/phone listing without trust signals', async () => {
    const resolve = await loadTrustBadgeFieldResolver(db, [safeId, bareId])
    expect(resolve(bareId)).toEqual({
      vendorKycTier: 'phone',
      requiresSafetyStack: false,
      cancellationPreset: 'strict',
      paymentModesAllowed: ['full_upfront'],
    })
  })

  it('returns safe defaults for an unknown id (bare card → instant only)', async () => {
    const resolve = await loadTrustBadgeFieldResolver(db, [safeId])
    expect(resolve('00000000-0000-0000-0000-000000000000')).toEqual({
      vendorKycTier: 'phone',
      requiresSafetyStack: false,
      cancellationPreset: 'moderate',
      paymentModesAllowed: [],
    })
  })

  it('returns a default-only resolver for empty ids', async () => {
    const resolve = await loadTrustBadgeFieldResolver(db, [])
    expect(resolve(safeId).vendorKycTier).toBe('phone')
  })
})
