/**
 * PGlite integration test for the dev-only demo catalog seed (issue 06).
 *
 * Asserts the seed materialises the bounded pilot: 30 PUBLISHED experiences
 * owned by the 12 demo vendors, each carrying the ADR-0017 structured columns
 * and an ordered itinerary, plus that re-running `seedDemoCatalog` is a no-op
 * (deterministic IDs + onConflictDoNothing — counts stay constant, no dup
 * slugs).
 *
 * Mirrors db/seed-extras.test.ts harness setup (setupTestDb → PGlite).
 */
import { eq, inArray, like, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  availabilitySlots,
  experiences,
  mediaAssets,
  reviews,
  users,
  vendorProfiles,
} from '@/db/schema'
import { loadItinerary } from '@/lib/experiences/itinerary'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { DEMO_LISTINGS, DEMO_VENDORS } from './data/demo-catalog'
import { seedDemoCatalog } from './seed-demo-catalog'

/** The admin uploader the seed attributes media to — present in the real seed. */
async function seedAdmin(db: TestDB): Promise<void> {
  await db
    .insert(users)
    .values({ id: 'u_seed_admin', email: 'admin@seed.outvers.dev', name: 'Seed Admin' })
    .onConflictDoNothing()
}

describe('seedDemoCatalog — dev-only bounded pilot', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
    await seedAdmin(db)
    await seedDemoCatalog(db)
  }, 60_000)

  afterAll(async () => {
    await teardown()
  })

  it('inserts all 12 demo vendors as business-tier profiles', async () => {
    const rows = await db
      .select({ userId: vendorProfiles.userId, kycTier: vendorProfiles.kycTier })
      .from(vendorProfiles)
      .where(inArray(vendorProfiles.userId, DEMO_VENDORS.map((v) => v.userId)))
    expect(rows).toHaveLength(12)
    for (const r of rows) expect(r.kycTier).toBe('business')
  })

  it('produces 30 published demo experiences with structured columns populated', async () => {
    const rows = await db
      .select({
        slug: experiences.slug,
        status: experiences.status,
        region: experiences.regionSlug,
        difficulty: experiences.difficulty,
        durationMinutes: experiences.durationMinutes,
        minAge: experiences.minAge,
        maxGroupSize: experiences.maxGroupSize,
        languages: experiences.languages,
        meetingPoint: experiences.meetingPoint,
        seasonMonths: experiences.seasonMonths,
        highlights: experiences.highlights,
        inclusions: experiences.inclusions,
        exclusions: experiences.exclusions,
        whatToBring: experiences.whatToBring,
        requiresSafetyStack: experiences.requiresSafetyStack,
      })
      .from(experiences)
      .where(inArray(experiences.slug, DEMO_LISTINGS.map((l) => l.slug)))
    expect(rows).toHaveLength(30)
    for (const r of rows) {
      expect(r.status).toBe('published')
      expect(r.slug.startsWith(`${r.region}-`)).toBe(true)
      expect(r.difficulty).not.toBeNull()
      expect(r.durationMinutes ?? 0).toBeGreaterThan(0)
      expect(r.minAge ?? -1).toBeGreaterThanOrEqual(0)
      expect(r.maxGroupSize ?? 0).toBeGreaterThan(0)
      expect((r.languages ?? []).length).toBeGreaterThan(0)
      expect(r.meetingPoint ?? '').not.toBe('')
      expect((r.seasonMonths ?? []).length).toBeGreaterThan(0)
      expect((r.highlights ?? []).length).toBeGreaterThan(0)
      expect((r.inclusions ?? []).length).toBeGreaterThan(0)
      expect((r.exclusions ?? []).length).toBeGreaterThan(0)
      expect((r.whatToBring ?? []).length).toBeGreaterThan(0)
    }
  })

  it('derives requiresSafetyStack from the activity registry (rafting=true, camping=false)', async () => {
    const [raft] = await db
      .select({ s: experiences.requiresSafetyStack })
      .from(experiences)
      .where(eq(experiences.slug, 'rishikesh-shivpuri-nim-beach-16km-rafting'))
    expect(raft?.s).toBe(true)
    const camping = DEMO_LISTINGS.find((l) => l.activity === 'camping')
    if (camping) {
      const [c] = await db
        .select({ s: experiences.requiresSafetyStack })
        .from(experiences)
        .where(eq(experiences.slug, camping.slug))
      expect(c?.s).toBe(false)
    }
  })

  it('writes an ordered itinerary for every listing that declares one', async () => {
    const rows = await db
      .select({ id: experiences.id, slug: experiences.slug })
      .from(experiences)
      .where(inArray(experiences.slug, DEMO_LISTINGS.map((l) => l.slug)))
    const idBySlug = new Map(rows.map((r) => [r.slug, r.id]))
    for (const l of DEMO_LISTINGS) {
      if (l.itinerary.length === 0) continue
      const steps = await loadItinerary(db, idBySlug.get(l.slug)!)
      expect(steps.length).toBe(l.itinerary.length)
      // stepOrder ascending, matching source order
      for (let i = 0; i < steps.length; i++) {
        expect(steps[i].stepOrder).toBe(i)
        expect(steps[i].title).toBe(l.itinerary[i].title)
      }
    }
  })

  it('seeds future availability slots and media assets under the demo prefix', async () => {
    const expIds = (
      await db
        .select({ id: experiences.id })
        .from(experiences)
        .where(inArray(experiences.slug, DEMO_LISTINGS.map((l) => l.slug)))
    ).map((r) => r.id)
    const [{ slots }] = await db
      .select({ slots: sql<number>`count(*)::int` })
      .from(availabilitySlots)
      .where(inArray(availabilitySlots.experienceId, expIds))
    expect(slots).toBe(60) // 2 per experience

    const [{ media }] = await db
      .select({ media: sql<number>`count(*)::int` })
      .from(mediaAssets)
      .where(like(mediaAssets.storageKey, 'seed/demo/%'))
    expect(media).toBeGreaterThanOrEqual(150) // ~6 per experience
  })

  it('seeds at least some reviews on demo experiences', async () => {
    const expIds = (
      await db
        .select({ id: experiences.id })
        .from(experiences)
        .where(inArray(experiences.slug, DEMO_LISTINGS.map((l) => l.slug)))
    ).map((r) => r.id)
    const [{ rc }] = await db
      .select({ rc: sql<number>`count(*)::int` })
      .from(reviews)
      .where(inArray(reviews.experienceId, expIds))
    expect(rc).toBeGreaterThanOrEqual(10)
  })

  it('is idempotent — a second run leaves the experience count unchanged with no duplicate slugs', async () => {
    const before = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(experiences)
      .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
      .where(like(vendorProfiles.userId, 'u_cat_%'))

    await seedDemoCatalog(db)

    const after = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(experiences)
      .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
      .where(like(vendorProfiles.userId, 'u_cat_%'))
    expect(after[0].c).toBe(before[0].c)
    expect(after[0].c).toBe(30)

    const slugs = await db
      .select({ slug: experiences.slug })
      .from(experiences)
      .where(inArray(experiences.slug, DEMO_LISTINGS.map((l) => l.slug)))
    expect(new Set(slugs.map((s) => s.slug)).size).toBe(slugs.length)
    expect(slugs.length).toBe(30)
  })
})
