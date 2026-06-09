import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { buildComparisonDataset } from './dataset'

/**
 * The `/compare` dataset builder takes the visitor's compare-selected slugs
 * (from localStorage — UNTRUSTED) and resolves them to per-Experience
 * comparison rows. Every fetch is gated through `lib/experiences/public-filter`
 * (`status='published'` AND non-fixture) so a stale / fixture / unpublished slug
 * NEVER leaks into the comparison (guardrail D0). Selection ORDER is preserved
 * (columns render left-to-right in the order the visitor added listings).
 *
 * The ten compared fields (DECISION D10): price (the three group-size
 * brackets), duration, difficulty, inclusions, cancellation preset, rating, KYC
 * verification, min age, group-size bracket, Vendor.
 */
describe('buildComparisonDataset (PGlite, public-filter gated)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_v1', email: 'v1@test.com', name: 'V1' },
      { id: 'u_v2', email: 'v2@test.com', name: 'V2' },
      { id: 'u_c', email: 'c@test.com', name: 'Customer' },
    ])
    await db.insert(vendorProfiles).values([
      {
        userId: 'u_v1',
        businessName: 'Ganga Rafting Co',
        slug: 'ganga-rafting-co',
        kycTier: 'identity',
        responseTimeSlaScore: '100.00',
      },
      {
        userId: 'u_v2',
        businessName: 'Sky High Adventures',
        slug: 'sky-high-adventures',
        kycTier: 'business',
        responseTimeSlaScore: '100.00',
      },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE reviews, bookings, availability_slots, experiences CASCADE`,
    )
  })

  interface SeedOpts {
    slug: string
    vendorUserId?: string
    status?: 'published' | 'draft' | 'paused' | 'archived'
    difficulty?: 'easy' | 'moderate' | 'challenging' | 'extreme' | null
    cancellationPreset?: 'flexible' | 'moderate' | 'strict' | 'custom'
    durationMinutes?: number | null
    minAge?: number | null
    inclusions?: string[]
    price_1_2?: string
    price_3_5?: string
    price_6_plus?: string
  }

  async function seed(opts: SeedOpts): Promise<string> {
    const [row] = await db
      .insert(experiences)
      .values({
        vendorUserId: opts.vendorUserId ?? 'u_v1',
        slug: opts.slug,
        title: `Title for ${opts.slug}`,
        cancellationPreset: opts.cancellationPreset ?? 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: opts.price_1_2 ?? '1500.00',
        pricePerPerson_3_5: opts.price_3_5 ?? '1300.00',
        pricePerPerson_6_plus: opts.price_6_plus ?? '1100.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        difficulty: opts.difficulty ?? null,
        durationMinutes: opts.durationMinutes ?? null,
        minAge: opts.minAge ?? null,
        inclusions: opts.inclusions ?? [],
        status: opts.status ?? 'published',
      })
      .returning({ id: experiences.id })
    return row!.id
  }

  async function addPublishedReview(
    experienceId: string,
    rating: number,
  ): Promise<void> {
    const startAt = new Date(Date.now() + Math.random() * 1e9)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt, endAt, capacity: 8 })
      .returning({ id: availabilitySlots.id })
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_c',
        experienceId,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'full_upfront',
        state: 'completed',
        grossTotalSnapshot: '3000.00',
        pricePerParticipantSnapshot: '1500.00',
        pricingBasisSnapshot: 'experience_bracket:1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: 'flexible',
        tdsAmountSnapshot: '30.00',
        gstRateOnCommissionSnapshot: '18.00',
        vendorPanSnapshot: 'ABCDE1234F',
        vendorIsResidentSnapshot: true,
        payoutMethodSnapshot: 'upi',
        payoutDestinationSnapshot: { vpa: 'vendor@upi' },
      })
      .returning({ id: bookings.id })
    await db.insert(reviews).values({
      bookingId: booking!.id,
      experienceId,
      customerUserId: 'u_c',
      vendorUserId: 'u_v1',
      rating,
      status: 'published',
    })
  }

  it('returns [] for an empty slug list', async () => {
    expect(await buildComparisonDataset(db, [])).toEqual([])
  })

  it('returns [] when no slug resolves to a publicly-visible Experience', async () => {
    await seed({ slug: 'a-draft', status: 'draft' })
    expect(await buildComparisonDataset(db, ['a-draft', 'does-not-exist'])).toEqual([])
  })

  it('builds one comparison row per selected, publicly-visible Experience', async () => {
    await seed({ slug: 'rafting-rishikesh' })
    await seed({ slug: 'bungee-rishikesh' })
    const rows = await buildComparisonDataset(db, ['rafting-rishikesh', 'bungee-rishikesh'])
    expect(rows.map((r) => r.slug)).toEqual(['rafting-rishikesh', 'bungee-rishikesh'])
  })

  it('preserves the selection order (columns render in add-order)', async () => {
    await seed({ slug: 'a' })
    await seed({ slug: 'b' })
    await seed({ slug: 'c' })
    const rows = await buildComparisonDataset(db, ['c', 'a', 'b'])
    expect(rows.map((r) => r.slug)).toEqual(['c', 'a', 'b'])
  })

  it('EXCLUDES a draft slug (no D0 leak)', async () => {
    await seed({ slug: 'published-one' })
    await seed({ slug: 'draft-one', status: 'draft' })
    const rows = await buildComparisonDataset(db, ['published-one', 'draft-one'])
    expect(rows.map((r) => r.slug)).toEqual(['published-one'])
  })

  it('EXCLUDES a published-but-fixture slug (no D0 leak)', async () => {
    await seed({ slug: 'published-one' })
    // A real published fixture slug from FIXTURE_EXPERIENCE_SLUGS.
    await seed({ slug: 'refund-queue-fixture-rishikesh', status: 'published' })
    const rows = await buildComparisonDataset(db, [
      'published-one',
      'refund-queue-fixture-rishikesh',
    ])
    expect(rows.map((r) => r.slug)).toEqual(['published-one'])
  })

  it('carries all ten compared fields for an Experience', async () => {
    const id = await seed({
      slug: 'rafting-rishikesh',
      vendorUserId: 'u_v1',
      difficulty: 'moderate',
      cancellationPreset: 'flexible',
      durationMinutes: 240,
      minAge: 12,
      inclusions: ['Helmet', 'Life jacket', 'Guide'],
      price_1_2: '2000.00',
      price_3_5: '1800.00',
      price_6_plus: '1600.00',
    })
    await addPublishedReview(id, 5)
    await addPublishedReview(id, 4)

    const [row] = await buildComparisonDataset(db, ['rafting-rishikesh'])
    expect(row).toBeDefined()

    // 1. price — the three group-size brackets (ADR-0011), in rupees.
    expect(row!.priceBrackets).toEqual({ from1to2: 2000, from3to5: 1800, from6plus: 1600 })
    // 2. duration — raw minutes (the page formats via formatDuration).
    expect(row!.durationMinutes).toBe(240)
    // 3. difficulty enum (nullable).
    expect(row!.difficulty).toBe('moderate')
    // 4. inclusions text[] (nullable/empty).
    expect(row!.inclusions).toEqual(['Helmet', 'Life jacket', 'Guide'])
    // 5. cancellation preset enum — NEVER "free".
    expect(row!.cancellationPreset).toBe('flexible')
    // 6. rating — published-review aggregate.
    expect(row!.ratingAvg).toBe(4.5)
    expect(row!.ratingCount).toBe(2)
    // 7. KYC verification — vendor kyc tier.
    expect(row!.vendorKycTier).toBe('identity')
    // 8. min age (nullable).
    expect(row!.minAge).toBe(12)
    // 9. group-size bracket — implicit in priceBrackets keys (1-2 / 3-5 / 6+).
    expect(Object.keys(row!.priceBrackets)).toEqual(['from1to2', 'from3to5', 'from6plus'])
    // 10. Vendor — display name + storefront slug.
    expect(row!.vendorName).toBe('Ganga Rafting Co')
    expect(row!.vendorSlug).toBe('ganga-rafting-co')

    // Identity columns.
    expect(row!.slug).toBe('rafting-rishikesh')
    expect(row!.title).toBe('Title for rafting-rishikesh')
  })

  it('handles nullable / empty fields without throwing (bare Experience)', async () => {
    await seed({
      slug: 'bare',
      difficulty: null,
      durationMinutes: null,
      minAge: null,
      inclusions: [],
    })
    const [row] = await buildComparisonDataset(db, ['bare'])
    expect(row!.difficulty).toBeNull()
    expect(row!.durationMinutes).toBeNull()
    expect(row!.minAge).toBeNull()
    expect(row!.inclusions).toEqual([])
    // No published reviews → no rating.
    expect(row!.ratingAvg).toBeNull()
    expect(row!.ratingCount).toBe(0)
  })

  it('reflects each vendor’s own KYC tier across multiple columns', async () => {
    await seed({ slug: 'by-v1', vendorUserId: 'u_v1' }) // identity
    await seed({ slug: 'by-v2', vendorUserId: 'u_v2' }) // business
    const rows = await buildComparisonDataset(db, ['by-v1', 'by-v2'])
    const byV1 = rows.find((r) => r.slug === 'by-v1')
    const byV2 = rows.find((r) => r.slug === 'by-v2')
    expect(byV1!.vendorKycTier).toBe('identity')
    expect(byV2!.vendorKycTier).toBe('business')
  })

  it('caps the dataset at the compare maximum (defensive — storage already caps)', async () => {
    await seed({ slug: 'a' })
    await seed({ slug: 'b' })
    await seed({ slug: 'c' })
    await seed({ slug: 'd' })
    const rows = await buildComparisonDataset(db, ['a', 'b', 'c', 'd'])
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.slug)).toEqual(['a', 'b', 'c'])
  })
})
