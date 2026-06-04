/**
 * Dev-only demo catalog seed (issue 06 — bounded pilot).
 *
 * Layers the 30 web-fact-checked pilot listings (db/data/demo-catalog.ts) and
 * their 12 vendors onto a DB so the public marketplace renders a rich,
 * structured catalog. Each Experience is PUBLISHED with the full ADR-0017
 * structured columns (duration, difficulty, age, group size, languages,
 * meeting point, season, highlights, inclusions, exclusions, what-to-bring),
 * its required permits, a registry-derived `requiresSafetyStack`, pricing
 * tiers, an ordered itinerary, ~6 media assets, two future availability slots,
 * and a handful of reviews on dedicated completed bookings.
 *
 * NOT WIRED into db/seed.ts — kept OUT of the Playwright E2E global-setup path
 * (tests/e2e/global-setup.ts replays db/seed.ts only). Run manually:
 *   pnpm db:seed:demo   (dotenv -e .env.local -- tsx db/seed-demo-catalog.ts)
 *
 * IDEMPOTENT: deterministic IDs in a private `demo`-based namespace (distinct
 * from db/seed-extras.ts' namespace so rows never collide) + onConflictDoNothing
 * + media delete-by-prefix, so re-running is a no-op.
 *
 * Imagery: reuses the curated, HTTP-200-verified Unsplash pools from
 * db/seed-extras.ts via `photosFor`. media_assets carry a `seed/demo/...`
 * storage-key prefix distinct from seed-extras' `seed/catalog/...`.
 */
import { and, eq, inArray, like } from 'drizzle-orm'

import { getActivity } from '@/lib/activities/registry'
import { replaceItinerary } from '@/lib/experiences/itinerary'

import { DEMO_LISTINGS, DEMO_VENDORS } from './data/demo-catalog'
import {
  availabilitySlots,
  bookings,
  experiences,
  mediaAssets,
  reviews,
  users,
  vendorProfiles,
} from './schema'
import { IMG, type SeedDb, VENDOR_LOGO_PHOTOS } from './seed-extras'
import { galleryFor } from './seed-photos'
import { vendorVariety } from './seed-vendor-variety'

const ADMIN_ID = 'u_seed_admin'

/**
 * Deterministic uuid-shaped IDs in a PRIVATE namespace based on 'demo'. The
 * fixed group differs from seed-extras' `e7000401-…` block so demo rows never
 * collide with catalog-enrichment rows in the same DB.
 */
function ns(prefix: string, n: number): string {
  const hex = (prefix.split('').reduce((a, c) => a + c.charCodeAt(0), 0) + n)
    .toString(16)
    .padStart(4, '0')
    .slice(-4)
  return `de300601-0000-4000-8${hex.slice(0, 3)}-${n.toString(16).padStart(12, '0')}`
}

const ago = (n: number): Date => new Date(Date.now() - n * 86400 * 1000)

/** Real customer names for the demo review authors. */
const DEMO_PEOPLE: Array<{ id: string; name: string; email: string }> = [
  { id: 'u_demo_cust_arjun', name: 'Arjun Reddy', email: 'demo+arjun@seed.outvers.dev' },
  { id: 'u_demo_cust_sara', name: 'Sara Pinto', email: 'demo+sara@seed.outvers.dev' },
  { id: 'u_demo_cust_neel', name: 'Neel Joshi', email: 'demo+neel@seed.outvers.dev' },
  { id: 'u_demo_cust_tara', name: 'Tara Menon', email: 'demo+tara@seed.outvers.dev' },
]

const DEMO_REVIEW_BANK: Array<{ rating: number; title: string; body: string; resp?: string }> = [
  { rating: 5, title: 'Genuinely world-class', body: 'Certified guides, spotless kit, and the structured itinerary on the listing matched the day exactly. Booking was effortless.', resp: 'Thank you! Hope to host you again next season.' },
  { rating: 5, title: 'Exactly as described', body: 'The highlights and what-to-bring list were spot on. Small group, real safety briefing, unforgettable views.' },
  { rating: 4, title: 'Brilliant, minor delay', body: 'Five-star experience; pickup ran a touch late but the crew more than made up for it.', resp: 'Apologies for the delay — we have tightened our pickup window.' },
  { rating: 5, title: 'Felt completely safe', body: 'As a first-timer the clear inclusions and the verified-vendor badge gave me total confidence.' },
  { rating: 4, title: 'Stunning and well run', body: 'Knowledgeable guide, fair price, gorgeous setting. Would book through Outvers again.' },
  { rating: 5, title: 'Best part of the trip', body: 'Professional, punctual, and so much fun. The season info on the page helped us pick the perfect window.' },
]

export async function seedDemoCatalog(db: SeedDb): Promise<void> {
  // ── 1. Demo vendors (users + verified business-tier profiles) ─────────────
  await db
    .insert(users)
    .values(
      DEMO_VENDORS.map((v, i) => ({
        id: v.userId,
        email: v.email,
        name: v.businessName,
        image: IMG(VENDOR_LOGO_PHOTOS[i % VENDOR_LOGO_PHOTOS.length], 256),
      })),
    )
    .onConflictDoNothing()
  // A1 — differentiate every demo Vendor (commission rate, SLA/trust score, and
  // a staggered historical join date) so the dev demo's admin vendor list +
  // analytics charts read as a real marketplace, not "20% / 100% / joined
  // today" everywhere.
  for (let vi = 0; vi < DEMO_VENDORS.length; vi++) {
    const v = DEMO_VENDORS[vi]
    const variety = vendorVariety(vi, DEMO_VENDORS.length)
    await db
      .insert(vendorProfiles)
      .values({
        userId: v.userId,
        businessName: v.businessName,
        slug: v.slug,
        kycTier: 'business',
        pan: v.pan,
        payoutMethod: 'upi',
        payoutDestination: { vpa: v.vpa, accountHolder: v.businessName },
        commissionRate: variety.commissionRate,
        responseTimeSlaScore: variety.responseTimeSlaScore,
        createdAt: variety.createdAt,
        about:
          'A KYC-verified Outvers operator running certified, safety-first adventures with experienced local guides. Small groups, transparent pricing, free cancellation within policy.',
      })
      .onConflictDoNothing()
  }

  // ── 2. Demo experiences (PUBLISHED) with ALL structured columns ───────────
  await db
    .insert(experiences)
    .values(
      DEMO_LISTINGS.map((l) => ({
        vendorUserId: l.vendorId,
        slug: l.slug,
        title: l.title,
        shortDescription: l.shortDescription,
        longDescription: l.longDescription,
        cancellationPreset: l.preset,
        paymentModesAllowed: ['full_upfront', 'partial_pay'] as (
          | 'full_upfront'
          | 'partial_pay'
          | 'reserve_now_pay_later'
        )[],
        pricePerPerson_1_2: l.p12,
        pricePerPerson_3_5: l.p35,
        pricePerPerson_6_plus: l.p6,
        requiredPermits: l.permits,
        requiresSafetyStack: getActivity(l.activity)?.requiresSafetyStack ?? false,
        regionSlug: l.region,
        activitySlug: l.activity,
        // ADR-0017 structured attributes — full backfill for the pilot.
        durationMinutes: l.durationMinutes,
        difficulty: l.difficulty,
        minAge: l.minAge,
        maxGroupSize: l.maxGroupSize,
        languages: l.languages,
        meetingPoint: l.meetingPoint,
        seasonMonths: l.seasonMonths,
        highlights: l.highlights,
        inclusions: l.inclusions,
        exclusions: l.exclusions,
        whatToBring: l.whatToBring,
        status: 'published' as const,
      })),
    )
    .onConflictDoNothing()

  // Authoritative demo set (fresh OR reseed): look up by slug.
  const demoSlugs = DEMO_LISTINGS.map((l) => l.slug)
  const demo = await db
    .select({
      id: experiences.id,
      slug: experiences.slug,
      activitySlug: experiences.activitySlug,
      vendorUserId: experiences.vendorUserId,
      price12: experiences.pricePerPerson_1_2,
      preset: experiences.cancellationPreset,
    })
    .from(experiences)
    .where(inArray(experiences.slug, demoSlugs))
  const idBySlug = new Map(demo.map((d) => [d.slug, d.id]))

  // ── 3. Itinerary — written via replaceItinerary, one tx per listing ───────
  // replaceItinerary is delete-then-insert; we own the tx (same contract as the
  // Vendor form action / db/seed.ts).
  for (const l of DEMO_LISTINGS) {
    const expId = idBySlug.get(l.slug)
    if (!expId || l.itinerary.length === 0) continue
    await db.transaction(async (tx) => {
      await replaceItinerary(tx, expId, l.itinerary)
    })
  }

  // ── 4. media_assets — ~6 per experience (re-runnable: clear by prefix) ────
  // Clear only demo-owned rows first (storage_key prefix), then re-insert.
  await db.delete(mediaAssets).where(like(mediaAssets.storageKey, 'seed/demo/%'))
  for (const exp of demo) {
    const photos = galleryFor(exp.activitySlug, exp.slug)
    await db.insert(mediaAssets).values(
      photos.map((pid, i) => ({
        uploadedBy: ADMIN_ID,
        storageKey: `seed/demo/experience/${exp.slug}/${i}.jpg`,
        url: IMG(pid, 1200),
        contentType: 'image/jpeg',
        sizeBytes: 180_000 + i * 4096,
        altText: `${exp.slug} — photo ${i + 1}`,
        entityType: 'experience',
        entityId: exp.id,
      })),
    )
  }

  // ── 5. Two future availability slots per experience (T+5d, T+12d) ─────────
  const slotForExp = new Map<string, string>()
  for (const exp of demo) {
    for (const offset of [5, 12]) {
      const startAt = new Date(Date.now() + offset * 86400 * 1000)
      startAt.setUTCHours(4, 0, 0, 0)
      const endAt = new Date(startAt.getTime() + 4 * 3600 * 1000)
      const [row] = await db
        .insert(availabilitySlots)
        .values({ experienceId: exp.id, startAt, endAt, capacity: offset === 5 ? 8 : 12 })
        .onConflictDoNothing()
        .returning({ id: availabilitySlots.id })
      const id =
        row?.id ??
        (
          await db
            .select({ id: availabilitySlots.id })
            .from(availabilitySlots)
            .where(and(eq(availabilitySlots.experienceId, exp.id), eq(availabilitySlots.startAt, startAt)))
        )[0]?.id
      if (id && !slotForExp.has(exp.id)) slotForExp.set(exp.id, id)
    }
  }

  // ── 6. Demo customers + a subset of reviews on completed bookings ─────────
  await db
    .insert(users)
    .values(DEMO_PEOPLE.map((p) => ({ id: p.id, email: p.email, name: p.name })))
    .onConflictDoNothing()

  const reviewTargets = demo.slice(0, 12)
  let bankIdx = 0
  for (let ei = 0; ei < reviewTargets.length; ei++) {
    const exp = reviewTargets[ei]
    if (!slotForExp.has(exp.id)) continue
    // Residual fix (2026-06-04): completed review bookings must sit on a PAST
    // slot, not the future T+5d/T+12d availability slots (a completed booking
    // on a future slot reads as broken + sorts among upcoming). Create ONE
    // dedicated past slot per review target at a distinct 05:00-UTC hour,
    // deterministic + idempotent (the (experience_id, start_at) pair is unique).
    const pastStartAt = new Date(Date.now() - 30 * 86400 * 1000)
    pastStartAt.setUTCHours(5, 0, 0, 0)
    const pastEndAt = new Date(pastStartAt.getTime() + 4 * 3600 * 1000)
    const [pastRow] = await db
      .insert(availabilitySlots)
      .values({ experienceId: exp.id, startAt: pastStartAt, endAt: pastEndAt, capacity: 8, capacityTaken: 2 })
      .onConflictDoNothing()
      .returning({ id: availabilitySlots.id })
    const reviewSlotId =
      pastRow?.id ??
      (
        await db
          .select({ id: availabilitySlots.id })
          .from(availabilitySlots)
          .where(and(eq(availabilitySlots.experienceId, exp.id), eq(availabilitySlots.startAt, pastStartAt)))
      )[0]?.id
    if (!reviewSlotId) continue
    const reviewsForThis = ei % 2 === 0 ? 2 : 1 // 1-2 each
    for (let r = 0; r < reviewsForThis; r++) {
      const person = DEMO_PEOPLE[(ei + r) % DEMO_PEOPLE.length]
      const tmpl = DEMO_REVIEW_BANK[bankIdx % DEMO_REVIEW_BANK.length]
      bankIdx++
      const bId = ns('demorev', ei * 10 + r)
      const exists = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bId)).limit(1)
      if (exists.length === 0) {
        const gross = Math.round(Number(exp.price12) * 2)
        await db.insert(bookings).values({
          id: bId,
          customerUserId: person.id,
          experienceId: exp.id,
          slotId: reviewSlotId,
          participantCount: 2,
          state: 'completed',
          paymentMode: 'full_upfront',
          grossTotalSnapshot: String(gross),
          pricePerParticipantSnapshot: exp.price12,
          pricingBasisSnapshot: 'tier_1_2',
          commissionRateSnapshot: '20.00',
          commissionBasisSnapshot: 'vendor_base',
          cancellationPresetSnapshot: exp.preset,
          tdsAmountSnapshot: '0.00',
          tcsAmountSnapshot: (gross * 0.005).toFixed(2),
          tcsRateSnapshot: '0.50',
          gstRateOnCommissionSnapshot: '18.00',
          vendorIsResidentSnapshot: true,
          payoutState: 'pending',
          completedAt: ago(20),
          confirmedAt: ago(40),
        })
      }
      const revExists = await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.bookingId, bId)).limit(1)
      if (revExists.length === 0) {
        await db.insert(reviews).values({
          bookingId: bId,
          customerUserId: person.id,
          experienceId: exp.id,
          vendorUserId: exp.vendorUserId,
          rating: tmpl.rating,
          title: tmpl.title,
          body: tmpl.body,
          status: 'published',
          ...(tmpl.resp ? { vendorResponse: tmpl.resp, vendorRespondedAt: ago(15) } : {}),
          createdAt: ago(18 - ei),
        })
      }
    }
  }
}

async function main(): Promise<void> {
  const { db } = await import('@/db/client')
  console.warn('seeding dev-only demo catalog (30 listings)…')
  await seedDemoCatalog(db)
  console.warn('demo catalog seeded.')
  process.exit(0)
}

// Only run when invoked directly (tsx db/seed-demo-catalog.ts), not on import.
if (process.argv[1] && process.argv[1].endsWith('seed-demo-catalog.ts')) {
  main().catch((err) => {
    console.error('seed-demo-catalog failed:', err)
    process.exit(1)
  })
}
