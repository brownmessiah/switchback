import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { experiencePricingVariations } from '@/db/schema/experience-pricing-variations'
import { pricingTiers } from '@/db/schema/pricing-tiers'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { resolvePricing } from './pricing-resolver'

/**
 * Pricing resolution chain per ADR-0011.
 *
 *   1. Active pricing tier override (pricing_tiers, time-windowed, scoped)
 *   2. Slot-specific override (not yet implemented; deferred to v1.x)
 *   3. Experience tier-based price (group-size brackets 1-2 / 3-5 / 6+)
 *   4. Experience base price (the 1-2 bracket serves as the floor)
 *
 * Snapshotted onto bookings.price_per_participant_snapshot + pricing_basis_snapshot.
 */
describe('resolvePricing (ADR-0011)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string

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
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'rafting-day',
        title: 'Rafting Day',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        // Tiered pricing — distinct brackets so the bracket selection is
        // observable in tests.
        pricePerPerson_1_2: '2000.00',
        pricePerPerson_3_5: '1500.00',
        pricePerPerson_6_plus: '1200.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    experienceId = exp!.id
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE pricing_tiers, experience_pricing_variations`)
  })

  describe('group-size brackets', () => {
    it('uses price_per_person_1_2 for participantCount=1', async () => {
      const r = await resolvePricing(db, { experienceId, participantCount: 1 })
      expect(r.pricePerParticipant).toBe('2000.00')
      expect(r.basis).toBe('experience_bracket:1_2')
    })

    it('uses price_per_person_1_2 for participantCount=2', async () => {
      const r = await resolvePricing(db, { experienceId, participantCount: 2 })
      expect(r.pricePerParticipant).toBe('2000.00')
      expect(r.basis).toBe('experience_bracket:1_2')
    })

    it('uses price_per_person_3_5 for participantCount=3', async () => {
      const r = await resolvePricing(db, { experienceId, participantCount: 3 })
      expect(r.pricePerParticipant).toBe('1500.00')
      expect(r.basis).toBe('experience_bracket:3_5')
    })

    it('uses price_per_person_3_5 for participantCount=5', async () => {
      const r = await resolvePricing(db, { experienceId, participantCount: 5 })
      expect(r.pricePerParticipant).toBe('1500.00')
      expect(r.basis).toBe('experience_bracket:3_5')
    })

    it('uses price_per_person_6_plus for participantCount=6', async () => {
      const r = await resolvePricing(db, { experienceId, participantCount: 6 })
      expect(r.pricePerParticipant).toBe('1200.00')
      expect(r.basis).toBe('experience_bracket:6_plus')
    })

    it('uses price_per_person_6_plus for participantCount=20', async () => {
      const r = await resolvePricing(db, { experienceId, participantCount: 20 })
      expect(r.pricePerParticipant).toBe('1200.00')
      expect(r.basis).toBe('experience_bracket:6_plus')
    })
  })

  describe('pricing tier overrides', () => {
    const baseStart = new Date('2026-09-01T00:00:00Z')
    const baseEnd = new Date('2026-09-30T23:59:59Z')
    const now = new Date('2026-09-15T12:00:00Z')

    it('matches an active all-scope pricing tier and overrides the bracket', async () => {
      await db.insert(pricingTiers).values({
        name: 'monsoon_2026',
        startAt: baseStart,
        endAt: baseEnd,
        pricePerPersonOverride: '999.00',
        reason: 'Monsoon promo',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolvePricing(db, {
        experienceId,
        participantCount: 1,
        now,
      })
      expect(r.pricePerParticipant).toBe('999.00')
      expect(r.basis).toBe('pricing_tier:monsoon_2026')
    })

    it('pricing tier scoped to a different category does not fire', async () => {
      await db.insert(pricingTiers).values({
        name: 'paragliding_promo',
        startAt: baseStart,
        endAt: baseEnd,
        appliesToCategories: ['paragliding'],
        pricePerPersonOverride: '500.00',
        reason: 'Other category',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolvePricing(db, {
        experienceId,
        participantCount: 1,
        now,
      })
      expect(r.basis).toBe('experience_bracket:1_2')
    })

    it('pricing tier scoped to the experience id fires', async () => {
      await db.insert(pricingTiers).values({
        name: 'this_experience_only',
        startAt: baseStart,
        endAt: baseEnd,
        appliesToExperienceIds: [experienceId],
        pricePerPersonOverride: '750.00',
        reason: 'Targeted promo',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolvePricing(db, {
        experienceId,
        participantCount: 4,
        now,
      })
      expect(r.pricePerParticipant).toBe('750.00')
      expect(r.basis).toBe('pricing_tier:this_experience_only')
    })

    it('expired pricing tier does not fire', async () => {
      await db.insert(pricingTiers).values({
        name: 'last_month',
        startAt: new Date('2026-08-01T00:00:00Z'),
        endAt: new Date('2026-08-31T23:59:59Z'),
        pricePerPersonOverride: '99.00',
        reason: 'Expired',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolvePricing(db, {
        experienceId,
        participantCount: 1,
        now,
      })
      expect(r.basis).toBe('experience_bracket:1_2')
    })

    it('future pricing tier does not fire', async () => {
      await db.insert(pricingTiers).values({
        name: 'next_month',
        startAt: new Date('2026-10-01T00:00:00Z'),
        endAt: new Date('2026-10-31T23:59:59Z'),
        pricePerPersonOverride: '99.00',
        reason: 'Future',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolvePricing(db, {
        experienceId,
        participantCount: 1,
        now,
      })
      expect(r.basis).toBe('experience_bracket:1_2')
    })

    it('most recently created pricing tier wins when multiple match', async () => {
      await db.insert(pricingTiers).values({
        name: 'tier_a',
        startAt: baseStart,
        endAt: baseEnd,
        pricePerPersonOverride: '900.00',
        reason: 'First',
        createdByAdminUserId: 'u_v',
      })
      await new Promise((r) => setTimeout(r, 10))
      await db.insert(pricingTiers).values({
        name: 'tier_b',
        startAt: baseStart,
        endAt: baseEnd,
        pricePerPersonOverride: '800.00',
        reason: 'Second (most recent)',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolvePricing(db, {
        experienceId,
        participantCount: 1,
        now,
      })
      expect(r.pricePerParticipant).toBe('800.00')
      expect(r.basis).toBe('pricing_tier:tier_b')
    })

    it('pricing tier scoped to a different vendor does not fire', async () => {
      await db.insert(pricingTiers).values({
        name: 'other_vendor_promo',
        startAt: baseStart,
        endAt: baseEnd,
        appliesToVendorIds: ['u_other'],
        pricePerPersonOverride: '500.00',
        reason: 'Other vendor',
        createdByAdminUserId: 'u_v',
      })
      const r = await resolvePricing(db, {
        experienceId,
        participantCount: 1,
        now,
      })
      expect(r.basis).toBe('experience_bracket:1_2')
    })
  })

  describe('pricing variations (ADR-0011 revision 2026-06-16, issue #07)', () => {
    // An active pricing-tier window that WOULD fire if the variation arm did
    // not win — used to prove the variation is TOP precedence (arm 0).
    const tierStart = new Date('2026-09-01T00:00:00Z')
    const tierEnd = new Date('2026-09-30T23:59:59Z')
    const duringTier = new Date('2026-09-15T12:00:00Z')

    async function seedVariation(values: {
      experienceId: string
      name: string
      pricePerPerson: string
      isActive?: boolean
    }): Promise<string> {
      const [v] = await db
        .insert(experiencePricingVariations)
        .values({
          experienceId: values.experienceId,
          name: values.name,
          pricePerPerson: values.pricePerPerson,
          isActive: values.isActive ?? true,
        })
        .returning({ id: experiencePricingVariations.id })
      return v!.id
    }

    it('a valid active variation wins and is the resolved price', async () => {
      const variationId = await seedVariation({
        experienceId,
        name: 'Private session',
        pricePerPerson: '5000.00',
      })
      const r = await resolvePricing(db, {
        experienceId,
        participantCount: 2,
        variationId,
      })
      expect(r.pricePerParticipant).toBe('5000.00')
      expect(r.basis).toBe(`pricing_variation:${variationId}`)
    })

    it('a variation wins OVER an active pricing tier (top precedence, arm 0)', async () => {
      await db.insert(pricingTiers).values({
        name: 'monsoon_2026',
        startAt: tierStart,
        endAt: tierEnd,
        pricePerPersonOverride: '999.00',
        reason: 'Monsoon promo',
        createdByAdminUserId: 'u_v',
      })
      const variationId = await seedVariation({
        experienceId,
        name: 'Sunrise batch',
        pricePerPerson: '5000.00',
      })
      // `now` falls inside the tier window, so the tier WOULD fire absent the
      // variation. The variation must still win.
      const r = await resolvePricing(db, {
        experienceId,
        participantCount: 1,
        variationId,
        now: duringTier,
      })
      expect(r.pricePerParticipant).toBe('5000.00')
      expect(r.basis).toBe(`pricing_variation:${variationId}`)
    })

    it('rejects a variation belonging to ANOTHER experience', async () => {
      // A second experience under the same vendor with its own variation.
      const [otherExp] = await db
        .insert(experiences)
        .values({
          vendorUserId: 'u_v',
          slug: 'kayak-day',
          title: 'Kayak Day',
          cancellationPreset: 'flexible',
          paymentModesAllowed: ['full_upfront'],
          pricePerPerson_1_2: '3000.00',
          pricePerPerson_3_5: '2500.00',
          pricePerPerson_6_plus: '2000.00',
          regionSlug: 'rishikesh',
          activitySlug: 'kayaking',
        })
        .returning({ id: experiences.id })
      const foreignVariationId = await seedVariation({
        experienceId: otherExp!.id,
        name: 'Foreign',
        pricePerPerson: '4000.00',
      })
      await expect(
        resolvePricing(db, {
          experienceId,
          participantCount: 1,
          variationId: foreignVariationId,
        }),
      ).rejects.toThrow(/not valid for experience/i)
      // Clean up the extra experience so the shared fixture stays intact.
      await db.execute(sql`DELETE FROM experiences WHERE slug = 'kayak-day'`)
    })

    it('rejects an INACTIVE variation', async () => {
      const inactiveId = await seedVariation({
        experienceId,
        name: 'Retired option',
        pricePerPerson: '5000.00',
        isActive: false,
      })
      await expect(
        resolvePricing(db, {
          experienceId,
          participantCount: 1,
          variationId: inactiveId,
        }),
      ).rejects.toThrow(/not active/i)
    })

    it('rejects an unknown variationId', async () => {
      await expect(
        resolvePricing(db, {
          experienceId,
          participantCount: 1,
          variationId: '00000000-0000-0000-0000-000000000abc',
        }),
      ).rejects.toThrow(/not valid for experience/i)
    })

    it('with no variationId the group-size bracket still resolves (regression)', async () => {
      // A variation EXISTS on the experience but no variationId is passed, so
      // resolution falls through to the bracket exactly as before.
      await seedVariation({
        experienceId,
        name: 'Unused',
        pricePerPerson: '5000.00',
      })
      const r = await resolvePricing(db, { experienceId, participantCount: 4 })
      expect(r.pricePerParticipant).toBe('1500.00')
      expect(r.basis).toBe('experience_bracket:3_5')
    })
  })

  describe('input validation', () => {
    it('throws when experience does not exist', async () => {
      await expect(
        resolvePricing(db, {
          experienceId: '00000000-0000-0000-0000-000000000999',
          participantCount: 1,
        }),
      ).rejects.toThrow(/not found/i)
    })

    it('rejects participantCount <= 0', async () => {
      await expect(
        resolvePricing(db, { experienceId, participantCount: 0 }),
      ).rejects.toThrow(/participant/i)

      await expect(
        resolvePricing(db, { experienceId, participantCount: -1 }),
      ).rejects.toThrow(/participant/i)
    })
  })
})
