/**
 * Tests for the isolation-safe catalog enrichment (`seedCatalog`), folded into
 * the canonical `db/seed.ts` (issue parity-catchup/01).
 *
 * Two things are asserted:
 *  1. ACCEPTANCE-CRITERIA MINIMUMS — `seedCatalog` produces a realistic,
 *     image-rich dataset (media_assets >= 150, >= 32 published catalog
 *     experiences, reviews, blog, site_content, notifications, support,
 *     promos, commission/pricing tiers, region closures, patterns, wallet).
 *  2. E2E-FIXTURE ISOLATION — the single most important property. The
 *     canonical seed is replayed by the Playwright harness (global-setup), so
 *     enrichment must NOT perturb any fixture an E2E spec asserts on:
 *       - never attaches media/reviews/bookings to a non-catalog experience
 *         (e.g. rishikesh-rafting-grade-iii: its review count + JSON-LD
 *         ratingCount are asserted by public-pages.spec.ts);
 *       - never seeds wallet/notifications/support to a seeded session user
 *         (u_seed_customer wallet is asserted exactly by customer-flows);
 *       - every commission/pricing tier is scope-locked to catalog experience
 *         IDs (empty category/vendor arrays would hijack money-path snapshots
 *         per ADR-0008, lib/payments/commission-resolver.ts);
 *       - region closures only on catalog-only regions (closures are
 *         per-region and would block E2E bookings in rishikesh/bir-billing/etc);
 *       - adds zero `disputed` bookings (admin dashboard #29 asserts the
 *         disputed count exactly);
 *       - archives the published admin-fixture experiences so they leave the
 *         public Featured/search surfaces.
 */
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  availabilityPatterns,
  availabilitySlots,
  bookings,
  blogPosts,
  commissionTiers,
  customerProfiles,
  experiences,
  mediaAssets,
  notifications,
  pricingTiers,
  promoCodes,
  promoRedemptions,
  regionClosures,
  reviews,
  siteContent,
  supportTickets,
  users,
  vendorProfiles,
  walletBalances,
} from '@/db/schema'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { seedCatalog } from './seed-extras'

// E2E booking regions — region_closures here would block E2E booking creation.
const E2E_REGIONS = ['rishikesh', 'manali', 'bir-billing', 'goa']
// Published admin-fixtures the enrichment must archive (subset present in this
// minimal base; the real seed has all four).
const RISHI_RAFTING = 'rishikesh-rafting-grade-iii'
const FIXTURE_SLUG = 'refund-queue-fixture-rishikesh'

/**
 * A minimal slice of the canonical seed: the admin uploader, a seeded customer
 * with a wallet, a published "demo" experience carrying exactly one published
 * review, and one published admin-fixture experience. Mirrors the fixtures the
 * isolation assertions below pin.
 */
async function seedMinimalBase(db: TestDB): Promise<{ rishiRaftingId: string }> {
  await db.insert(users).values([
    { id: 'u_seed_admin', email: 'admin@seed.outvers.dev', name: 'Seed Admin' },
    { id: 'u_seed_customer', email: 'customer@seed.outvers.dev', name: 'Seed Customer' },
    { id: 'u_demo_vendor', email: 'demo-vendor@seed.outvers.dev', name: 'Demo Vendor' },
  ])
  await db.insert(customerProfiles).values({ userId: 'u_seed_customer' })
  await db.insert(vendorProfiles).values({
    userId: 'u_demo_vendor',
    businessName: 'Demo Vendor Co',
    slug: 'demo-vendor-co',
    kycTier: 'business',
    pan: 'AAAAA1111A',
  })
  // u_seed_customer wallet — asserted untouched after enrichment.
  await db
    .insert(walletBalances)
    .values({ userId: 'u_seed_customer', balanceType: 'refund_balance', amount: '500.00' })

  const [rishi] = await db
    .insert(experiences)
    .values([
      {
        vendorUserId: 'u_demo_vendor',
        slug: RISHI_RAFTING,
        title: 'Grade III White-Water Rafting (Rishikesh)',
        shortDescription: 'Classic 16-km Ganga stretch.',
        longDescription: 'Run the iconic stretch with a fully-equipped raft.',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront', 'partial_pay'],
        pricePerPerson_1_2: '1500.00',
        pricePerPerson_3_5: '1300.00',
        pricePerPerson_6_plus: '1100.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'published',
      },
      {
        vendorUserId: 'u_demo_vendor',
        slug: FIXTURE_SLUG,
        title: 'Refund Queue Fixture — Rishikesh',
        shortDescription: 'Admin fixture.',
        longDescription: 'Admin fixture experience.',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '3000.00',
        pricePerPerson_3_5: '3000.00',
        pricePerPerson_6_plus: '3000.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'published',
      },
    ])
    .returning({ id: experiences.id, slug: experiences.slug })
  const rishiRaftingId = (rishi.slug === RISHI_RAFTING ? rishi : undefined)?.id as string

  // One completed booking + one published review on the demo experience.
  const [slot] = await db
    .insert(availabilitySlots)
    .values({
      experienceId: rishiRaftingId,
      startAt: new Date('2026-01-02T04:00:00.000Z'),
      endAt: new Date('2026-01-02T08:00:00.000Z'),
      capacity: 8,
      capacityTaken: 2,
    })
    .returning({ id: availabilitySlots.id })
  const [booking] = await db
    .insert(bookings)
    .values({
      customerUserId: 'u_seed_customer',
      experienceId: rishiRaftingId,
      slotId: slot.id,
      participantCount: 2,
      state: 'completed',
      paymentMode: 'full_upfront',
      grossTotalSnapshot: '3000.00',
      pricePerParticipantSnapshot: '1500.00',
      pricingBasisSnapshot: 'base_price',
      commissionRateSnapshot: '20.00',
      commissionBasisSnapshot: 'platform_default',
      gstRateOnCommissionSnapshot: '18.00',
      tdsAmountSnapshot: '3.00',
      cancellationPresetSnapshot: 'flexible',
      vendorIsResidentSnapshot: true,
      confirmedAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: new Date('2026-01-02T08:00:00.000Z'),
    })
    .returning({ id: bookings.id })
  await db.insert(reviews).values({
    bookingId: booking.id,
    customerUserId: 'u_seed_customer',
    experienceId: rishiRaftingId,
    vendorUserId: 'u_demo_vendor',
    rating: 5,
    title: 'Seed review',
    body: 'The one and only seed review on the demo experience.',
    status: 'published',
  })

  return { rishiRaftingId }
}

describe('seedCatalog — canonical seed enrichment', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let rishiRaftingId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
    const base = await seedMinimalBase(db)
    rishiRaftingId = base.rishiRaftingId
    await seedCatalog(db)
  }, 60_000)

  afterAll(async () => {
    await teardown()
  })

  // ── Catalog identity: experiences owned by catalog vendors (u_cat_*) ───────
  async function catalogExperienceIds(): Promise<string[]> {
    const rows = await db
      .select({ id: experiences.id })
      .from(experiences)
      .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
      .where(like(vendorProfiles.userId, 'u_cat_%'))
    return rows.map((r) => r.id)
  }

  describe('acceptance-criteria minimums', () => {
    it('seeds >= 32 published catalog experiences with region-prefixed slugs', async () => {
      const rows = await db
        .select({ slug: experiences.slug, status: experiences.status, region: experiences.regionSlug })
        .from(experiences)
        .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
        .where(like(vendorProfiles.userId, 'u_cat_%'))
      expect(rows.length).toBeGreaterThanOrEqual(32)
      for (const r of rows) {
        expect(r.status).toBe('published')
        // region=goa search facet asserts every result slug starts with goa-,
        // so all catalog slugs must be region-prefixed.
        expect(r.slug.startsWith(`${r.region}-`)).toBe(true)
      }
    })

    it('seeds >= 150 experience media_assets', async () => {
      const [{ c }] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.entityType, 'experience'), like(mediaAssets.storageKey, 'seed/%')))
      expect(c).toBeGreaterThanOrEqual(150)
    })

    it('seeds >= 25 reviews and >= 6 published blog posts', async () => {
      const [{ rc }] = await db.select({ rc: sql<number>`count(*)::int` }).from(reviews)
      expect(rc).toBeGreaterThanOrEqual(25)
      const [{ bc }] = await db
        .select({ bc: sql<number>`count(*)::int` })
        .from(blogPosts)
        .where(eq(blogPosts.status, 'published'))
      expect(bc).toBeGreaterThanOrEqual(6)
    })

    it('seeds all 6 site_content sections', async () => {
      const rows = await db.select({ section: siteContent.section }).from(siteContent)
      const sections = new Set(rows.map((r) => r.section))
      for (const s of ['hero', 'announcement_bar', 'homepage', 'branding', 'seo', 'footer']) {
        expect(sections.has(s)).toBe(true)
      }
    })

    it('seeds notifications (>=10), support tickets (>=8), promos (>=5) + redemptions (>=10)', async () => {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications)
      expect(n).toBeGreaterThanOrEqual(10)
      const [{ t }] = await db.select({ t: sql<number>`count(*)::int` }).from(supportTickets)
      expect(t).toBeGreaterThanOrEqual(8)
      const [{ p }] = await db.select({ p: sql<number>`count(*)::int` }).from(promoCodes)
      expect(p).toBeGreaterThanOrEqual(5)
      const [{ r }] = await db.select({ r: sql<number>`count(*)::int` }).from(promoRedemptions)
      expect(r).toBeGreaterThanOrEqual(10)
    })

    it('seeds commission tiers (>=2), pricing tiers (>=1), region closures (>=3), availability patterns (>=1)', async () => {
      const [{ ct }] = await db.select({ ct: sql<number>`count(*)::int` }).from(commissionTiers)
      expect(ct).toBeGreaterThanOrEqual(2)
      const [{ pt }] = await db.select({ pt: sql<number>`count(*)::int` }).from(pricingTiers)
      expect(pt).toBeGreaterThanOrEqual(1)
      const [{ rcl }] = await db.select({ rcl: sql<number>`count(*)::int` }).from(regionClosures)
      expect(rcl).toBeGreaterThanOrEqual(3)
      const [{ ap }] = await db.select({ ap: sql<number>`count(*)::int` }).from(availabilityPatterns)
      expect(ap).toBeGreaterThanOrEqual(1)
    })

    it('seeds wallet balances across >= 4 distinct customers', async () => {
      const rows = await db.select({ userId: walletBalances.userId }).from(walletBalances)
      const distinct = new Set(rows.map((r) => r.userId))
      expect(distinct.size).toBeGreaterThanOrEqual(4)
    })
  })

  describe('E2E-fixture isolation (must not break the Playwright harness)', () => {
    it('archives the published admin-fixture experience', async () => {
      const [fix] = await db
        .select({ status: experiences.status })
        .from(experiences)
        .where(eq(experiences.slug, FIXTURE_SLUG))
      expect(fix.status).toBe('archived')
    })

    it('leaves the demo experience (rishikesh-rafting) published with exactly its one seed review and no enrichment media', async () => {
      const [exp] = await db
        .select({ status: experiences.status })
        .from(experiences)
        .where(eq(experiences.slug, RISHI_RAFTING))
      expect(exp.status).toBe('published')

      const [{ rc }] = await db
        .select({ rc: sql<number>`count(*)::int` })
        .from(reviews)
        .where(eq(reviews.experienceId, rishiRaftingId))
      expect(rc).toBe(1)

      const [{ mc }] = await db
        .select({ mc: sql<number>`count(*)::int` })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.entityType, 'experience'), eq(mediaAssets.entityId, rishiRaftingId)))
      expect(mc).toBe(0)
    })

    it('does not touch the seeded customer wallet (u_seed_customer)', async () => {
      const rows = await db
        .select({ balanceType: walletBalances.balanceType, amount: walletBalances.amount })
        .from(walletBalances)
        .where(eq(walletBalances.userId, 'u_seed_customer'))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ balanceType: 'refund_balance', amount: '500.00' })
    })

    it('seeds no notifications or support tickets for seeded session users', async () => {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(notifications)
        .where(inArray(notifications.userId, ['u_seed_customer', 'u_demo_vendor', 'u_seed_admin']))
      expect(n).toBe(0)
      const [{ t }] = await db
        .select({ t: sql<number>`count(*)::int` })
        .from(supportTickets)
        .where(eq(supportTickets.createdByUserId, 'u_seed_customer'))
      expect(t).toBe(0)
    })

    it('adds zero disputed bookings (admin dashboard #29 asserts the disputed count exactly)', async () => {
      const [{ d }] = await db
        .select({ d: sql<number>`count(*)::int` })
        .from(bookings)
        .where(eq(bookings.state, 'disputed'))
      expect(d).toBe(0)
    })
  })

  describe('money-path isolation: every tier is scope-locked to catalog experiences (ADR-0008)', () => {
    it('every commission tier targets only catalog experience IDs, with empty category/vendor scope', async () => {
      const catalogIds = new Set(await catalogExperienceIds())
      const tiers = await db
        .select({
          cats: commissionTiers.appliesToCategories,
          vendors: commissionTiers.appliesToVendorIds,
          exps: commissionTiers.appliesToExperienceIds,
        })
        .from(commissionTiers)
      expect(tiers.length).toBeGreaterThan(0)
      for (const t of tiers) {
        // An empty applies-to-experiences array means "all experiences" — that
        // would hijack E2E booking snapshots. Each tier MUST be experience-scoped.
        expect((t.exps ?? []).length).toBeGreaterThan(0)
        expect((t.cats ?? []).length).toBe(0)
        expect((t.vendors ?? []).length).toBe(0)
        for (const id of t.exps ?? []) expect(catalogIds.has(id)).toBe(true)
      }
    })

    it('every pricing tier targets only catalog experience IDs, with empty category/vendor scope', async () => {
      const catalogIds = new Set(await catalogExperienceIds())
      const tiers = await db
        .select({
          cats: pricingTiers.appliesToCategories,
          vendors: pricingTiers.appliesToVendorIds,
          exps: pricingTiers.appliesToExperienceIds,
        })
        .from(pricingTiers)
      expect(tiers.length).toBeGreaterThan(0)
      for (const t of tiers) {
        expect((t.exps ?? []).length).toBeGreaterThan(0)
        expect((t.cats ?? []).length).toBe(0)
        expect((t.vendors ?? []).length).toBe(0)
        for (const id of t.exps ?? []) expect(catalogIds.has(id)).toBe(true)
      }
    })
  })

  describe('availability isolation: closures only on catalog-only regions', () => {
    it('seeds no region_closure on any E2E booking region', async () => {
      const rows = await db
        .select({ region: regionClosures.regionSlug })
        .from(regionClosures)
        .where(inArray(regionClosures.regionSlug, E2E_REGIONS))
      expect(rows).toHaveLength(0)
    })

    it('attaches availability patterns only to catalog experiences', async () => {
      const catalogIds = new Set(await catalogExperienceIds())
      const rows = await db
        .select({ experienceId: availabilityPatterns.experienceId })
        .from(availabilityPatterns)
      expect(rows.length).toBeGreaterThan(0)
      for (const r of rows) expect(catalogIds.has(r.experienceId)).toBe(true)
    })
  })
})
