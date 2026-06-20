import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { isFilteredSearch, searchExperiences } from './search-experiences'

/**
 * Postgres-native search contract (ADR-0019, amends ADR-0013). Meilisearch is
 * retired; `searchExperiences` now serves the same `{ hits }` result set from
 * Postgres FTS (`tsvector` + GIN) + `pg_trgm` over title + short_description,
 * with SQL WHERE/ORDER BY for every facet/sort the customer search form emits.
 *
 * These tests assert the EXTERNAL contract (real rows in → correct hits out)
 * against PGlite — never the SQL shape. Prior art: lib/experiences/similar.test.ts.
 */

describe('isFilteredSearch', () => {
  it('returns true when any legacy filter param is set', () => {
    expect(isFilteredSearch({ activity: 'rafting' })).toBe(true)
    expect(isFilteredSearch({ minPrice: 1000 })).toBe(true)
    expect(isFilteredSearch({ sort: 'price_asc' })).toBe(true)
  })

  it('returns true when only a structured facet is set (ADR-0017)', () => {
    expect(isFilteredSearch({ difficulty: 'moderate' })).toBe(true)
    expect(isFilteredSearch({ durationBand: 'half_day' })).toBe(true)
    expect(isFilteredSearch({ seasonMonth: 6 })).toBe(true)
    expect(isFilteredSearch({ maxGroupSize: 8 })).toBe(true)
  })

  it('returns true when only category or only state is set', () => {
    expect(isFilteredSearch({ category: 'water' })).toBe(true)
    expect(isFilteredSearch({ state: 'Goa' })).toBe(true)
  })

  it('returns true when only a trust filter is set', () => {
    expect(isFilteredSearch({ minRating: 4 })).toBe(true)
    expect(isFilteredSearch({ safetyVerified: true })).toBe(true)
    expect(isFilteredSearch({ cancellation: 'flexible' })).toBe(true)
  })

  it('returns false when safetyVerified is explicitly false', () => {
    expect(isFilteredSearch({ safetyVerified: false })).toBe(false)
  })

  it('returns false when only q is set', () => {
    expect(isFilteredSearch({ q: 'rafting' })).toBe(false)
  })

  it('returns false when no params are set', () => {
    expect(isFilteredSearch({})).toBe(false)
  })
})

describe('searchExperiences (Postgres-native, PGlite)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_v', email: 'vendor@test.com', name: 'Vendor' },
      { id: 'u_c', email: 'customer@test.com', name: 'Customer' },
    ])
    await db.insert(vendorProfiles).values([
      {
        userId: 'u_v',
        businessName: 'Test Adventures',
        slug: 'test-adventures',
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
    title?: string
    shortDescription?: string | null
    activitySlug?: string
    regionSlug?: string
    price12?: string
    status?: 'published' | 'draft' | 'pending_review' | 'paused' | 'archived'
    difficulty?: 'easy' | 'moderate' | 'challenging' | 'extreme' | null
    durationMinutes?: number | null
    maxGroupSize?: number | null
    seasonMonths?: number[]
    requiresSafetyStack?: boolean
    cancellationPreset?: 'flexible' | 'moderate' | 'strict' | 'non_cancellable' | 'custom'
    updatedAt?: Date
  }

  async function seed(opts: SeedOpts): Promise<string> {
    const [row] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: opts.slug,
        title: opts.title ?? `Experience ${opts.slug}`,
        shortDescription: opts.shortDescription ?? null,
        cancellationPreset: opts.cancellationPreset ?? 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: opts.price12 ?? '1500.00',
        pricePerPerson_3_5: '1300.00',
        pricePerPerson_6_plus: '1100.00',
        regionSlug: opts.regionSlug ?? 'rishikesh',
        activitySlug: opts.activitySlug ?? 'rafting',
        difficulty: opts.difficulty ?? null,
        durationMinutes: opts.durationMinutes ?? null,
        maxGroupSize: opts.maxGroupSize ?? null,
        seasonMonths: opts.seasonMonths ?? [],
        requiresSafetyStack: opts.requiresSafetyStack ?? false,
        status: opts.status ?? 'published',
        ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
      })
      .returning({ id: experiences.id })
    return row!.id
  }

  let slotSeq = 0
  async function addPublishedReview(experienceId: string, rating: number): Promise<void> {
    slotSeq += 1
    const startAt = new Date(Date.now() + slotSeq * 24 * 60 * 60 * 1000)
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
      customerUserId: 'u_c',
      experienceId,
      vendorUserId: 'u_v',
      rating,
      status: 'published',
    })
  }

  async function slugs(params: Parameters<typeof searchExperiences>[0]): Promise<string[]> {
    const { hits } = await searchExperiences(params, { db })
    return hits.map((h) => h.slug)
  }

  // ── Visibility ──────────────────────────────────────────────────────

  it('returns all publicly-visible experiences for an empty query', async () => {
    await seed({ slug: 'a' })
    await seed({ slug: 'b' })
    const result = await slugs({})
    expect(result.sort()).toEqual(['a', 'b'])
  })

  it('excludes non-published (draft / pending / paused / archived) experiences', async () => {
    await seed({ slug: 'published-one', status: 'published' })
    await seed({ slug: 'draft-one', status: 'draft' })
    await seed({ slug: 'pending-one', status: 'pending_review' })
    await seed({ slug: 'paused-one', status: 'paused' })
    await seed({ slug: 'archived-one', status: 'archived' })
    expect(await slugs({})).toEqual(['published-one'])
  })

  it('excludes published-but-fixture experiences (D0 leak hardening)', async () => {
    await seed({ slug: 'real-one' })
    await seed({ slug: 'refund-queue-fixture-rishikesh', status: 'published' })
    expect(await slugs({})).toEqual(['real-one'])
  })

  // ── Full-text query ─────────────────────────────────────────────────

  it('matches the q text query over the title', async () => {
    await seed({ slug: 'rafting-trip', title: 'White Water Rafting in Rishikesh' })
    await seed({ slug: 'para-trip', title: 'Tandem Paragliding in Bir Billing' })
    expect(await slugs({ q: 'rafting' })).toEqual(['rafting-trip'])
  })

  it('matches the q text query over the short description', async () => {
    await seed({
      slug: 'kayak-trip',
      title: 'River Adventure',
      shortDescription: 'A guided kayaking descent through grade III rapids',
    })
    await seed({ slug: 'other-trip', title: 'Mountain Walk', shortDescription: 'A gentle stroll' })
    expect(await slugs({ q: 'kayaking' })).toEqual(['kayak-trip'])
  })

  it('is prefix-tolerant (raft → rafting)', async () => {
    await seed({ slug: 'rafting-trip', title: 'White Water Rafting in Rishikesh' })
    await seed({ slug: 'walk-trip', title: 'Easy Valley Walk' })
    expect(await slugs({ q: 'raft' })).toEqual(['rafting-trip'])
  })

  it('is typo-tolerant via trigram similarity (rafing → rafting)', async () => {
    await seed({ slug: 'rafting-trip', title: 'White Water Rafting in Rishikesh' })
    await seed({ slug: 'walk-trip', title: 'Easy Valley Walk' })
    expect(await slugs({ q: 'rafing' })).toEqual(['rafting-trip'])
  })

  // ── Filters ─────────────────────────────────────────────────────────

  it('filters by activity slug', async () => {
    await seed({ slug: 'r1', activitySlug: 'rafting' })
    await seed({ slug: 'p1', activitySlug: 'paragliding' })
    expect(await slugs({ activity: 'paragliding' })).toEqual(['p1'])
  })

  it('filters by region slug', async () => {
    await seed({ slug: 'rish', regionSlug: 'rishikesh' })
    await seed({ slug: 'goa1', regionSlug: 'goa' })
    expect(await slugs({ region: 'goa' })).toEqual(['goa1'])
  })

  it('filters by min and max price (headline 1-2 bracket)', async () => {
    await seed({ slug: 'cheap', price12: '800.00' })
    await seed({ slug: 'mid', price12: '2000.00' })
    await seed({ slug: 'dear', price12: '9000.00' })
    expect((await slugs({ minPrice: 1000, maxPrice: 5000 }))).toEqual(['mid'])
  })

  it('filters by difficulty', async () => {
    await seed({ slug: 'easy1', difficulty: 'easy' })
    await seed({ slug: 'hard1', difficulty: 'challenging' })
    await seed({ slug: 'bare1', difficulty: null })
    expect(await slugs({ difficulty: 'challenging' })).toEqual(['hard1'])
  })

  it('filters by duration band as a minutes range; bare experiences drop out', async () => {
    await seed({ slug: 'short1', durationMinutes: 120 }) // upto_3h
    await seed({ slug: 'half1', durationMinutes: 300 }) // half_day (181-360)
    await seed({ slug: 'full1', durationMinutes: 600 }) // full_day
    await seed({ slug: 'multi1', durationMinutes: 2000 }) // multi_day
    await seed({ slug: 'bare1', durationMinutes: null })
    expect((await slugs({ durationBand: 'half_day' }))).toEqual(['half1'])
    expect((await slugs({ durationBand: 'multi_day' }))).toEqual(['multi1'])
  })

  it('filters by season month (array membership)', async () => {
    await seed({ slug: 'summer', seasonMonths: [4, 5, 6] })
    await seed({ slug: 'winter', seasonMonths: [11, 12, 1] })
    await seed({ slug: 'always', seasonMonths: [] })
    expect(await slugs({ seasonMonth: 6 })).toEqual(['summer'])
  })

  it('filters by maxGroupSize as a "fits a group of N" lower bound; null group size drops out', async () => {
    await seed({ slug: 'big', maxGroupSize: 12 })
    await seed({ slug: 'small', maxGroupSize: 4 })
    await seed({ slug: 'unset', maxGroupSize: null })
    expect((await slugs({ maxGroupSize: 8 }))).toEqual(['big'])
  })

  it('filters by category (activity-category rollup)', async () => {
    await seed({ slug: 'rafting1', activitySlug: 'rafting' }) // water
    await seed({ slug: 'scuba1', activitySlug: 'scuba-diving' }) // water
    await seed({ slug: 'para1', activitySlug: 'paragliding' }) // aerial
    expect((await slugs({ category: 'water' })).sort()).toEqual(['rafting1', 'scuba1'])
  })

  it('filters by state (region rollup)', async () => {
    await seed({ slug: 'manali1', regionSlug: 'manali' }) // Himachal Pradesh
    await seed({ slug: 'kasol1', regionSlug: 'kasol' }) // Himachal Pradesh
    await seed({ slug: 'goa1', regionSlug: 'goa' }) // Goa
    expect((await slugs({ state: 'Himachal Pradesh' })).sort()).toEqual(['kasol1', 'manali1'])
  })

  it('filters by safetyVerified (requiresSafetyStack = true)', async () => {
    await seed({ slug: 'safe', requiresSafetyStack: true })
    await seed({ slug: 'unsafe', requiresSafetyStack: false })
    expect(await slugs({ safetyVerified: true })).toEqual(['safe'])
  })

  it('filters by cancellation preset', async () => {
    await seed({ slug: 'flex', cancellationPreset: 'flexible' })
    await seed({ slug: 'strict', cancellationPreset: 'strict' })
    expect(await slugs({ cancellation: 'flexible' })).toEqual(['flex'])
  })

  it('filters by minRating against the published-review average; unrated excluded for N>0', async () => {
    const good = await seed({ slug: 'highly-rated' })
    await addPublishedReview(good, 5)
    await addPublishedReview(good, 4)
    const meh = await seed({ slug: 'low-rated' })
    await addPublishedReview(meh, 2)
    await seed({ slug: 'unrated' })
    expect((await slugs({ minRating: 4 }))).toEqual(['highly-rated'])
  })

  it('treats minRating = 0 as matching all (including unrated)', async () => {
    await seed({ slug: 'unrated-a' })
    await seed({ slug: 'unrated-b' })
    expect((await slugs({ minRating: 0 })).sort()).toEqual(['unrated-a', 'unrated-b'])
  })

  // ── Sorts ───────────────────────────────────────────────────────────

  it('sorts by price ascending and descending', async () => {
    await seed({ slug: 'cheap', price12: '800.00' })
    await seed({ slug: 'mid', price12: '2000.00' })
    await seed({ slug: 'dear', price12: '9000.00' })
    expect(await slugs({ sort: 'price_asc' })).toEqual(['cheap', 'mid', 'dear'])
    expect(await slugs({ sort: 'price_desc' })).toEqual(['dear', 'mid', 'cheap'])
  })

  it('sorts by newest (most recently updated first)', async () => {
    await seed({ slug: 'old', updatedAt: new Date('2024-01-01T00:00:00Z') })
    await seed({ slug: 'new', updatedAt: new Date('2026-01-01T00:00:00Z') })
    await seed({ slug: 'mid', updatedAt: new Date('2025-01-01T00:00:00Z') })
    expect(await slugs({ sort: 'newest' })).toEqual(['new', 'mid', 'old'])
  })

  it('sorts by duration ascending and descending', async () => {
    await seed({ slug: 'short', durationMinutes: 90 })
    await seed({ slug: 'long', durationMinutes: 720 })
    await seed({ slug: 'mid', durationMinutes: 300 })
    expect(await slugs({ sort: 'duration_asc' })).toEqual(['short', 'mid', 'long'])
    expect(await slugs({ sort: 'duration_desc' })).toEqual(['long', 'mid', 'short'])
  })

  // ── Hit shape ───────────────────────────────────────────────────────

  it('returns the full hit shape (rounded headline price, vendor slug, facets)', async () => {
    await seed({
      slug: 'shape-test',
      title: 'Shape Test',
      shortDescription: 'desc',
      activitySlug: 'rafting',
      regionSlug: 'rishikesh',
      price12: '1499.60',
      difficulty: 'moderate',
      durationMinutes: 240,
    })
    const { hits } = await searchExperiences({ q: 'shape' }, { db })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      slug: 'shape-test',
      title: 'Shape Test',
      shortDescription: 'desc',
      activitySlug: 'rafting',
      regionSlug: 'rishikesh',
      vendorSlug: 'test-adventures',
      pricePerPersonRupees: 1500, // rounded from 1499.60
      isCombo: false,
      difficulty: 'moderate',
      durationMinutes: 240,
    })
    expect(typeof hits[0]!.id).toBe('string')
  })

  // ── Limit + resilience ──────────────────────────────────────────────

  it('caps the result set at 20 hits', async () => {
    for (let i = 0; i < 25; i++) {
      await seed({ slug: `bulk-${String(i).padStart(2, '0')}` })
    }
    const { hits } = await searchExperiences({}, { db })
    expect(hits).toHaveLength(20)
  })

  it('degrades to empty hits AND logs server-side when the query throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const brokenDb = {
        select: () => {
          throw new Error('connection refused')
        },
      } as unknown as TestDB
      const result = await searchExperiences({ q: 'rafting' }, { db: brokenDb })
      expect(result.hits).toEqual([])
      expect(errSpy).toHaveBeenCalledTimes(1)
      expect(String(errSpy.mock.calls[0]![0])).toContain('search')
    } finally {
      errSpy.mockRestore()
    }
  })
})
