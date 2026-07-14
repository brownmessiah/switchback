import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { dateKey } from '@/lib/experiences/booking-calendar'
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

  it('returns true when only date is set (ADR-0020 — mandatory for robots/canonical)', () => {
    expect(isFilteredSearch({ date: '2026-08-01' })).toBe(true)
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

  // ── Date-availability filter (home-redesign issue 10, ADR-0020) ──────────
  // Inline `EXISTS`-before-`LIMIT` correlated subquery against
  // availability_slots: `status='open' AND start_at in [day) AND
  // capacity_taken < capacity`. NOT a post-hoc filter of the returned hits.
  describe('date-availability filter (ADR-0020)', () => {
    /** A UTC day comfortably in the future (10 days out). */
    const targetDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    const targetDay = dateKey(targetDate)
    const dayAfter = dateKey(new Date(targetDate.getTime() + 24 * 60 * 60 * 1000))

    /** Insert a slot at 06:00–10:00 UTC on the given YYYY-MM-DD day. */
    async function addSlot(
      experienceId: string,
      day: string,
      opts: {
        capacity?: number
        capacityTaken?: number
        status?: 'open' | 'sold_out' | 'closed'
      } = {},
    ): Promise<void> {
      const startAt = new Date(`${day}T06:00:00.000Z`)
      const endAt = new Date(`${day}T10:00:00.000Z`)
      await db.insert(availabilitySlots).values({
        experienceId,
        startAt,
        endAt,
        capacity: opts.capacity ?? 8,
        capacityTaken: opts.capacityTaken ?? 0,
        status: opts.status ?? 'open',
      })
    }

    it('includes experiences with an open, non-full slot on the chosen day', async () => {
      const withSlot = await seed({ slug: 'has-slot' })
      await seed({ slug: 'no-slot' })
      await addSlot(withSlot, targetDay)

      const { hits } = await searchExperiences({ date: targetDay }, { db })
      expect(hits.map((h) => h.slug)).toEqual(['has-slot'])
    })

    it('excludes an experience whose only slot is on a DIFFERENT day', async () => {
      const other = await seed({ slug: 'wrong-day' })
      await addSlot(other, dayAfter)

      const { hits } = await searchExperiences({ date: targetDay }, { db })
      expect(hits).toHaveLength(0)
    })

    it('excludes sold_out and closed slots on the day', async () => {
      const soldOut = await seed({ slug: 'sold-out' })
      await addSlot(soldOut, targetDay, { status: 'sold_out' })
      const closed = await seed({ slug: 'closed' })
      await addSlot(closed, targetDay, { status: 'closed' })

      const { hits } = await searchExperiences({ date: targetDay }, { db })
      expect(hits).toHaveLength(0)
    })

    it('excludes an open slot whose capacity is fully taken', async () => {
      const full = await seed({ slug: 'full' })
      await addSlot(full, targetDay, { capacity: 4, capacityTaken: 4 })

      const { hits } = await searchExperiences({ date: targetDay }, { db })
      expect(hits).toHaveLength(0)
    })

    it('includes an experience when ANY slot on the day is bookable (one full, one free)', async () => {
      const mixed = await seed({ slug: 'mixed' })
      await addSlot(mixed, targetDay, { capacity: 4, capacityTaken: 4 })
      // Second slot 4h later on the same UTC day, seats free.
      await db.insert(availabilitySlots).values({
        experienceId: mixed,
        startAt: new Date(`${targetDay}T12:00:00.000Z`),
        endAt: new Date(`${targetDay}T16:00:00.000Z`),
        capacity: 8,
        capacityTaken: 2,
        status: 'open',
      })

      const { hits } = await searchExperiences({ date: targetDay }, { db })
      expect(hits.map((h) => h.slug)).toEqual(['mixed'])
    })

    it('a date beyond the materialization horizon returns empty (ADR-0020 caveat)', async () => {
      const exp = await seed({ slug: 'horizon' })
      await addSlot(exp, targetDay)
      const farFuture = dateKey(new Date(Date.now() + 300 * 24 * 60 * 60 * 1000))

      const { hits } = await searchExperiences({ date: farFuture }, { db })
      expect(hits).toHaveLength(0)
    })

    it('date=TODAY excludes slots that already departed (>= now clamp)', async () => {
      // Freeze "now" at 12:00 UTC so the same-UTC-day past/future slots are
      // unambiguous. The clamp is a JS-computed ISO param (not SQL now()),
      // so fake timers govern it.
      vi.useFakeTimers()
      try {
        const todayNoon = new Date(`${dateKey(new Date())}T12:00:00.000Z`)
        vi.setSystemTime(todayNoon)
        const todayKeyStr = dateKey(todayNoon)

        const departed = await seed({ slug: 'departed' })
        await db.insert(availabilitySlots).values({
          experienceId: departed,
          startAt: new Date(`${todayKeyStr}T06:00:00.000Z`), // 6h ago
          endAt: new Date(`${todayKeyStr}T10:00:00.000Z`),
          capacity: 8,
        })
        const upcoming = await seed({ slug: 'upcoming' })
        await db.insert(availabilitySlots).values({
          experienceId: upcoming,
          startAt: new Date(`${todayKeyStr}T18:00:00.000Z`), // 6h ahead
          endAt: new Date(`${todayKeyStr}T22:00:00.000Z`),
          capacity: 8,
        })

        const { hits } = await searchExperiences({ date: todayKeyStr }, { db })
        expect(hits.map((h) => h.slug)).toEqual(['upcoming'])
      } finally {
        vi.useRealTimers()
      }
    })

    it('a malformed date that bypassed parsing matches NOTHING (defensive sql false)', async () => {
      const exp = await seed({ slug: 'guarded' })
      await addSlot(exp, targetDay)

      const { hits } = await searchExperiences({ date: 'not-a-date' }, { db })
      expect(hits).toHaveLength(0)
    })

    it('composes with q (text match AND bookable that day)', async () => {
      const raftWith = await seed({ slug: 'raft-with', title: 'Ganga Rafting Rush' })
      await addSlot(raftWith, targetDay)
      await seed({ slug: 'raft-without', title: 'Ganga Rafting Calm' })

      const { hits } = await searchExperiences({ q: 'rafting', date: targetDay }, { db })
      expect(hits.map((h) => h.slug)).toEqual(['raft-with'])
    })

    it('filters BEFORE the 20-hit limit — the page still fills when >20 match (never post-hoc)', async () => {
      // 22 matching experiences (older updatedAt), then 5 NON-matching seeded
      // with the NEWEST updatedAt: under the default newest-first sort a
      // naive "filter the returned 20" would waste 5 of the page's rows on
      // slotless experiences and return only 15. The inline EXISTS must
      // return a full page of 20 bookable hits.
      const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      for (let i = 0; i < 22; i++) {
        const id = await seed({
          slug: `bookable-${String(i).padStart(2, '0')}`,
          updatedAt: old,
        })
        await addSlot(id, targetDay)
      }
      for (let i = 0; i < 5; i++) {
        await seed({ slug: `slotless-${i}` }) // newest updatedAt (now)
      }

      const { hits } = await searchExperiences({ date: targetDay }, { db })
      expect(hits).toHaveLength(20)
      expect(hits.every((h) => h.slug.startsWith('bookable-'))).toBe(true)
    })
  })
})
