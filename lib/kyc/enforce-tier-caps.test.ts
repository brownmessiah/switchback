import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { assertBookingWithinTier, assertExperienceWithinTier } from './enforce-tier-caps'

/**
 * DB-aware wiring around the pure Tier-2 cap guard (ADR-0007). These tests
 * exercise the "Experience not found" path, which must surface a dedicated
 * EXPERIENCE_NOT_FOUND violation code (it is written verbatim into audit
 * payloads by the callers, so reusing PRICE_OVER_CAP would corrupt them).
 */
describe('enforce-tier-caps DB wiring — missing Experience', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  const MISSING_ID = '00000000-0000-0000-0000-000000000000'

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  it('assertExperienceWithinTier returns EXPERIENCE_NOT_FOUND for a non-existent Experience', async () => {
    const result = await assertExperienceWithinTier(db, MISSING_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('EXPERIENCE_NOT_FOUND')
    }
  })

  it('assertBookingWithinTier returns EXPERIENCE_NOT_FOUND for a non-existent Experience', async () => {
    const result = await assertBookingWithinTier(db, MISSING_ID, {
      startAt: new Date('2026-06-01T09:00:00Z'),
      endAt: new Date('2026-06-01T12:00:00Z'),
      capacity: 4,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('EXPERIENCE_NOT_FOUND')
    }
  })
})

/**
 * Publish-time tier-cap enforcement at the integration layer (ADR-0007).
 *
 * #10 unit-tested the pure guard and the not-found wiring. This suite is
 * the MISSING integration coverage: it seeds a real Vendor + Experience +
 * materialised Availability slots, then runs `assertExperienceWithinTier`
 * end-to-end so the DB-loaded facts (per-person price from the brackets,
 * combo flag, ALL slots from availability_slots) drive each cap arm. This
 * is the publish-time half of "Tier-2 caps asserted at BOTH publish-time
 * and Booking-create" — the booking-create half lives in
 * lib/payments/booking-create.test.ts.
 */
describe('enforce-tier-caps publish-time integration (ADR-0007)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values({ id: 'u_pub_v', email: 'pub-v@example.com' })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE availability_slots, experiences, vendor_profiles CASCADE`,
    )
    await db.insert(vendorProfiles).values({
      userId: 'u_pub_v',
      businessName: 'Publish Test Adventures',
      slug: 'publish-test-adventures',
      kycTier: 'identity',
    })
  })

  async function seedExperience(
    overrides: Partial<{
      pricePerPerson_1_2: string
      pricePerPerson_3_5: string
      pricePerPerson_6_plus: string
      isCombo: boolean
      slug: string
      comboConstituents: string[]
    }> = {},
  ): Promise<string> {
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_pub_v',
        slug: overrides.slug ?? 'publish-rafting',
        title: 'Publish Rafting',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: overrides.pricePerPerson_1_2 ?? '1500.00',
        pricePerPerson_3_5: overrides.pricePerPerson_3_5 ?? '1300.00',
        pricePerPerson_6_plus: overrides.pricePerPerson_6_plus ?? '1100.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        isCombo: overrides.isCombo ?? false,
        comboConstituents: overrides.comboConstituents ?? [],
      })
      .returning({ id: experiences.id })
    return exp!.id
  }

  async function seedSlot(
    experienceId: string,
    startAt: Date,
    endAt: Date,
    capacity: number,
  ): Promise<void> {
    await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt, endAt, capacity })
  }

  it('passes for an identity Vendor whose listing + all slots sit within every Tier-2 cap', async () => {
    const expId = await seedExperience()
    // Two single-day slots, each ≤8 capacity, ≤Rs.5,000/pp.
    await seedSlot(
      expId,
      new Date('2026-06-01T03:30:00Z'),
      new Date('2026-06-01T07:30:00Z'),
      8,
    )
    await seedSlot(
      expId,
      new Date('2026-06-02T03:30:00Z'),
      new Date('2026-06-02T07:30:00Z'),
      6,
    )

    const result = await assertExperienceWithinTier(db, expId)
    expect(result.ok).toBe(true)
  })

  it('rejects publish when ANY materialised slot exceeds the 8-participant cap', async () => {
    const expId = await seedExperience()
    await seedSlot(
      expId,
      new Date('2026-06-01T03:30:00Z'),
      new Date('2026-06-01T07:30:00Z'),
      8,
    )
    // A second slot — loaded from the DB by the wiring — breaks the cap.
    await seedSlot(
      expId,
      new Date('2026-06-02T03:30:00Z'),
      new Date('2026-06-02T07:30:00Z'),
      12,
    )

    const result = await assertExperienceWithinTier(db, expId)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('CAPACITY_OVER_CAP')
  })

  it('rejects publish when the strictest bracket price exceeds Rs.5,000/pp', async () => {
    // The 1-2 bracket is over the cap; the wiring takes the MAX across
    // brackets, so this must reject even though 3-5 / 6+ are under.
    const expId = await seedExperience({
      pricePerPerson_1_2: '6000.00',
      pricePerPerson_3_5: '1300.00',
      pricePerPerson_6_plus: '1100.00',
    })
    await seedSlot(
      expId,
      new Date('2026-06-01T03:30:00Z'),
      new Date('2026-06-01T07:30:00Z'),
      8,
    )

    const result = await assertExperienceWithinTier(db, expId)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('PRICE_OVER_CAP')
  })

  it('rejects publish when a materialised slot spans more than one calendar day', async () => {
    const expId = await seedExperience()
    // A multi-day slot (start 1 Jun, end 2 Jun) — Identity Vendors are
    // single-day only.
    await seedSlot(
      expId,
      new Date('2026-06-01T03:30:00Z'),
      new Date('2026-06-02T07:30:00Z'),
      6,
    )

    const result = await assertExperienceWithinTier(db, expId)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('MULTI_DAY_NOT_ALLOWED')
  })

  it('rejects publish of a Combo Experience for an identity Vendor', async () => {
    // Combo schema CHECK: is_combo=true requires a combo- slug + ≥2 constituents.
    const expId = await seedExperience({
      isCombo: true,
      slug: 'combo-raft-and-camp',
      // combo_constituents is uuid[] (Experience IDs); the CHECK only
      // requires ≥2 entries — the cap guard rejects on the isCombo flag.
      comboConstituents: [crypto.randomUUID(), crypto.randomUUID()],
    })
    await seedSlot(
      expId,
      new Date('2026-06-01T03:30:00Z'),
      new Date('2026-06-01T07:30:00Z'),
      6,
    )

    const result = await assertExperienceWithinTier(db, expId)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('COMBO_NOT_ALLOWED')
  })

  it('passes any listing for a business-verified Vendor regardless of caps', async () => {
    await db
      .update(vendorProfiles)
      .set({ kycTier: 'business' })
      .where(eq(vendorProfiles.userId, 'u_pub_v'))
    const expId = await seedExperience({
      pricePerPerson_1_2: '99000.00',
      pricePerPerson_3_5: '99000.00',
      pricePerPerson_6_plus: '99000.00',
    })
    // Over-cap capacity + multi-day — all waived for Business tier.
    await seedSlot(
      expId,
      new Date('2026-06-01T03:30:00Z'),
      new Date('2026-06-04T07:30:00Z'),
      50,
    )

    const result = await assertExperienceWithinTier(db, expId)
    expect(result.ok).toBe(true)
  })

  it('refuses to publish for a phone-tier Vendor', async () => {
    await db
      .update(vendorProfiles)
      .set({ kycTier: 'phone' })
      .where(eq(vendorProfiles.userId, 'u_pub_v'))
    const expId = await seedExperience()
    await seedSlot(
      expId,
      new Date('2026-06-01T03:30:00Z'),
      new Date('2026-06-01T07:30:00Z'),
      6,
    )

    const result = await assertExperienceWithinTier(db, expId)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('PHONE_CANNOT_PUBLISH')
  })
})
