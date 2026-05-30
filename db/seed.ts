/**
 * Seed script — populates a fresh database with enough data to make the
 * public surfaces (home, activity-city collections, experience detail,
 * search) actually render content. Idempotent: ON CONFLICT DO NOTHING
 * everywhere so re-running against an already-seeded DB is a no-op.
 *
 * Shape:
 *   - 1 admin user
 *   - 3 vendors: one phone-tier (no published Experiences), one
 *     identity-tier (caps apply), one business-tier (unrestricted +
 *     payouts configured + PAN snapshotted so booking-create works
 *     against resident-Vendor TDS path)
 *   - 1 vendor User with NO vendor_profile yet — a signed-up user who
 *     has not onboarded. Used by the onboarding E2E (#16) to drive
 *     createVendorProfileAction against a clean "no profile" state.
 *   - ~8 Experiences across (rishikesh, manali, bir-billing, goa) ×
 *     (rafting, paragliding, scuba-diving, trekking). Status='published'
 *     so adventure-city collections find them.
 *   - 1 availability_slot per Experience, T+7d, capacity 8
 *
 * Run:    pnpm db:seed
 * Reset:  pnpm db:reset (planned — for now drop and re-migrate manually)
 *
 * NOT for production. Production seed lives in a separate script that
 * loads real Vendor + Experience records from the legacy travel-app.
 */

import { eq, inArray } from 'drizzle-orm'

import { db } from './client'
import {
  adminProfiles,
  availabilitySlots,
  bookings,
  conversations,
  customerProfiles,
  experiences,
  messages,
  payments,
  reviews,
  users,
  vendorProfiles,
  walletBalances,
  walletTransactions,
} from './schema'

interface SeededExperience {
  vendorUserId: string
  slug: string
  title: string
  shortDescription: string
  longDescription: string
  pricePerPerson_1_2: string
  pricePerPerson_3_5: string
  pricePerPerson_6_plus: string
  regionSlug: string
  activitySlug: string
}

const VENDORS = [
  {
    userId: 'u_seed_v_phone',
    email: 'phone-tier@seed.outvers.dev',
    businessName: 'Riverbend Adventures (Phone Tier)',
    slug: 'riverbend-adventures',
    kycTier: 'phone' as const,
    pan: null,
    payout: null,
  },
  {
    userId: 'u_seed_v_identity',
    email: 'identity-tier@seed.outvers.dev',
    businessName: 'Himalayan Hikes Co (Identity Tier)',
    slug: 'himalayan-hikes-co',
    kycTier: 'identity' as const,
    pan: 'ABCDE1234F',
    payout: { method: 'upi' as const, dest: { vpa: 'himalayan@upi' } },
  },
  {
    userId: 'u_seed_v_business',
    email: 'business-tier@seed.outvers.dev',
    businessName: 'Goa Dive Center (Business Tier)',
    slug: 'goa-dive-center',
    kycTier: 'business' as const,
    pan: 'GHIJK5678L',
    payout: {
      method: 'bank_account' as const,
      dest: { accountHolder: 'Goa Dive Center', ifsc: 'HDFC0000123', accountNumber: '1234567890' },
    },
  },
]

/**
 * A vendor User who has signed up (MSG91 OTP, mocked) but has NOT yet
 * created a vendor_profile. Deterministic ID so the onboarding E2E can
 * inject a session and drive createVendorProfileAction against a clean
 * "no profile" state. Intentionally NOT inserted into vendor_profiles.
 */
const NO_PROFILE_VENDOR = {
  userId: 'u_seed_v_onboarding',
  email: 'onboarding@seed.outvers.dev',
  name: 'Onboarding Candidate',
} as const

/**
 * A SECOND customer who owns the business-tier Vendor's manageable
 * Bookings (mark-complete / vendor-cancel / dispute targets seeded for
 * Issue #19). Kept DISTINCT from `u_seed_customer` so the business-Vendor
 * booking-management E2E (vendor-cancel issues a full Refund to THIS
 * customer's Refund balance, and SLA-score mutations) never disturbs the
 * `u_seed_customer` wallet/booking determinism asserted by #13–#15.
 */
const BUSINESS_VENDOR_CUSTOMER = {
  userId: 'u_seed_customer_biz',
  email: 'customer-biz@seed.outvers.dev',
  name: 'Seed Customer (Business-Vendor Bookings)',
} as const

const EXPERIENCES: SeededExperience[] = [
  // identity-tier vendor — Rishikesh + Manali Experiences
  {
    vendorUserId: 'u_seed_v_identity',
    slug: 'rishikesh-rafting-grade-iii',
    title: 'Grade III White-Water Rafting (Rishikesh, 16 km)',
    shortDescription: 'Classic 16-km Ganga stretch with three named rapids. ISA-certified guides. Includes safety brief, gear, and post-run chai.',
    longDescription: 'Run the iconic Brahmapuri-to-Rishikesh stretch with a fully-equipped expedition raft. All gear (helmet, PFD, paddle, dry-bag) provided. Guide-to-guest ratio 1:6 maximum. Suitable for ages 14+, swimmers and non-swimmers.',
    pricePerPerson_1_2: '1500.00',
    pricePerPerson_3_5: '1300.00',
    pricePerPerson_6_plus: '1100.00',
    regionSlug: 'rishikesh',
    activitySlug: 'rafting',
  },
  {
    vendorUserId: 'u_seed_v_identity',
    slug: 'rishikesh-kayaking-introduction',
    title: 'Beginner Kayaking — Calm-Water Introduction (Rishikesh)',
    shortDescription: 'Two-hour intro to kayaking on a flat-water stretch. No experience required. Safety kayak escort included.',
    longDescription: 'Learn the basic strokes and self-rescue on a sheltered Ganga back-channel. Sit-on-top kayaks; one-to-one guide attention for the first 30 minutes. Family-friendly for ages 10+.',
    pricePerPerson_1_2: '1800.00',
    pricePerPerson_3_5: '1600.00',
    pricePerPerson_6_plus: '1400.00',
    regionSlug: 'rishikesh',
    activitySlug: 'kayaking',
  },
  {
    vendorUserId: 'u_seed_v_identity',
    slug: 'manali-hampta-pass-trek-5d',
    title: 'Hampta Pass Trek — 5 Days, Crossover Trail',
    shortDescription: 'Five-day high-altitude crossover from Kullu green valleys to Lahaul desert. Tents, meals, permits included.',
    longDescription: 'Cross 4,270m Hampta Pass over five days. Camp at Chika, Balu Ka Ghera, and Shea Goru. Daily distances 6–14 km, gentle to moderate technical grade. Acclimatisation day at Chika built in. Best Jun–Oct.',
    pricePerPerson_1_2: '12500.00',
    pricePerPerson_3_5: '11500.00',
    pricePerPerson_6_plus: '10500.00',
    regionSlug: 'manali',
    activitySlug: 'trekking',
  },
  {
    vendorUserId: 'u_seed_v_identity',
    slug: 'manali-solang-paragliding-tandem',
    title: 'Tandem Paragliding over Solang Valley',
    shortDescription: '15-minute tandem flight from Solang launch site. APPI-rated pilots, GoPro footage included.',
    longDescription: 'Take off from the 2,560m Solang launch with a certified tandem pilot. Soar over the Beas valley with views of Hanuman Tibba and Friendship Peak. Includes pilot, gear, and high-res GoPro reel.',
    pricePerPerson_1_2: '3500.00',
    pricePerPerson_3_5: '3200.00',
    pricePerPerson_6_plus: '3000.00',
    regionSlug: 'manali',
    activitySlug: 'paragliding',
  },
  // business-tier vendor — Bir-Billing + Goa Experiences
  {
    vendorUserId: 'u_seed_v_business',
    slug: 'bir-billing-paragliding-full-day',
    title: 'Bir-Billing Paragliding — Full-Day with Pilot Briefing',
    shortDescription: 'Launch from 2,400m Billing, land at 1,400m Bir. 25-minute flight. Pilot briefing + pickup included.',
    longDescription: 'Bir-Billing is India\'s premier paragliding site, host to the 2015 World Cup. Tandem flights are 25–40 minutes depending on thermals. Includes pilot, gear, pre-flight briefing, transport between launch and landing, and your video reel. Weather windows: Mar–May and Sep–Nov.',
    pricePerPerson_1_2: '3000.00',
    pricePerPerson_3_5: '2800.00',
    pricePerPerson_6_plus: '2600.00',
    regionSlug: 'bir-billing',
    activitySlug: 'paragliding',
  },
  {
    vendorUserId: 'u_seed_v_business',
    slug: 'goa-scuba-diving-padi-dsd',
    title: 'PADI Discover Scuba Diving (Goa, Grande Island)',
    shortDescription: 'Half-day intro to scuba diving at Grande Island. PADI-certified instructors, all gear included.',
    longDescription: 'Boat ride from Vasco to Grande Island. 30-minute pool/shallow briefing followed by a 30-minute reef dive to ~8m. No prior dive experience needed; swimming ability required. Reef sightings: parrotfish, butterflyfish, occasional rays. Best Oct–May.',
    pricePerPerson_1_2: '4500.00',
    pricePerPerson_3_5: '4200.00',
    pricePerPerson_6_plus: '4000.00',
    regionSlug: 'goa',
    activitySlug: 'scuba-diving',
  },
  {
    vendorUserId: 'u_seed_v_business',
    slug: 'goa-scuba-diving-fun-dive-cert',
    title: 'Certified Fun Dive — Twin Tank (Goa, Suzy\'s Wreck)',
    shortDescription: 'Two-tank guided dive at Suzy\'s Wreck for certified divers. Open Water cert or higher required.',
    longDescription: 'For certified divers (PADI/SSI/CMAS Open Water or above). Two guided dives at Suzy\'s Wreck and Bounty Bay. ~30 minutes bottom time per dive, 12–18m max depth. Gear included; logbook stamped on return. Show your cert card at check-in.',
    pricePerPerson_1_2: '5500.00',
    pricePerPerson_3_5: '5200.00',
    pricePerPerson_6_plus: '5000.00',
    regionSlug: 'goa',
    activitySlug: 'scuba-diving',
  },
  {
    vendorUserId: 'u_seed_v_business',
    slug: 'bir-billing-camping-mountain-stay',
    title: 'Mountain-View Camping — 1 Night, Bir',
    shortDescription: 'Single-night camping in alpine tents above Bir landing field. Bonfire + simple dinner.',
    longDescription: 'Pitched-in-advance alpine tents at 1,600m above Bir landing field. Mattresses, sleeping bags, hot dinner, breakfast, and bonfire included. Stargazing on clear nights. Walk-up to the launch site option available next morning.',
    pricePerPerson_1_2: '1800.00',
    pricePerPerson_3_5: '1500.00',
    pricePerPerson_6_plus: '1300.00',
    regionSlug: 'bir-billing',
    activitySlug: 'camping',
  },
]

async function seed(): Promise<void> {
  console.warn('seeding fresh demo data…')

  // ----- USERS -----
  await db
    .insert(users)
    .values([
      { id: 'u_seed_admin', email: 'admin@seed.outvers.dev', name: 'Seed Admin' },
      { id: 'u_seed_customer', email: 'customer@seed.outvers.dev', name: 'Seed Customer' },
      {
        id: BUSINESS_VENDOR_CUSTOMER.userId,
        email: BUSINESS_VENDOR_CUSTOMER.email,
        name: BUSINESS_VENDOR_CUSTOMER.name,
      },
      ...VENDORS.map((v) => ({ id: v.userId, email: v.email, name: v.businessName })),
      // Signed-up vendor with no profile yet (drives onboarding E2E #16).
      {
        id: NO_PROFILE_VENDOR.userId,
        email: NO_PROFILE_VENDOR.email,
        name: NO_PROFILE_VENDOR.name,
      },
    ])
    .onConflictDoNothing()

  // ----- ADMIN -----
  await db
    .insert(adminProfiles)
    .values({ userId: 'u_seed_admin', permissions: ['*'] })
    .onConflictDoNothing()

  // ----- CUSTOMERS -----
  await db
    .insert(customerProfiles)
    .values([
      { userId: 'u_seed_customer' },
      { userId: BUSINESS_VENDOR_CUSTOMER.userId },
    ])
    .onConflictDoNothing()

  // ----- VENDORS -----
  for (const v of VENDORS) {
    await db
      .insert(vendorProfiles)
      .values({
        userId: v.userId,
        businessName: v.businessName,
        slug: v.slug,
        kycTier: v.kycTier,
        pan: v.pan,
        payoutMethod: v.payout?.method,
        payoutDestination: v.payout?.dest,
      })
      .onConflictDoNothing()
  }

  // ----- EXPERIENCES (status=published so the public pages find them) -----
  const insertedExperiences = await db
    .insert(experiences)
    .values(
      EXPERIENCES.map((e) => ({
        vendorUserId: e.vendorUserId,
        slug: e.slug,
        title: e.title,
        shortDescription: e.shortDescription,
        longDescription: e.longDescription,
        cancellationPreset: 'flexible' as const,
        paymentModesAllowed: ['full_upfront', 'partial_pay'] as (
          | 'full_upfront'
          | 'partial_pay'
          | 'reserve_now_pay_later'
        )[],
        pricePerPerson_1_2: e.pricePerPerson_1_2,
        pricePerPerson_3_5: e.pricePerPerson_3_5,
        pricePerPerson_6_plus: e.pricePerPerson_6_plus,
        regionSlug: e.regionSlug,
        activitySlug: e.activitySlug,
        status: 'published' as const,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: experiences.id, slug: experiences.slug })

  // If onConflictDoNothing returned [], the experiences existed already —
  // look them up by slug so we can still seed slots for them.
  const allExperiences = insertedExperiences.length
    ? insertedExperiences
    : await db
        .select({ id: experiences.id, slug: experiences.slug })
        .from(experiences)
        .where(inArray(experiences.slug, EXPERIENCES.map((e) => e.slug)))

  // ----- AVAILABILITY SLOTS — one slot T+7d per Experience, capacity 8 -----
  // Anchor the slot to a fixed morning hour (04:00 UTC = 09:30 IST) so the
  // 4-hour activity window (→ 08:00 UTC / 13:30 IST) stays within a single
  // calendar day in BOTH UTC and IST. The ADR-0007 identity-tier cap
  // forbids multi-day Experiences via a same-calendar-day(UTC) check; a
  // floating `Date.now() + 7d` start can push end-time past UTC midnight
  // depending on the wall-clock time the seed runs, which would falsely
  // trip MULTI_DAY_NOT_ALLOWED and make identity-tier Experiences
  // un-bookable. Pinning the hour keeps every seeded slot single-day.
  const startAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  startAt.setUTCHours(4, 0, 0, 0)
  const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
  for (const exp of allExperiences) {
    await db
      .insert(availabilitySlots)
      .values({ experienceId: exp.id, startAt, endAt, capacity: 8 })
      .onConflictDoNothing()
  }

  // ----- BOOKINGS — mix of states for demo dashboards -----
  // Order slots deterministically by Experience slug so the same
  // Experiences always receive bookings + reviews across reseeds. This
  // keeps Review JSON-LD (ADR-0013) on a known Experience for E2E.
  const slotsBySlug = await db
    .select({
      id: availabilitySlots.id,
      experienceId: availabilitySlots.experienceId,
      slug: experiences.slug,
    })
    .from(availabilitySlots)
    .innerJoin(experiences, eq(availabilitySlots.experienceId, experiences.id))

  // Stable, well-known order: completed (reviewed) Experiences first so
  // the flagship rafting + paragliding Experiences always carry reviews.
  const SLOT_PRIORITY = [
    'rishikesh-rafting-grade-iii',
    'manali-solang-paragliding-tandem',
    'goa-scuba-diving-padi-dsd',
    'bir-billing-paragliding-full-day',
    'manali-hampta-pass-trek-5d',
  ]
  const slotRows = [...slotsBySlug].sort((a, b) => {
    const ai = SLOT_PRIORITY.indexOf(a.slug)
    const bi = SLOT_PRIORITY.indexOf(b.slug)
    const aRank = ai === -1 ? Number.MAX_SAFE_INTEGER : ai
    const bRank = bi === -1 ? Number.MAX_SAFE_INTEGER : bi
    if (aRank !== bRank) return aRank - bRank
    return a.slug.localeCompare(b.slug)
  })

  const BOOKING_SEEDS = [
    // First two completed → these Experiences carry published reviews.
    { state: 'completed' as const, participants: 3 },
    { state: 'completed' as const, participants: 2 },
    { state: 'confirmed' as const, participants: 2 },
    { state: 'confirmed' as const, participants: 4 },
    { state: 'cancelled_by_customer' as const, participants: 1 },
  ]

  const seededBookings: { id: string; experienceId: string; state: string }[] = []

  // ----- OUTSIDE-POLICY BOOKING — confirmed Booking on a PAST slot -----
  // The flexible preset's 50%-window closes at T-2h; a Booking whose slot
  // already started is unambiguously `outside_policy` at cancel time, so
  // cancelling it routes to a Dispute rather than auto-crediting (ADR-0005).
  // It lives on `rishikesh-kayaking-introduction`, an Experience that does
  // NOT receive any of the five demo bookings above and is NOT in the review
  // priority list, so this addition cannot disturb Issue #11's review
  // determinism on rishikesh-rafting-grade-iii. The slot is anchored to a
  // fixed past UTC hour (T-7d, 04:00 UTC) so its start_at is deterministic
  // across reseeds and never collides with the future T+7d slot above.
  const OUTSIDE_POLICY_SLUG = 'rishikesh-kayaking-introduction'
  const pastStartAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  pastStartAt.setUTCHours(4, 0, 0, 0)
  const pastEndAt = new Date(pastStartAt.getTime() + 4 * 60 * 60 * 1000)
  const outsidePolicyExp = allExperiences.find((e) => e.slug === OUTSIDE_POLICY_SLUG)
  if (outsidePolicyExp) {
    const [pastSlot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: outsidePolicyExp.id,
        startAt: pastStartAt,
        endAt: pastEndAt,
        capacity: 8,
      })
      .onConflictDoNothing()
      .returning({ id: availabilitySlots.id })

    const pastSlotId =
      pastSlot?.id ??
      (
        await db
          .select({ id: availabilitySlots.id })
          .from(availabilitySlots)
          .where(eq(availabilitySlots.startAt, pastStartAt))
      )[0]?.id

    if (pastSlotId) {
      const kayakPrice = Math.floor(
        Number(
          EXPERIENCES.find((e) => e.slug === OUTSIDE_POLICY_SLUG)?.pricePerPerson_1_2 ?? '1800',
        ),
      )
      const kayakGross = kayakPrice * 2
      const [row] = await db
        .insert(bookings)
        .values({
          customerUserId: 'u_seed_customer',
          experienceId: outsidePolicyExp.id,
          slotId: pastSlotId,
          participantCount: 2,
          state: 'confirmed',
          paymentMode: 'full_upfront',
          grossTotalSnapshot: String(kayakGross),
          pricePerParticipantSnapshot: String(kayakPrice),
          pricingBasisSnapshot: 'base_price',
          commissionRateSnapshot: '20.00',
          commissionBasisSnapshot: 'platform_default',
          gstRateOnCommissionSnapshot: '18.00',
          tdsAmountSnapshot: String(Math.floor(kayakGross * 0.01)),
          cancellationPresetSnapshot: 'flexible',
          vendorIsResidentSnapshot: true,
          confirmedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: bookings.id })
      if (row) {
        seededBookings.push({
          id: row.id,
          experienceId: outsidePolicyExp.id,
          state: 'confirmed',
        })
      }
    }
  }

  for (let i = 0; i < Math.min(BOOKING_SEEDS.length, slotRows.length); i++) {
    const slot = slotRows[i]
    const seed = BOOKING_SEEDS[i]
    const exp = allExperiences.find((e) => e.id === slot.experienceId)
    if (!exp) continue

    const expData = EXPERIENCES.find((e) => e.slug === exp.slug)
    const price = Math.floor(Number(expData?.pricePerPerson_1_2 ?? '2000'))
    const gross = price * seed.participants

    try {
      const [row] = await db
        .insert(bookings)
        .values({
          customerUserId: 'u_seed_customer',
          experienceId: slot.experienceId,
          slotId: slot.id,
          participantCount: seed.participants,
          state: seed.state,
          paymentMode: 'full_upfront',
          grossTotalSnapshot: String(gross),
          pricePerParticipantSnapshot: String(price),
          pricingBasisSnapshot: 'base_price',
          commissionRateSnapshot: '20.00',
          commissionBasisSnapshot: 'platform_default',
          gstRateOnCommissionSnapshot: '18.00',
          tdsAmountSnapshot: String(Math.floor(gross * 0.01)),
          cancellationPresetSnapshot: 'flexible',
          vendorIsResidentSnapshot: true,
          confirmedAt: seed.state !== 'cancelled_by_customer' ? new Date() : undefined,
          completedAt: seed.state === 'completed' ? new Date() : undefined,
          cancelledAt: seed.state === 'cancelled_by_customer' ? new Date() : undefined,
        })
        .onConflictDoNothing()
        .returning({ id: bookings.id })

      if (row) {
        seededBookings.push({ id: row.id, experienceId: slot.experienceId, state: seed.state })
      }
    } catch {
      // Booking may already exist — skip
    }
  }

  // ===================================================================
  // BUSINESS-VENDOR MANAGEABLE BOOKINGS (Issue #19)
  // ===================================================================
  // The business-tier Vendor (u_seed_v_business — the E2E vendor session)
  // owns the Bookings the vendor booking-management surfaces operate on:
  //   - mark-complete         → an `awaiting_completion` Booking
  //   - vendor-cancel         → a `confirmed` Booking
  //   - mark-complete BLOCKED → a `disputed` Booking (ADR-0003)
  //
  // Each lands on a DISTINCT business-Vendor Experience and a DISTINCT,
  // fixed-UTC-hour slot disjoint from BOTH the future T+7d demo slots AND
  // the 2026-07-xx window the availability E2E (#18) materialises into, so
  // neither suite clobbers the other. Slots referenced by a Booking survive
  // `clearAvailabilityForExperience` (FK onDelete:'restrict'), so the
  // availability tests' resets leave these Bookings intact.
  //
  // They are owned by BUSINESS_VENDOR_CUSTOMER (not u_seed_customer) so the
  // vendor-cancel full Refund + SLA-score hit never disturbs #13–#15.
  //
  // Payments are seeded directly (NOT via the booking-create Server Action)
  // so the Booking-detail Payment Timeline shows the real funding schedule
  // (Advance captured → T-24h balance) instead of a dead empty state, and
  // so no `booking.create`/`booking.cancel` audit rows are written for seed
  // Bookings (which would break the per-booking audit-count assertions).
  //
  // The slot hour is pinned to 02:00 UTC (a different hour from the 04:00
  // UTC demo slots) so these inserts never collide with the demo slot on
  // the same Experience+startAt unique pairing.
  interface ManageableBookingSeed {
    readonly slug: string
    readonly state: 'awaiting_completion' | 'confirmed' | 'disputed'
    readonly participants: number
    readonly paymentMode: 'full_upfront' | 'partial_pay'
    readonly dayOffset: number // days from now; negative = past
  }

  const MANAGEABLE_BOOKINGS: ManageableBookingSeed[] = [
    // mark-complete target: experience already happened (start_at in the
    // past) and the Booking advanced to awaiting_completion. partial_pay so
    // the timeline carries BOTH the Advance and the T-24h balance capture.
    {
      slug: 'goa-scuba-diving-fun-dive-cert',
      state: 'awaiting_completion',
      participants: 2,
      paymentMode: 'partial_pay',
      dayOffset: -2,
    },
    // vendor-cancel target: a future, still-confirmed Booking.
    {
      slug: 'bir-billing-camping-mountain-stay',
      state: 'confirmed',
      participants: 2,
      paymentMode: 'full_upfront',
      dayOffset: 10,
    },
    // mark-complete BLOCKED target: an open Dispute (ADR-0003) — a Customer
    // raised an issue before completion, so completion is blocked.
    {
      slug: 'goa-scuba-diving-padi-dsd',
      state: 'disputed',
      participants: 2,
      paymentMode: 'partial_pay',
      dayOffset: -3,
    },
  ]

  const ADVANCE_FRACTION = 0.25

  for (const mb of MANAGEABLE_BOOKINGS) {
    const exp = allExperiences.find((e) => e.slug === mb.slug)
    const expData = EXPERIENCES.find((e) => e.slug === mb.slug)
    if (!exp || !expData) continue

    // A distinct, deterministic slot at a fixed UTC hour for this Booking.
    const mbStartAt = new Date(Date.now() + mb.dayOffset * 24 * 60 * 60 * 1000)
    mbStartAt.setUTCHours(2, 0, 0, 0)
    const mbEndAt = new Date(mbStartAt.getTime() + 4 * 60 * 60 * 1000)

    const [mbSlot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: exp.id,
        startAt: mbStartAt,
        endAt: mbEndAt,
        capacity: 8,
        capacityTaken: mb.participants,
      })
      .onConflictDoNothing()
      .returning({ id: availabilitySlots.id })

    const mbSlotId =
      mbSlot?.id ??
      (
        await db
          .select({ id: availabilitySlots.id })
          .from(availabilitySlots)
          .where(eq(availabilitySlots.startAt, mbStartAt))
      ).find(() => true)?.id

    if (!mbSlotId) continue

    const mbPrice = Math.floor(Number(expData.pricePerPerson_1_2))
    const mbGross = mbPrice * mb.participants
    const confirmedAt = new Date(mbStartAt.getTime() - 5 * 24 * 60 * 60 * 1000)

    const [mbRow] = await db
      .insert(bookings)
      .values({
        customerUserId: BUSINESS_VENDOR_CUSTOMER.userId,
        experienceId: exp.id,
        slotId: mbSlotId,
        participantCount: mb.participants,
        state: mb.state,
        paymentMode: mb.paymentMode,
        grossTotalSnapshot: String(mbGross),
        pricePerParticipantSnapshot: String(mbPrice),
        pricingBasisSnapshot: 'base_price',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'platform_default',
        gstRateOnCommissionSnapshot: '18.00',
        tdsAmountSnapshot: String(Math.floor(mbGross * 0.001)),
        cancellationPresetSnapshot: 'flexible',
        vendorPanSnapshot: 'GHIJK5678L',
        vendorIsResidentSnapshot: true,
        payoutMethodSnapshot: 'bank_account',
        payoutDestinationSnapshot: {
          accountHolder: 'Goa Dive Center',
          ifsc: 'HDFC0000123',
          accountNumber: '1234567890',
        },
        confirmedAt,
      })
      .onConflictDoNothing()
      .returning({ id: bookings.id })

    if (!mbRow) continue
    seededBookings.push({ id: mbRow.id, experienceId: exp.id, state: mb.state })

    // ----- PAYMENTS — funding timeline for the Payment Timeline panel -----
    // full_upfront: single 100% Advance at booking-create.
    // partial_pay : 25% Advance at booking-create + 75% T-24h auto-capture,
    //               using floor-on-the-advance so advance+balance === gross
    //               (matches lib/payments/partial-pay-autocapture rounding).
    const paymentRows: {
      razorpayPaymentId: string
      amount: string
      captureTrigger: 'booking_create' | 'auto_capture_t_minus_24h'
      capturedAt: Date
    }[] = []

    if (mb.paymentMode === 'full_upfront') {
      paymentRows.push({
        razorpayPaymentId: `seed_pay_${mb.slug}_full`,
        amount: String(mbGross),
        captureTrigger: 'booking_create',
        capturedAt: confirmedAt,
      })
    } else {
      const advance = Math.floor(mbGross * ADVANCE_FRACTION)
      const balance = mbGross - advance
      paymentRows.push({
        razorpayPaymentId: `seed_pay_${mb.slug}_advance`,
        amount: String(advance),
        captureTrigger: 'booking_create',
        capturedAt: confirmedAt,
      })
      paymentRows.push({
        razorpayPaymentId: `seed_pay_${mb.slug}_balance`,
        amount: String(balance),
        captureTrigger: 'auto_capture_t_minus_24h',
        // Balance captured ~24h before the slot start.
        capturedAt: new Date(mbStartAt.getTime() - 24 * 60 * 60 * 1000),
      })
    }

    for (const p of paymentRows) {
      await db
        .insert(payments)
        .values({
          bookingId: mbRow.id,
          razorpayPaymentId: p.razorpayPaymentId,
          // Each capture is its own Razorpay order in the seed. The schema's
          // partial-unique index on razorpay_order_id (WHERE NOT NULL) means
          // a shared order id across the Advance + balance rows would drop
          // the second row via onConflictDoNothing — so key it per payment.
          razorpayOrderId: `seed_order_${p.razorpayPaymentId}`,
          amount: p.amount,
          captureTrigger: p.captureTrigger,
          capturedAt: p.capturedAt,
        })
        .onConflictDoNothing()
    }
  }

  // ----- REVIEWS — on completed bookings -----
  const REVIEW_TEXTS = [
    { rating: 5, title: 'Best adventure experience ever!', body: 'The guides were fantastic and safety protocols were top-notch. Beautiful views and perfect weather. Would recommend to anyone visiting.' },
    { rating: 4, title: 'Great experience, minor logistics issues', body: 'The activity itself was amazing. Only downside was the pickup was 20 minutes late. But once we got there, everything was perfect.' },
    { rating: 5, title: 'Incredible guides and scenery', body: 'Our guide was extremely knowledgeable and made the experience both safe and fun. The scenery was breathtaking. Already planning our next trip.' },
  ]

  const completedBookings = seededBookings.filter((b) => b.state === 'completed')
  for (let i = 0; i < Math.min(REVIEW_TEXTS.length, completedBookings.length); i++) {
    const booking = completedBookings[i]
    const review = REVIEW_TEXTS[i]
    const exp = allExperiences.find((e) => e.id === booking.experienceId)
    const expData = EXPERIENCES.find((e) => e.slug === exp?.slug)

    await db
      .insert(reviews)
      .values({
        bookingId: booking.id,
        customerUserId: 'u_seed_customer',
        experienceId: booking.experienceId,
        vendorUserId: expData?.vendorUserId ?? 'u_seed_v_identity',
        rating: review.rating,
        title: review.title,
        body: review.body,
        status: 'published',
      })
      .onConflictDoNothing()
  }

  // ===================================================================
  // BUSINESS-VENDOR SECONDARY SURFACES (Issue #20)
  // ===================================================================
  // The vendor reviews / payouts / messages surfaces are validated against
  // the business-tier Vendor (u_seed_v_business — the E2E vendor session).
  // The demo data above seeds Reviews only on the IDENTITY vendor's
  // Experiences, no Payout-earning Booking with the full ADR-0016 tax
  // breakdown, and no Conversation at all — so #20 surfaces would have
  // nothing to validate. Seed exactly one of each, deterministically and
  // isolated from the #18/#19 fixtures:
  //
  //   - REVIEW : one published Review with NO vendor response yet, on a
  //              dedicated completed Booking. The "respond once" E2E submits
  //              a response (persists) then asserts a 2nd is rejected.
  //   - PAYOUT : one completed Booking on bir-billing-paragliding-full-day
  //              with round worked-example tax amounts (gross ₹100,000) so
  //              the payouts breakdown asserts cleanly against
  //              computeVendorNetPayout.
  //   - MESSAGES: one active Conversation + two messages (customer →
  //              vendor) so the inbox list and thread render real content,
  //              not the static "No messages yet" empty state.
  //
  // Both Bookings are owned by BUSINESS_VENDOR_CUSTOMER (not u_seed_customer)
  // and live on DISTINCT, fixed-UTC-hour slots (06:00 UTC) anchored to fixed
  // PAST calendar dates well clear of the July-2026 availability window
  // (#18) and the 02:00-UTC manageable-booking slots (#19), so no suite
  // clobbers another. Payments are NOT seeded for these Bookings (the #20
  // surfaces read snapshots + Review/Conversation rows, not the Payment
  // Timeline), and no booking.create audit rows are written.

  // ----- #20 REVIEW — a business-vendor Review awaiting a response -----
  // On goa-scuba-diving-padi-dsd: #19 only ever queries that Experience in
  // the `disputed` state, so a `completed` Review Booking here never collides
  // with getVendorBookingByStateAndSlug (which is keyed on state + slug).
  const REVIEW_SLUG = 'goa-scuba-diving-padi-dsd'
  const reviewExp = allExperiences.find((e) => e.slug === REVIEW_SLUG)
  const reviewExpData = EXPERIENCES.find((e) => e.slug === REVIEW_SLUG)
  if (reviewExp && reviewExpData) {
    const reviewStartAt = new Date('2026-03-04T06:00:00.000Z')
    const reviewEndAt = new Date(reviewStartAt.getTime() + 4 * 60 * 60 * 1000)

    const [reviewSlot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: reviewExp.id,
        startAt: reviewStartAt,
        endAt: reviewEndAt,
        capacity: 8,
        capacityTaken: 2,
      })
      .onConflictDoNothing()
      .returning({ id: availabilitySlots.id })

    const reviewSlotId =
      reviewSlot?.id ??
      (
        await db
          .select({ id: availabilitySlots.id })
          .from(availabilitySlots)
          .where(eq(availabilitySlots.startAt, reviewStartAt))
      ).find(() => true)?.id

    if (reviewSlotId) {
      const reviewPrice = Math.floor(Number(reviewExpData.pricePerPerson_1_2))
      const reviewGross = reviewPrice * 2
      const [reviewBookingRow] = await db
        .insert(bookings)
        .values({
          customerUserId: BUSINESS_VENDOR_CUSTOMER.userId,
          experienceId: reviewExp.id,
          slotId: reviewSlotId,
          participantCount: 2,
          state: 'completed',
          paymentMode: 'full_upfront',
          grossTotalSnapshot: String(reviewGross),
          pricePerParticipantSnapshot: String(reviewPrice),
          pricingBasisSnapshot: 'base_price',
          commissionRateSnapshot: '20.00',
          commissionBasisSnapshot: 'platform_default',
          gstRateOnCommissionSnapshot: '18.00',
          tdsAmountSnapshot: String(Math.floor(reviewGross * 0.001)),
          tcsAmountSnapshot: String(Math.floor(reviewGross * 0.005)),
          tcsRateSnapshot: '0.50',
          cancellationPresetSnapshot: 'flexible',
          vendorPanSnapshot: 'GHIJK5678L',
          vendorIsResidentSnapshot: true,
          confirmedAt: new Date(reviewStartAt.getTime() - 5 * 24 * 60 * 60 * 1000),
          completedAt: reviewEndAt,
        })
        .onConflictDoNothing()
        .returning({ id: bookings.id })

      if (reviewBookingRow) {
        seededBookings.push({
          id: reviewBookingRow.id,
          experienceId: reviewExp.id,
          state: 'completed',
        })
        await db
          .insert(reviews)
          .values({
            bookingId: reviewBookingRow.id,
            customerUserId: BUSINESS_VENDOR_CUSTOMER.userId,
            experienceId: reviewExp.id,
            vendorUserId: 'u_seed_v_business',
            rating: 5,
            title: 'Best dive of the trip',
            body: 'The Grande Island reef was spectacular and the instructor kept the whole group calm and safe. Gear was in great shape and the boat crew were friendly. Already booking again.',
            status: 'published',
            // vendorResponse intentionally NULL — the #20 E2E responds once
            // and asserts a 2nd response is rejected.
          })
          .onConflictDoNothing()
      }
    }
  }

  // ----- #20 PAYOUT — a completed Booking with round worked-example math --
  // Gross ₹100,000 @ 20% commission, 18% GST on commission, 0.1% TDS, 0.5%
  // TCS. Net = 100000 − 20000 − 3600 − 100 − 500 = ₹75,800. The payouts
  // breakdown E2E asserts each line against computeVendorNetPayout.
  const PAYOUT_SLUG = 'bir-billing-paragliding-full-day'
  const payoutExp = allExperiences.find((e) => e.slug === PAYOUT_SLUG)
  if (payoutExp) {
    const payoutStartAt = new Date('2026-02-11T06:00:00.000Z')
    const payoutEndAt = new Date(payoutStartAt.getTime() + 4 * 60 * 60 * 1000)
    const PAYOUT_GROSS = 100000
    const PAYOUT_PARTICIPANTS = 2

    const [payoutSlot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: payoutExp.id,
        startAt: payoutStartAt,
        endAt: payoutEndAt,
        capacity: 8,
        capacityTaken: PAYOUT_PARTICIPANTS,
      })
      .onConflictDoNothing()
      .returning({ id: availabilitySlots.id })

    const payoutSlotId =
      payoutSlot?.id ??
      (
        await db
          .select({ id: availabilitySlots.id })
          .from(availabilitySlots)
          .where(eq(availabilitySlots.startAt, payoutStartAt))
      ).find(() => true)?.id

    if (payoutSlotId) {
      const [payoutBookingRow] = await db
        .insert(bookings)
        .values({
          customerUserId: BUSINESS_VENDOR_CUSTOMER.userId,
          experienceId: payoutExp.id,
          slotId: payoutSlotId,
          participantCount: PAYOUT_PARTICIPANTS,
          state: 'completed',
          paymentMode: 'full_upfront',
          grossTotalSnapshot: String(PAYOUT_GROSS),
          pricePerParticipantSnapshot: String(PAYOUT_GROSS / PAYOUT_PARTICIPANTS),
          pricingBasisSnapshot: 'base_price',
          commissionRateSnapshot: '20.00',
          commissionBasisSnapshot: 'platform_default',
          gstRateOnCommissionSnapshot: '18.00',
          // TDS 0.1% of gross = ₹100; TCS 0.5% of gross = ₹500.
          tdsAmountSnapshot: String(Math.floor(PAYOUT_GROSS * 0.001)),
          tcsAmountSnapshot: String(Math.floor(PAYOUT_GROSS * 0.005)),
          tcsRateSnapshot: '0.50',
          cancellationPresetSnapshot: 'flexible',
          vendorPanSnapshot: 'GHIJK5678L',
          vendorIsResidentSnapshot: true,
          confirmedAt: new Date(payoutStartAt.getTime() - 5 * 24 * 60 * 60 * 1000),
          completedAt: payoutEndAt,
        })
        .onConflictDoNothing()
        .returning({ id: bookings.id })

      if (payoutBookingRow) {
        seededBookings.push({
          id: payoutBookingRow.id,
          experienceId: payoutExp.id,
          state: 'completed',
        })
      }
    }
  }

  // ----- #20 MESSAGES — an active Conversation + thread for the inbox -----
  // A customer-initiated Conversation with two messages so the inbox list and
  // the thread both render real content. Keyed on a fixed subject so reseeds
  // against a non-reset DB stay idempotent (no natural unique key otherwise).
  const SEED_CONVERSATION_SUBJECT = 'Question about the Bir-Billing flight window'
  const existingConvo = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.subject, SEED_CONVERSATION_SUBJECT))
    .limit(1)

  if (existingConvo.length === 0) {
    const convoCreatedAt = new Date('2026-03-01T09:00:00.000Z')
    const [convo] = await db
      .insert(conversations)
      .values({
        vendorUserId: 'u_seed_v_business',
        customerUserId: BUSINESS_VENDOR_CUSTOMER.userId,
        subject: SEED_CONVERSATION_SUBJECT,
        status: 'active',
        createdAt: convoCreatedAt,
        updatedAt: new Date('2026-03-01T11:30:00.000Z'),
      })
      .returning({ id: conversations.id })

    if (convo) {
      await db.insert(messages).values([
        {
          conversationId: convo.id,
          senderUserId: BUSINESS_VENDOR_CUSTOMER.userId,
          body: 'Hi! We are visiting Bir on the 11th — what time window gives the best thermals for a tandem flight?',
          createdAt: convoCreatedAt,
        },
        {
          conversationId: convo.id,
          senderUserId: 'u_seed_v_business',
          body: 'Hello! Late morning, around 10:30–12:00, is usually the sweet spot. I will hold two slots for you.',
          createdAt: new Date('2026-03-01T11:30:00.000Z'),
        },
      ])
    }
  }

  // ----- WALLET — give the seed customer both buckets (ADR-0004) -----
  // Two SEPARATE balance buckets:
  //   refund_balance  — cashable to the original payment method (5–7 day
  //                     Razorpay round-trip). Real liability on the books.
  //   outvers_credit  — closed-loop promo credit, never cashable, EXPIRES
  //                     12–18 months from issue.
  await db
    .insert(walletBalances)
    .values([
      { userId: 'u_seed_customer', balanceType: 'refund_balance' as const, amount: '500.00' },
      { userId: 'u_seed_customer', balanceType: 'outvers_credit' as const, amount: '200.00' },
    ])
    .onConflictDoNothing()

  // The Outvers credit aggregate carries no expiry of its own — expiry lives
  // on the immutable ledger (wallet_transactions.expires_at) per ADR-0004.
  // Seed the matching grant transaction so the dashboard can surface the
  // credit's expiry. Anchor the expiry deterministically to a fixed issue
  // date + 12 months (the short end of the 12–18mo window) so reseeds and
  // E2E assertions stay stable across runs.
  const creditIssuedAt = new Date('2026-01-01T00:00:00.000Z')
  const creditExpiresAt = new Date('2027-01-01T00:00:00.000Z') // +12 months
  // Reseed-idempotent: wallet_transactions has no natural unique key, so
  // onConflictDoNothing would be a no-op and repeated seeds against a
  // non-reset DB would accumulate duplicate credit grants. Key the seed grant
  // on a fixed referenceId and delete any prior copy before inserting.
  const SEED_CREDIT_GRANT_REF = 'seed-credit-grant-u_seed_customer'
  await db
    .delete(walletTransactions)
    .where(eq(walletTransactions.referenceId, SEED_CREDIT_GRANT_REF))
  await db.insert(walletTransactions).values({
    userId: 'u_seed_customer',
    balanceType: 'outvers_credit',
    amount: '200.00',
    source: 'promo',
    referenceId: SEED_CREDIT_GRANT_REF,
    expiresAt: creditExpiresAt,
    createdAt: creditIssuedAt,
  })

  console.warn(
    `seeded ${VENDORS.length} vendors, ${EXPERIENCES.length} experiences, ${allExperiences.length} slots, ${seededBookings.length} bookings, ${completedBookings.length} reviews`,
  )
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('seed failed:', err)
    process.exit(1)
  })
