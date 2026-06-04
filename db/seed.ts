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

import { and, eq, inArray, like } from 'drizzle-orm'

import { db } from './client'
import { seedDefaultAvailability } from './seed-availability'
import { resolveDemoBookingSlotOffsetDays } from './seed-demo-bookings'
import { IMG, seedCatalog } from './seed-extras'
import { galleryFor } from './seed-photos'
import { seedTripGroups } from './seed-trip-groups'
import { vendorVariety } from './seed-vendor-variety'
import { replaceItinerary, type ItineraryStepInput } from '@/lib/experiences/itinerary'
import type { GuideLanguage } from '@/lib/experiences/structured-schema'
import {
  adminProfiles,
  availabilitySlots,
  bookings,
  conversations,
  customerProfiles,
  experiences,
  mediaAssets,
  messages,
  payments,
  refundRequests,
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
  /**
   * Structured Experience attributes (ADR-0017). Optional and additive — only
   * the flagship `rishikesh-rafting-grade-iii` row carries them, as the minimal
   * fixture the PDP structured-render E2E asserts against. Every other row
   * stays bare (all nullable columns → NULL), proving the PDP degrades cleanly.
   * Issue 06 owns the comprehensive fact-checked backfill of the full catalog.
   */
  structured?: StructuredSeed
}

/** The minimal structured fixture written onto the flagship PDP E2E row. */
interface StructuredSeed {
  durationMinutes: number
  difficulty: 'easy' | 'moderate' | 'challenging' | 'extreme'
  minAge: number
  maxGroupSize: number
  languages: GuideLanguage[]
  meetingPoint: string
  seasonMonths: number[]
  highlights: string[]
  inclusions: string[]
  exclusions: string[]
  whatToBring: string[]
  itinerary: ItineraryStepInput[]
}

/**
 * KYC evidence the admin vendor-detail review console (/admin/vendors/[id])
 * surfaces (A0 item 4). The page previously showed six "Not submitted" tiles +
 * "About: Not provided" for every Vendor, so the moderation flow had nothing to
 * demonstrate. The identity- and business-tier demo Vendors now carry their
 * tier-appropriate SUBMITTED evidence; the phone-tier Vendor genuinely keeps a
 * bare evidence state (correct for an un-verified Vendor).
 */
interface VendorKyc {
  gstin?: string
  udyamId?: string
  aadhaarVerifiedAt?: Date
  videoCallVerifiedAt?: Date
  about?: string
  responseTimeSlaScore?: string
}

const VENDORS: Array<{
  userId: string
  email: string
  businessName: string
  slug: string
  kycTier: 'phone' | 'identity' | 'business'
  pan: string | null
  payout: { method: 'upi' | 'bank_account'; dest: Record<string, string> } | null
  kyc?: VendorKyc
}> = [
  {
    userId: 'u_seed_v_phone',
    email: 'phone-tier@seed.outvers.dev',
    businessName: 'Riverbend Adventures (Phone Tier)',
    slug: 'riverbend-adventures',
    kycTier: 'phone' as const,
    pan: null,
    payout: null,
    // No KYC evidence — a phone-tier Vendor is un-verified by definition; the
    // detail page should show a genuine bare evidence state for this one.
  },
  {
    userId: 'u_seed_v_identity',
    email: 'identity-tier@seed.outvers.dev',
    businessName: 'Himalayan Hikes Co (Identity Tier)',
    slug: 'himalayan-hikes-co',
    kycTier: 'identity' as const,
    pan: 'ABCDE1234F',
    payout: { method: 'upi' as const, dest: { vpa: 'himalayan@upi' } },
    // Identity-tier evidence (ADR-0007): Aadhaar + PAN submitted; GSTIN / video
    // call still pending (the next promotion's evidence). About + SLA populated.
    kyc: {
      aadhaarVerifiedAt: new Date('2026-02-10T09:30:00.000Z'),
      about:
        'A Manali-based trekking outfit running guided Himalayan crossings since 2014. Aadhaar + PAN verified; awaiting GSTIN and the video-call step for Business verification.',
      responseTimeSlaScore: '92.50',
    },
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
    // Business-tier evidence (ADR-0007): the full stack submitted — PAN, GSTIN,
    // Aadhaar + video-call verified — so the detail page demonstrates a complete,
    // verified Vendor (the reference for the moderation console).
    kyc: {
      gstin: '30ABCDE5678L1Z2',
      aadhaarVerifiedAt: new Date('2026-01-15T11:00:00.000Z'),
      videoCallVerifiedAt: new Date('2026-01-22T06:30:00.000Z'),
      about:
        'A PADI-certified Goa dive operator running Grande Island boat dives and Discover-Scuba sessions year-round. Fully Business-verified with GSTIN on file.',
      responseTimeSlaScore: '98.00',
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

/**
 * A DEDICATED Customer who owns the pending refund_request fixtures the admin
 * refund-queue E2E (#24) approves / rejects. Kept DISTINCT from both
 * `u_seed_customer` (#13–#15 wallet determinism) and BUSINESS_VENDOR_CUSTOMER
 * (#19/#20) so crediting THIS customer's Refund balance on approve never
 * disturbs any other spec's wallet assertions.
 */
const REFUND_QUEUE_CUSTOMER = {
  userId: 'u_seed_customer_refundq',
  email: 'customer-refundq@seed.outvers.dev',
  name: 'Seed Customer (Admin Refund Queue)',
} as const

/**
 * A DEDICATED Identity-verified Vendor who owns the pending Payout fixtures the
 * admin payout-queue E2E (#24) approves / holds / rejects + exercises the
 * ADR-0016 first-3-manual-approval gate against. Kept DISTINCT from the three
 * demo Vendors so the gate's manual_payouts_remaining 3→2→1→0 decrement and
 * the one-way payout-state transitions never disturb #20's vendor-side payout
 * sums (which read u_seed_v_business) or #22's KYC/commission mutations
 * (which read u_seed_v_identity / u_seed_v_phone).
 */
const PAYOUT_QUEUE_VENDOR = {
  userId: 'u_seed_v_payout',
  email: 'payout-queue@seed.outvers.dev',
  businessName: 'Apex Payout Vendor (Identity Tier)',
  slug: 'apex-payout-vendor',
} as const

/**
 * A DEDICATED Identity-verified Vendor whose SINGLE completed, pending-payout
 * Booking is owned EXCLUSIVELY by the #28 server-side permission-gate E2E
 * ("BLOCKED: a Sub-admin lacking `payouts` cannot approve a Payout"). Kept
 * DISTINCT from PAYOUT_QUEUE_VENDOR (#24) because the #24 payout-queue tests
 * approve/hold/REJECT every pending Booking of their vendor in PARALLEL worker
 * describe blocks. When #28 force-staged a PAYOUT_QUEUE_VENDOR Booking to
 * `pending`, the #24 reject test (running concurrently) grabbed and rejected it
 * out from under #28, flipping the gate assertion's expected `pending` →
 * `rejected` (the #109 order-dependent payout race). Isolating #28 on its own
 * vendor pool removes the cross-describe contention entirely. manual_payouts_
 * remaining is irrelevant here (the gate denies BEFORE any decrement).
 */
const PAYOUT_GATE_VENDOR = {
  userId: 'u_seed_v_payout_gate',
  email: 'payout-gate@seed.outvers.dev',
  businessName: 'Sentinel Payout-Gate Vendor (Identity Tier)',
  slug: 'sentinel-payout-gate-vendor',
} as const

/**
 * A DEDICATED Customer who receives the manual Outvers-credit / Refund-balance
 * grants the admin loyalty-grant E2E (#26) issues. Kept DISTINCT from
 * `u_seed_customer` (whose two-bucket wallet is asserted exactly by #13–#15)
 * so granting credit to THIS customer never disturbs any other spec's wallet
 * determinism. Starts with NO wallet rows.
 */
const LOYALTY_GRANT_CUSTOMER = {
  userId: 'u_seed_customer_loyalty',
  email: 'customer-loyalty@seed.outvers.dev',
  name: 'Seed Customer (Admin Loyalty Grant)',
} as const

/**
 * Commission-tier scope-count fixture (#26, ADR-0008). A DEDICATED Experience
 * owned by the business Vendor, on the `bir-billing` region / `paragliding`
 * category, plus a FIXED set of confirmed Bookings whose created_at is pinned
 * to an explicit September-2026 window. The admin commission-tier E2E creates
 * a Festival tier scoped to THIS Experience over THIS window and asserts
 * getAffectedBookingCount returns exactly COMMISSION_SCOPE_IN_WINDOW (the #34
 * scope-filter fix). One control Booking sits OUTSIDE the window so an
 * over-counting regression is caught. Isolated from every booking dashboard
 * (a never-listed fixture slug) so the fixed-count assertion stays stable.
 */
const COMMISSION_SCOPE_SLUG = 'commission-scope-fixture-bir-billing'
const COMMISSION_SCOPE_WINDOW_START = new Date('2026-09-01T00:00:00.000Z')
const COMMISSION_SCOPE_WINDOW_END = new Date('2026-09-30T23:59:59.000Z')
// Three Bookings created INSIDE the window + one control created BEFORE it.
const COMMISSION_SCOPE_IN_WINDOW = 3

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
    // ── Structured-PDP E2E fixture (ADR-0017) ──────────────────────────────
    // The ONE row carrying full structured attributes so the PDP structured-
    // render E2E can assert every new section. Kept deliberately small;
    // issue 06 owns the fact-checked backfill of the whole catalog. Every
    // other seeded Experience stays bare → proves the PDP degrades cleanly.
    structured: {
      durationMinutes: 240,
      difficulty: 'moderate',
      minAge: 14,
      maxGroupSize: 12,
      languages: ['en', 'hi'],
      meetingPoint: 'Shivpuri rafting base, NH-34, Rishikesh (riverside car park)',
      seasonMonths: [3, 4, 5, 6, 9, 10, 11],
      highlights: [
        'Three named Grade III rapids',
        'ISA-certified river guides (1:6 ratio)',
        'Riverside chai after the run',
      ],
      inclusions: ['Helmet, PFD and paddle', 'Dry-bag for valuables', 'Safety briefing'],
      exclusions: ['GoPro footage', 'Transport to the put-in point'],
      whatToBring: ['Quick-dry clothes', 'A change of dry clothes', 'Secured footwear'],
      itinerary: [
        {
          title: 'Safety briefing & gear-up',
          description: 'Meet your guide at the base, fit your PFD and helmet, and run through paddle commands.',
          dayOffset: null,
          durationMinutes: 30,
        },
        {
          title: 'The 16 km run',
          description: 'Tackle Three Blind Mice, Roller-Coaster and Golf Course rapids with a riverside beach stop.',
          dayOffset: null,
          durationMinutes: 150,
        },
        {
          title: 'Debrief & chai',
          description: 'Wind down at the base with hot chai and your run highlights.',
          dayOffset: null,
          durationMinutes: 30,
        },
      ],
    },
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
    // Structured backfill (ADR-0017, issue 06) — derived from the prose above.
    structured: {
      durationMinutes: 120,
      difficulty: 'easy',
      minAge: 10,
      maxGroupSize: 8,
      languages: ['en', 'hi'],
      meetingPoint: 'Ganga back-channel launch, Rishikesh (flat-water stretch)',
      seasonMonths: [10, 11, 12, 1, 2, 3, 4, 5, 6],
      highlights: ['Calm flat-water introduction', 'One-to-one guide for the first 30 min', 'Safety-kayak escort', 'Family-friendly for ages 10+'],
      inclusions: ['Sit-on-top kayak and PFD', 'Basic strokes and self-rescue coaching', 'Safety-kayak escort'],
      exclusions: ['Transport', 'Meals', 'Photos'],
      whatToBring: ['Quick-dry clothes', 'A change of dry clothes', 'Secured footwear'],
      itinerary: [
        { title: 'Strokes & wet-exit brief', description: 'Learn the basic strokes and self-rescue on a sheltered channel.', dayOffset: null, durationMinutes: 30 },
        { title: 'Guided flat-water paddle', description: 'Practise on the calm back-channel with a safety-kayak escort.', dayOffset: null, durationMinutes: 90 },
      ],
    },
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
    // Structured backfill (ADR-0017, issue 06) — derived from the prose above.
    structured: {
      durationMinutes: 7200,
      difficulty: 'moderate',
      minAge: 12,
      maxGroupSize: 14,
      languages: ['en', 'hi'],
      meetingPoint: 'Manali Mall Road taxi stand (transfer to Jobra roadhead)',
      seasonMonths: [6, 7, 8, 9, 10],
      highlights: ['Crossover 4,270 m Hampta Pass over 5 days', 'Kullu green valleys to Lahaul desert', 'Camps at Chika, Balu Ka Ghera and Shea Goru', 'Built-in acclimatisation day at Chika'],
      inclusions: ['Guide and porter-cooked meals', 'Tents and sleeping bags', 'Permits', 'Full board'],
      exclusions: ['Personal trekking gear', 'Travel insurance', 'Tips'],
      whatToBring: ['Broken-in trekking boots', 'Warm layers and a rain shell', 'Refillable water bottle', 'Headlamp'],
      itinerary: [
        { title: 'Manali to Chika', description: 'Drive to Jobra and trek to the Chika camp.', dayOffset: 0, durationMinutes: 360 },
        { title: 'Chika to Balu Ka Ghera', description: 'Walk along the Rani Nala to the base of the pass.', dayOffset: 1, durationMinutes: 420 },
        { title: 'Cross Hampta Pass to Shea Goru', description: 'Summit the 4,270 m pass and descend into Lahaul.', dayOffset: 2, durationMinutes: 540 },
        { title: 'Shea Goru to Chatru', description: 'Descend through the Lahaul desert valley.', dayOffset: 3, durationMinutes: 300 },
        { title: 'Chandratal & drive out', description: 'Optional Chandratal visit, then drive back to Manali.', dayOffset: 4, durationMinutes: 240 },
      ],
    },
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
    // INTENTIONALLY BARE — no structured (ADR-0017) fields. This is the
    // designated degradation fixture: the PDP must render cleanly with NONE of
    // the structured section shells, and a difficulty facet must never match it
    // (null difficulty). See tests/e2e/specs/unauthenticated/public-pages.spec.ts
    // ("bare Experience degrades cleanly" + the difficulty=moderate facet test).
    // Do NOT add a `structured` block here.
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
    // Structured backfill (ADR-0017, issue 06) — derived from the prose above.
    structured: {
      durationMinutes: 90,
      difficulty: 'easy',
      minAge: 12,
      maxGroupSize: 1,
      languages: ['en', 'hi'],
      meetingPoint: 'Billing take-off, ~2,400 m, ~14 km above Bir',
      seasonMonths: [3, 4, 5, 9, 10, 11],
      highlights: ['Launch from 2,400 m Billing, land at 1,400 m Bir', '25–40 min flight depending on thermals', "India's premier paragliding site (2015 World Cup)", 'Pilot briefing, pickup and video reel'],
      inclusions: ['Certified pilot and gear', 'Pre-flight briefing', 'Launch-to-landing transport', 'Video reel'],
      exclusions: ['Transport to Billing', 'Meals', 'Insurance'],
      whatToBring: ['Warm layers at altitude', 'Closed shoes', 'Sunglasses'],
      itinerary: [
        { title: 'Briefing & transfer to launch', description: 'Pilot briefing and transfer up to the Billing take-off.', dayOffset: null, durationMinutes: 45 },
        { title: 'Tandem flight to Bir', description: 'Soar the Dhauladhar thermals down to the Bir landing field.', dayOffset: null, durationMinutes: 30 },
        { title: 'Landing & reel', description: 'Land at Bir, de-rig and collect your video reel.', dayOffset: null, durationMinutes: 15 },
      ],
    },
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
    // Structured backfill (ADR-0017, issue 06) — derived from the prose above.
    structured: {
      durationMinutes: 240,
      difficulty: 'easy',
      minAge: 10,
      maxGroupSize: 4,
      languages: ['en', 'hi'],
      meetingPoint: 'Vasco boat jetty, Mormugao, Goa',
      seasonMonths: [10, 11, 12, 1, 2, 3, 4, 5],
      highlights: ['Boat ride to Grande Island', '30-min reef dive to ~8 m', 'No prior experience needed', 'Parrotfish, butterflyfish and occasional rays'],
      inclusions: ['Boat transfer and full gear', 'PADI-certified instructor', 'Pool/shallow briefing and reef dive'],
      exclusions: ['Certification card', 'Transport to Vasco', 'Lunch'],
      whatToBring: ['Swimwear', 'Towel', 'Swimming ability', 'Reef-safe sunscreen'],
      itinerary: [
        { title: 'Boat to Grande Island', description: 'Transfer from Vasco with a surface brief.', dayOffset: null, durationMinutes: 60 },
        { title: 'Pool/shallow skills', description: '30-min skills brief in confined water.', dayOffset: null, durationMinutes: 60 },
        { title: 'Guided reef dive', description: '30-min guided reef dive to ~8 m.', dayOffset: null, durationMinutes: 60 },
      ],
    },
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
    // Structured backfill (ADR-0017, issue 06) — derived from the prose above.
    structured: {
      durationMinutes: 300,
      difficulty: 'moderate',
      minAge: 12,
      maxGroupSize: 6,
      languages: ['en', 'hi'],
      meetingPoint: 'Vasco boat jetty, Mormugao, Goa',
      seasonMonths: [10, 11, 12, 1, 2, 3, 4, 5],
      highlights: ['Two guided dives at Suzy’s Wreck and Bounty Bay', '~30 min bottom time per dive', '12–18 m max depth', 'Logbook stamped on return'],
      inclusions: ['Full dive gear', 'Two guided dives', 'Logbook stamp'],
      exclusions: ['Certification course', 'Transport to Vasco', 'Lunch'],
      whatToBring: ['Open Water cert card or higher', 'Swimwear', 'Towel', 'Reef-safe sunscreen'],
      itinerary: [
        { title: 'Check-in & boat out', description: 'Show your cert card, gear up and ride to the first site.', dayOffset: null, durationMinutes: 90 },
        { title: 'Dive 1 — Suzy’s Wreck', description: '~30 min guided dive at the wreck.', dayOffset: null, durationMinutes: 90 },
        { title: 'Surface interval & Dive 2', description: 'Surface interval, then the second guided dive at Bounty Bay.', dayOffset: null, durationMinutes: 120 },
      ],
    },
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
    // Structured backfill (ADR-0017, issue 06) — derived from the prose above.
    structured: {
      durationMinutes: 1080,
      difficulty: 'easy',
      minAge: 6,
      maxGroupSize: 20,
      languages: ['en', 'hi'],
      meetingPoint: 'Bir landing field, ~1,400 m, Bir, Himachal Pradesh',
      seasonMonths: [3, 4, 5, 6, 9, 10, 11],
      highlights: ['Alpine tents above the Bir landing field', 'Bonfire and stargazing on clear nights', 'Hot dinner and breakfast', 'Optional walk-up to the launch site'],
      inclusions: ['Alpine tent with mattress and sleeping bag', 'Hot dinner and breakfast', 'Bonfire'],
      exclusions: ['Transport to Bir', 'Lunch', 'Launch-site transfer'],
      whatToBring: ['Warm layers for the evening', 'Torch', 'Personal toiletries'],
      itinerary: [
        { title: 'Check-in & bonfire', description: 'Settle into your tent, then a bonfire dinner under the stars.', dayOffset: null, durationMinutes: 240 },
        { title: 'Sunrise & breakfast', description: 'Mountain sunrise, breakfast and an optional launch-site walk.', dayOffset: null, durationMinutes: 180 },
      ],
    },
  },
]

async function seed(): Promise<void> {
  console.warn('seeding fresh demo data…')

  // ----- USERS -----
  await db
    .insert(users)
    .values([
      { id: 'u_seed_admin', email: 'admin@seed.outvers.dev', name: 'Seed Admin' },
      // #28 Sub-admin governance fixture — an Admin whose permissions are a
      // STRICT SUBSET (ADR-0006). Holds vendors/audit/analytics but NOT
      // payouts/refunds/sub_admins/reports. Drives the server-side permission
      // gate E2E: a gated action outside this subset must be DENIED.
      { id: 'u_seed_subadmin', email: 'subadmin@seed.outvers.dev', name: 'Seed Sub-Admin' },
      // #28 Dedicated invite target for the sub-admin CRUD E2E (invite → edit
      // → revoke). A plain User with NO vendor/admin profile and referenced by
      // no other project, so the CRUD flow is fully isolated from parallel
      // specs and re-runs start from a known "not an admin" state.
      {
        id: 'u_seed_invite_target',
        email: 'invite-target@seed.outvers.dev',
        name: 'Sub-Admin Invite Target',
      },
      // #28 Dedicated phone-tier Vendor the Sub-admin (who HOLDS the 'vendors'
      // permission) can KYC-approve, proving a permitted action succeeds.
      // Isolated from #22's u_seed_v_phone so neither test disturbs the other.
      {
        id: 'u_seed_subadmin_vendor',
        email: 'subadmin-vendor@seed.outvers.dev',
        name: 'Sub-Admin KYC Fixture Vendor',
      },
      { id: 'u_seed_customer', email: 'customer@seed.outvers.dev', name: 'Seed Customer' },
      {
        id: BUSINESS_VENDOR_CUSTOMER.userId,
        email: BUSINESS_VENDOR_CUSTOMER.email,
        name: BUSINESS_VENDOR_CUSTOMER.name,
      },
      {
        id: REFUND_QUEUE_CUSTOMER.userId,
        email: REFUND_QUEUE_CUSTOMER.email,
        name: REFUND_QUEUE_CUSTOMER.name,
      },
      {
        id: PAYOUT_QUEUE_VENDOR.userId,
        email: PAYOUT_QUEUE_VENDOR.email,
        name: PAYOUT_QUEUE_VENDOR.businessName,
      },
      {
        id: PAYOUT_GATE_VENDOR.userId,
        email: PAYOUT_GATE_VENDOR.email,
        name: PAYOUT_GATE_VENDOR.businessName,
      },
      {
        id: LOYALTY_GRANT_CUSTOMER.userId,
        email: LOYALTY_GRANT_CUSTOMER.email,
        name: LOYALTY_GRANT_CUSTOMER.name,
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

  // ----- #28 SUB-ADMIN (strict-subset permissions per ADR-0006) -----
  // Holds a LIMITED subset: can manage vendors + view audit/analytics, but
  // CANNOT process payouts/refunds, manage sub-admins, or run reports. The
  // governance E2E (#28) asserts a gated action OUTSIDE this subset (e.g.
  // approve payout) is denied server-side, and a permitted action (vendor KYC
  // approve) succeeds.
  await db
    .insert(adminProfiles)
    .values({
      userId: 'u_seed_subadmin',
      permissions: ['vendors', 'audit', 'analytics'],
      invitedByUserId: 'u_seed_admin',
    })
    .onConflictDoNothing()

  // ----- CUSTOMERS -----
  // A1 / profile gaps — the demo customer carries a real default address AND a
  // trusted contact (ADR-0015), so the account → profile + safety surfaces are
  // not blank placeholders. The other (fixture-owned) customers stay bare to
  // avoid disturbing the specs that assert on their clean state.
  await db
    .insert(customerProfiles)
    .values([
      {
        userId: 'u_seed_customer',
        defaultAddress: {
          line1: '14 Tapovan Lane',
          line2: 'Laxman Jhula Road',
          city: 'Rishikesh',
          state: 'Uttarakhand',
          postalCode: '249192',
          country: 'IN',
        },
        trustedContactName: 'Priya Sharma',
        trustedContactPhone: '+91 98765 43210',
        trustedContactRelationship: 'Sister',
      },
      { userId: BUSINESS_VENDOR_CUSTOMER.userId },
      { userId: REFUND_QUEUE_CUSTOMER.userId },
      { userId: LOYALTY_GRANT_CUSTOMER.userId },
    ])
    .onConflictDoNothing()

  // ----- VENDORS -----
  // A1 — differentiate the three seed Vendors: a varied commission base rate
  // and a staggered historical join date (vendorVariety) so the admin vendor
  // list + the analytics "Vendor growth" chart don't read "20% / joined today"
  // everywhere. The SLA / trust score stays explicit where the KYC block sets
  // one (intentional per-tier values the admin console surfaces); only the
  // un-set (phone-tier) Vendor falls back to the varied score. None of the
  // ladder rates is the admin-flows commission-update NEW_RATE (12.50), so the
  // "pick a rate distinct from the seed default" precondition still holds.
  for (let vi = 0; vi < VENDORS.length; vi++) {
    const v = VENDORS[vi]
    const variety = vendorVariety(vi, VENDORS.length)
    await db
      .insert(vendorProfiles)
      .values({
        userId: v.userId,
        businessName: v.businessName,
        slug: v.slug,
        kycTier: v.kycTier,
        pan: v.pan,
        payoutMethod: v.payout?.method,
        // A1 / A0 item 4 — bank account-holder name on the payout destination
        // so the vendor payout-detail screen never shows a blank holder. UPI
        // destinations also carry it for display parity (harmless extra key).
        payoutDestination: v.payout
          ? { accountHolder: v.businessName, ...v.payout.dest }
          : undefined,
        commissionRate: variety.commissionRate,
        createdAt: variety.createdAt,
        // A0 item 4 — submitted KYC evidence / trust factors so the admin
        // vendor-detail moderation console is demonstrable (identity/business
        // tiers only; phone-tier stays bare).
        ...(v.kyc?.gstin ? { gstin: v.kyc.gstin } : {}),
        ...(v.kyc?.udyamId ? { udyamId: v.kyc.udyamId } : {}),
        ...(v.kyc?.aadhaarVerifiedAt ? { aadhaarVerifiedAt: v.kyc.aadhaarVerifiedAt } : {}),
        ...(v.kyc?.videoCallVerifiedAt
          ? { videoCallVerifiedAt: v.kyc.videoCallVerifiedAt }
          : {}),
        ...(v.kyc?.about ? { about: v.kyc.about } : {}),
        // Explicit SLA from the KYC block wins (the per-tier intentional value);
        // otherwise use the varied score so even the phone-tier isn't 100%.
        responseTimeSlaScore: v.kyc?.responseTimeSlaScore ?? variety.responseTimeSlaScore,
      })
      .onConflictDoNothing()
  }

  // ----- #28 SUB-ADMIN KYC FIXTURE VENDOR — phone-tier, pending promotion ---
  // Phone-tier so the Sub-admin's permitted KYC approve promotes it to
  // identity. Isolated from #22's u_seed_v_phone (which the full-admin KYC
  // suite promotes) so the two never collide.
  await db
    .insert(vendorProfiles)
    .values({
      userId: 'u_seed_subadmin_vendor',
      businessName: 'Sub-Admin KYC Fixture Vendor',
      slug: 'subadmin-kyc-fixture-vendor',
      kycTier: 'phone',
      pan: null,
    })
    .onConflictDoNothing()

  // ----- #24 PAYOUT-QUEUE VENDOR — dedicated Identity-verified Vendor -----
  // Identity-tier with manual_payouts_remaining = 3 (the schema default; set
  // explicitly so the ADR-0016 first-3-manual gate starts from a known count
  // regardless of any future default change). Payout destination configured so
  // the payout-snapshot CHECK is satisfiable on its Bookings.
  await db
    .insert(vendorProfiles)
    .values({
      userId: PAYOUT_QUEUE_VENDOR.userId,
      businessName: PAYOUT_QUEUE_VENDOR.businessName,
      slug: PAYOUT_QUEUE_VENDOR.slug,
      kycTier: 'identity',
      pan: 'PQRST6789U',
      manualPayoutsRemaining: 3,
      payoutMethod: 'upi',
      payoutDestination: { vpa: 'apex-payout@upi' },
    })
    .onConflictDoNothing()

  // ----- #28 PERMISSION-GATE VENDOR — dedicated, isolated from #24 ----------
  // Owns a single completed pending-payout Booking the #28 server-side gate
  // test force-stages to `pending` and asserts the Sub-admin CANNOT approve.
  // Separate vendor so the #24 payout-queue approve/hold/reject sweep (a
  // parallel describe block) never touches it (#109 payout race fix).
  await db
    .insert(vendorProfiles)
    .values({
      userId: PAYOUT_GATE_VENDOR.userId,
      businessName: PAYOUT_GATE_VENDOR.businessName,
      slug: PAYOUT_GATE_VENDOR.slug,
      kycTier: 'identity',
      pan: 'STUVW1234X',
      manualPayoutsRemaining: 3,
      payoutMethod: 'upi',
      payoutDestination: { vpa: 'sentinel-gate@upi' },
    })
    .onConflictDoNothing()

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
        // Structured attributes (ADR-0017) — only the flagged fixture row sets
        // them; omitted rows fall back to the nullable/array defaults.
        ...(e.structured
          ? {
              durationMinutes: e.structured.durationMinutes,
              difficulty: e.structured.difficulty,
              minAge: e.structured.minAge,
              maxGroupSize: e.structured.maxGroupSize,
              languages: e.structured.languages,
              meetingPoint: e.structured.meetingPoint,
              seasonMonths: e.structured.seasonMonths,
              highlights: e.structured.highlights,
              inclusions: e.structured.inclusions,
              exclusions: e.structured.exclusions,
              whatToBring: e.structured.whatToBring,
            }
          : {}),
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

  // ----- MEDIA ASSETS (base catalog experiences) -----
  // Distinct, on-subject per-listing galleries (db/seed-photos.ts) so the
  // /search cards and the PDP overview gallery never repeat one stock photo —
  // two same-activity listings get different covers. Re-runnable: clear only
  // base-owned rows by storage-key prefix first.
  await db.delete(mediaAssets).where(like(mediaAssets.storageKey, 'seed/base/%'))
  for (const exp of allExperiences) {
    const meta = EXPERIENCES.find((e) => e.slug === exp.slug)
    if (!meta) continue
    const photos = galleryFor(meta.activitySlug, exp.slug)
    if (photos.length === 0) continue
    await db.insert(mediaAssets).values(
      photos.map((pid, i) => ({
        uploadedBy: 'u_seed_admin',
        storageKey: `seed/base/experience/${exp.slug}/${i}.jpg`,
        url: IMG(pid, 1200),
        contentType: 'image/jpeg',
        sizeBytes: 180_000 + i * 4096,
        altText: `${meta.title} — photo ${i + 1}`,
        entityType: 'experience' as const,
        entityId: exp.id,
      })),
    )
  }

  // ----- DEFAULT AVAILABILITY (recurring patterns → materialised slots) -----
  // Seed a realistic weekly schedule per customer-facing Experience so the PDP
  // booking calendar shows ~90 days of selectable dates (not the 1–2 sparse
  // slots it used to). Idempotent + additive (ON CONFLICT DO NOTHING) — the
  // dedicated demo/E2E slots seeded elsewhere are never disturbed. Vendors can
  // still author their own patterns via the availability manager.
  for (const exp of allExperiences) {
    await seedDefaultAvailability(db, exp.id)
  }

  // ----- STRUCTURED ITINERARY (ADR-0017) — only the flagged fixture row -----
  // Written via replaceItinerary so the dev/E2E PDP has a real itinerary
  // accordion to render. Idempotent: replaceItinerary is delete-then-insert.
  for (const exp of allExperiences) {
    const seed = EXPERIENCES.find((e) => e.slug === exp.slug)
    if (seed?.structured) {
      await replaceItinerary(db, exp.id, seed.structured.itinerary)
    }
  }

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
      startAt: availabilitySlots.startAt,
      slug: experiences.slug,
    })
    .from(availabilitySlots)
    .innerJoin(experiences, eq(availabilitySlots.experienceId, experiences.id))

  // The demo Bookings below address slots by Experience slug explicitly
  // (DEMO_BOOKINGS), so no priority ordering is needed here.
  const slotRows = slotsBySlug

  // The HUMAN demo customer's (u_seed_customer) Booking history. A realistic,
  // varied, deduplicated set against REAL catalog Experience names spanning
  // states (A0 item 1): two completed-in-the-PAST trips that carry the published
  // reviews (flagship rafting + paragliding — Issue #11 review determinism),
  // two upcoming confirmed trips (cancellable → the dashboard cancel link), and
  // one cancelled-in-the-PAST trip (the Hampta cancellation, whose Refund credit
  // is reconciled in the wallet ledger below — A0 item 3).
  //
  // Each Booking carries its OWN slot dated to match its state (A0 item 2b):
  // completed/cancelled sit on PAST slots so a "Completed" trip is never
  // future-dated; confirmed sit on a FUTURE slot. Completed/cancelled get a
  // dedicated 05:00-UTC past slot (disjoint from the 04:00 demo / 02:00 #19 /
  // 06:00 #20 slot hours); confirmed reuse the existing future T+7d demo slot.
  interface DemoBookingSeed {
    readonly slug: string
    readonly state: 'completed' | 'confirmed' | 'cancelled_by_customer'
    readonly participants: number
    /** Days from now for this Booking's slot start; negative = past. */
    readonly dayOffset: number
  }

  const DEMO_BOOKINGS: DemoBookingSeed[] = [
    // Completed in the PAST → these two flagship Experiences carry the reviews.
    { slug: 'rishikesh-rafting-grade-iii', state: 'completed', participants: 3, dayOffset: -21 },
    { slug: 'manali-solang-paragliding-tandem', state: 'completed', participants: 2, dayOffset: -35 },
    // Upcoming confirmed (cancellable → dashboard "Cancel — see refund" link).
    // goa-scuba-diving-padi-dsd is the inside-policy cancel target the E2E reads
    // at runtime; bir-billing-paragliding-full-day is its read-only cancel-link
    // target (never cancelled). Both T+7d, inside the flexible free window.
    { slug: 'bir-billing-paragliding-full-day', state: 'confirmed', participants: 2, dayOffset: 7 },
    { slug: 'goa-scuba-diving-padi-dsd', state: 'confirmed', participants: 2, dayOffset: 7 },
    // Cancelled in the PAST — the Hampta cancellation (drives the wallet refund).
    { slug: 'manali-hampta-pass-trek-5d', state: 'cancelled_by_customer', participants: 1, dayOffset: -14 },
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

  // A future-slot lookup keyed by experience id (the existing T+7d demo slots),
  // reused by the confirmed demo Bookings so their dashboard date is upcoming.
  const futureSlotByExpId = new Map(
    slotRows
      .filter((s) => new Date(s.startAt).getTime() >= Date.now())
      .map((s) => [s.experienceId, s.id]),
  )

  for (const seed of DEMO_BOOKINGS) {
    const exp = allExperiences.find((e) => e.slug === seed.slug)
    const expData = EXPERIENCES.find((e) => e.slug === seed.slug)
    if (!exp || !expData) continue

    const price = Math.floor(Number(expData.pricePerPerson_1_2 ?? '2000'))
    const gross = price * seed.participants

    // Residual fix (2026-06-04): a TERMINAL booking (completed / cancelled_*)
    // must ALWAYS sit on a PAST slot — a "Completed" card dated in the near
    // future reads as broken on the customer dashboard. resolveDemoBooking-
    // SlotOffsetDays coerces any terminal state to the past regardless of the
    // requested offset, so the review-generation paths can never re-introduce a
    // future-dated completed booking. Confirmed keeps its future offset.
    const effectiveOffset = resolveDemoBookingSlotOffsetDays(seed.state, seed.dayOffset)

    // Resolve the slot for this Booking's state-appropriate date.
    let slotId: string | undefined
    if (seed.state === 'confirmed') {
      // Reuse the existing future demo slot for this Experience.
      slotId = futureSlotByExpId.get(exp.id)
    } else {
      // Completed / cancelled → a dedicated PAST slot at a fixed 05:00-UTC hour
      // (disjoint from every other fixture slot hour), deterministic per offset.
      const demoStartAt = new Date(Date.now() + effectiveOffset * 24 * 60 * 60 * 1000)
      demoStartAt.setUTCHours(5, 0, 0, 0)
      const demoEndAt = new Date(demoStartAt.getTime() + 4 * 60 * 60 * 1000)
      const [demoSlot] = await db
        .insert(availabilitySlots)
        .values({
          experienceId: exp.id,
          startAt: demoStartAt,
          endAt: demoEndAt,
          capacity: 8,
          capacityTaken: seed.participants,
        })
        .onConflictDoNothing()
        .returning({ id: availabilitySlots.id })
      slotId =
        demoSlot?.id ??
        (
          await db
            .select({ id: availabilitySlots.id })
            .from(availabilitySlots)
            .where(
              and(
                eq(availabilitySlots.experienceId, exp.id),
                eq(availabilitySlots.startAt, demoStartAt),
              ),
            )
        )[0]?.id
    }
    if (!slotId) continue

    // Lifecycle timestamps consistent with the slot date (a completed trip is
    // confirmed before, and completed after, its PAST slot; a cancelled trip is
    // confirmed before, cancelled before, its PAST slot). Uses the SAME
    // effective (terminal→past) offset as the slot so the dates never diverge.
    const slotStart = new Date(Date.now() + effectiveOffset * 24 * 60 * 60 * 1000)
    const confirmedAt =
      effectiveOffset < 0
        ? new Date(slotStart.getTime() - 5 * 24 * 60 * 60 * 1000)
        : new Date()
    const completedAt =
      seed.state === 'completed'
        ? new Date(slotStart.getTime() + 4 * 60 * 60 * 1000)
        : undefined
    const cancelledAt =
      seed.state === 'cancelled_by_customer'
        ? new Date(slotStart.getTime() - 24 * 60 * 60 * 1000)
        : undefined

    try {
      const [row] = await db
        .insert(bookings)
        .values({
          customerUserId: 'u_seed_customer',
          experienceId: exp.id,
          slotId,
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
          // Every demo Booking was confirmed (a cancelled one was confirmed
          // first, then cancelled); completed/cancelled also carry their event.
          confirmedAt,
          completedAt,
          cancelledAt,
        })
        .onConflictDoNothing()
        .returning({ id: bookings.id })

      if (row) {
        seededBookings.push({ id: row.id, experienceId: exp.id, state: seed.state })
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

  // ===================================================================
  // ADMIN EXPERIENCE-MODERATION FIXTURES (Issue #23)
  // ===================================================================
  // The admin Experience-moderation surface (approve / reject / pause /
  // archive) is only reachable for Experiences seeded into pending_review —
  // there is no draft→pending_review submit transition yet (#10 review). The
  // demo Experiences above are all `published`, so without these fixtures the
  // moderation E2E (#23) would have nothing to approve/reject.
  //
  // Seed five DEDICATED pending_review Experiences owned by the identity-tier
  // Vendor (one per moderation action, plus one OVER-CAP price for the
  // ADR-0007 tier-cap guard rejection path). They are isolated from every
  // other spec: distinct `mod-*` slugs (never demo-booked, never booked
  // or reviewed) and their own slots at a distinct 08:00-UTC hour (disjoint
  // from the 02:00/04:00/06:00-UTC demo + #19/#20 slots and the July-2026
  // availability window in #18). Within-cap ones (price ≤ Rs.5000, single-day
  // capacity-8 slot) approve cleanly; the over-cap one (price Rs.7500) is
  // rejected by the tier-cap guard at admin-approve time.
  interface ModerationExperienceSeed {
    readonly slug: string
    readonly title: string
    readonly price: string
  }

  const MODERATION_EXPERIENCES: ModerationExperienceSeed[] = [
    {
      slug: 'mod-pending-approve-within-cap',
      title: 'Approve me — Within-Cap Pending (Rishikesh)',
      price: '2500.00',
    },
    {
      slug: 'mod-pending-reject',
      title: 'Reject me — Pending (Rishikesh)',
      price: '2200.00',
    },
    {
      slug: 'mod-pending-pause',
      title: 'Pause me — Pending (Rishikesh)',
      price: '2800.00',
    },
    {
      slug: 'mod-pending-archive',
      title: 'Archive me — Pending (Rishikesh)',
      price: '3100.00',
    },
    // Over the identity-tier Rs.5000 per-person cap — the admin-approve
    // tier-cap guard (ADR-0007) must REJECT this, leaving it pending_review.
    {
      slug: 'mod-pending-overcap',
      title: 'Over-Cap Pending — Rejected on Approve (Rishikesh)',
      price: '7500.00',
    },
  ]

  const insertedModeration = await db
    .insert(experiences)
    .values(
      MODERATION_EXPERIENCES.map((m) => ({
        vendorUserId: 'u_seed_v_identity',
        slug: m.slug,
        title: m.title,
        shortDescription: 'Seeded pending_review Experience for the admin moderation E2E (#23).',
        longDescription:
          'A dedicated pending_review fixture for validating admin approve/reject/pause/archive + Meilisearch index/deindex. Not bookable; not reviewed.',
        cancellationPreset: 'flexible' as const,
        paymentModesAllowed: ['full_upfront'] as (
          | 'full_upfront'
          | 'partial_pay'
          | 'reserve_now_pay_later'
        )[],
        pricePerPerson_1_2: m.price,
        pricePerPerson_3_5: m.price,
        pricePerPerson_6_plus: m.price,
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'pending_review' as const,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: experiences.id, slug: experiences.slug })

  const moderationExperiences = insertedModeration.length
    ? insertedModeration
    : await db
        .select({ id: experiences.id, slug: experiences.slug })
        .from(experiences)
        .where(inArray(experiences.slug, MODERATION_EXPERIENCES.map((m) => m.slug)))

  // One single-day, capacity-8 slot per moderation Experience at a fixed
  // 08:00-UTC hour, T+14d (well clear of the T+7d demo slots and the
  // T+10d #19 manageable Booking). Single-day + capacity-8 keeps the
  // within-cap Experiences inside the identity-tier caps so the only thing
  // that rejects the over-cap one is its price.
  const modStartAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  modStartAt.setUTCHours(8, 0, 0, 0)
  const modEndAt = new Date(modStartAt.getTime() + 4 * 60 * 60 * 1000)
  for (const m of moderationExperiences) {
    await db
      .insert(availabilitySlots)
      .values({ experienceId: m.id, startAt: modStartAt, endAt: modEndAt, capacity: 8 })
      .onConflictDoNothing()
  }

  // ===================================================================
  // #30 CROSS-SURFACE APPROVE → SEARCH — dedicated pending_review fixture
  // ===================================================================
  // The cross-surface E2E (#30) proves the full publish → index → search
  // journey from the CUSTOMER search surface: a pending_review Experience is
  // absent from /search, the admin approves it (indexing it into Meilisearch),
  // it then APPEARS on the rendered search page, and pausing it removes it.
  //
  // This needs its OWN fixture, isolated from the #23 `mod-*` set: the
  // cross-surface Playwright project depends on the `admin` project, which
  // approves/pauses/archives every `mod-*` fixture before cross-surface runs,
  // so reusing one would leave nothing pending to approve. The title carries a
  // UNIQUE token ("Outvers Xsurface Approve-Search Beacon") so a `?q=` text
  // search matches only this Experience — never any other seed row. Same
  // identity-tier Vendor, distinct 09:00-UTC slot, within the tier price cap so
  // admin-approve publishes cleanly (no ADR-0007 rejection).
  const XSURFACE_SEARCH_SLUG = 'xsurface-approve-search-rishikesh'
  const [xsurfaceSearchExp] = await db
    .insert(experiences)
    .values({
      vendorUserId: 'u_seed_v_identity',
      slug: XSURFACE_SEARCH_SLUG,
      title: 'Outvers Xsurface Approve-Search Beacon (Rishikesh)',
      shortDescription:
        'Dedicated pending_review fixture for the #30 cross-surface approve → index → search E2E.',
      longDescription:
        'A dedicated pending_review Experience the #30 cross-surface E2E approves so it indexes into Meilisearch and appears on the rendered customer search page, then pauses so it disappears. Isolated from every other spec.',
      cancellationPreset: 'flexible' as const,
      paymentModesAllowed: ['full_upfront'] as (
        | 'full_upfront'
        | 'partial_pay'
        | 'reserve_now_pay_later'
      )[],
      pricePerPerson_1_2: '2700.00',
      pricePerPerson_3_5: '2700.00',
      pricePerPerson_6_plus: '2700.00',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
      status: 'pending_review' as const,
    })
    .onConflictDoNothing()
    .returning({ id: experiences.id })

  const xsurfaceSearchExpId =
    xsurfaceSearchExp?.id ??
    (
      await db
        .select({ id: experiences.id })
        .from(experiences)
        .where(eq(experiences.slug, XSURFACE_SEARCH_SLUG))
    )[0]?.id

  if (xsurfaceSearchExpId) {
    // One single-day, capacity-8 slot at 09:00 UTC, T+14d — disjoint from the
    // #23 moderation slots (08:00 UTC) and every other fixture window so the
    // within-cap approve never trips a tier guard.
    const xsStartAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    xsStartAt.setUTCHours(9, 0, 0, 0)
    const xsEndAt = new Date(xsStartAt.getTime() + 4 * 60 * 60 * 1000)
    await db
      .insert(availabilitySlots)
      .values({ experienceId: xsurfaceSearchExpId, startAt: xsStartAt, endAt: xsEndAt, capacity: 8 })
      .onConflictDoNothing()
  }

  // ===================================================================
  // #24 ADMIN REFUND QUEUE — pending refund_request fixtures
  // ===================================================================
  // The admin refund queue (executeApproveRefund / executeRejectRefund) acts
  // on PENDING refund_requests routed from disputes (#14 outside-policy cancel
  // → Dispute → out-of-policy refund request). The demo seed creates no
  // refund_requests, so without these fixtures the refund-queue E2E (#24) has
  // nothing to approve/reject.
  //
  // Seed TWO dedicated pending refund_requests on TWO dedicated completed
  // Bookings (the `one_active_refund_per_booking` partial unique forbids two
  // active requests on one Booking) owned by REFUND_QUEUE_CUSTOMER:
  //   - APPROVE target → admin approves → credited to THIS customer's Refund
  //                       balance (isolated from #13–#15's u_seed_customer).
  //   - REJECT  target → admin rejects → NOT credited, reason recorded.
  // Both live on a DEDICATED identity-Vendor Experience at distinct fixed-UTC
  // (03:00) past slots, disjoint from every other spec's slot hours.
  const REFUND_QUEUE_SLUG = 'refund-queue-fixture-rishikesh'
  const [refundQueueExp] = await db
    .insert(experiences)
    .values({
      vendorUserId: 'u_seed_v_identity',
      slug: REFUND_QUEUE_SLUG,
      title: 'Refund Queue Fixture — Rishikesh (admin #24)',
      shortDescription: 'Dedicated fixture Experience for the admin refund-queue E2E (#24).',
      longDescription:
        'A dedicated Experience whose completed Bookings carry pending refund_requests for validating admin approve/reject refund actions. Not in any public catalog flow.',
      cancellationPreset: 'flexible' as const,
      paymentModesAllowed: ['full_upfront'] as (
        | 'full_upfront'
        | 'partial_pay'
        | 'reserve_now_pay_later'
      )[],
      pricePerPerson_1_2: '3000.00',
      pricePerPerson_3_5: '3000.00',
      pricePerPerson_6_plus: '3000.00',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
      status: 'published' as const,
    })
    .onConflictDoNothing()
    .returning({ id: experiences.id })

  const refundQueueExpId =
    refundQueueExp?.id ??
    (
      await db
        .select({ id: experiences.id })
        .from(experiences)
        .where(eq(experiences.slug, REFUND_QUEUE_SLUG))
    )[0]?.id

  if (refundQueueExpId) {
    // Two pending refund fixtures: one each for the approve / reject E2E.
    // Fixed PAST calendar dates so slots are deterministic across reseeds and
    // never collide with any future-window fixture. Amount ₹3,000 each.
    const REFUND_FIXTURES = [
      {
        slotAt: new Date('2026-01-07T03:00:00.000Z'),
        amount: '3000.00',
        reason: 'outside_policy_dispute_resolved' as const,
      },
      {
        slotAt: new Date('2026-01-08T03:00:00.000Z'),
        amount: '3000.00',
        reason: 'outside_policy_dispute_resolved' as const,
      },
    ]

    for (const rf of REFUND_FIXTURES) {
      const slotEndAt = new Date(rf.slotAt.getTime() + 4 * 60 * 60 * 1000)
      const [slot] = await db
        .insert(availabilitySlots)
        .values({
          experienceId: refundQueueExpId,
          startAt: rf.slotAt,
          endAt: slotEndAt,
          capacity: 8,
          capacityTaken: 2,
        })
        .onConflictDoNothing()
        .returning({ id: availabilitySlots.id })

      const slotId =
        slot?.id ??
        (
          await db
            .select({ id: availabilitySlots.id })
            .from(availabilitySlots)
            .where(eq(availabilitySlots.startAt, rf.slotAt))
        ).find(() => true)?.id

      if (!slotId) continue

      const [bookingRow] = await db
        .insert(bookings)
        .values({
          customerUserId: REFUND_QUEUE_CUSTOMER.userId,
          experienceId: refundQueueExpId,
          slotId,
          participantCount: 2,
          state: 'completed',
          paymentMode: 'full_upfront',
          grossTotalSnapshot: '6000.00',
          pricePerParticipantSnapshot: '3000.00',
          pricingBasisSnapshot: 'base_price',
          commissionRateSnapshot: '20.00',
          commissionBasisSnapshot: 'platform_default',
          gstRateOnCommissionSnapshot: '18.00',
          tdsAmountSnapshot: '6.00',
          cancellationPresetSnapshot: 'flexible',
          vendorIsResidentSnapshot: true,
          confirmedAt: new Date(rf.slotAt.getTime() - 5 * 24 * 60 * 60 * 1000),
          completedAt: slotEndAt,
        })
        .onConflictDoNothing()
        .returning({ id: bookings.id })

      // If the Booking already existed (reseed against a non-reset DB), the
      // pending refund_request also already exists (the partial unique would
      // block a duplicate), so skip the refund insert.
      if (!bookingRow) continue

      await db
        .insert(refundRequests)
        .values({
          bookingId: bookingRow.id,
          requestedByUserId: REFUND_QUEUE_CUSTOMER.userId,
          reason: rf.reason,
          destination: 'refund_balance',
          state: 'pending',
          amount: rf.amount,
          // Outside-policy dispute resolution → the refund preset is the
          // Experience's flexible preset; basis recorded as outside_policy.
          cancellationPresetSnapshot: 'flexible',
          policyWindowBasisSnapshot: 'outside_policy',
        })
        .onConflictDoNothing()
    }
  }

  // ===================================================================
  // #27 ADMIN REVIEW MODERATION — a dedicated published Review fixture
  // ===================================================================
  // The admin review-moderation E2E (#27) drives flag → remove → publish on a
  // single Review and asserts the public-catalog effect (a `removed` Review
  // leaves the public Experience page; a `published` one is shown). To keep
  // those one-way transitions from disturbing the demo published Reviews that
  // other specs render, seed a DEDICATED published Review on a DEDICATED
  // Experience (owned by the identity Vendor) at a fixed PAST slot disjoint
  // from every other fixture's slot hours. No other spec books or asserts this
  // Experience, so the moderation chain is fully isolated.
  const REVIEW_MOD_SLUG = 'review-moderation-fixture-rishikesh'
  const [reviewModExp] = await db
    .insert(experiences)
    .values({
      vendorUserId: 'u_seed_v_identity',
      slug: REVIEW_MOD_SLUG,
      title: 'Review Moderation Fixture — Rishikesh (admin #27)',
      shortDescription:
        'Dedicated fixture Experience for the admin review-moderation E2E (#27).',
      longDescription:
        'A dedicated published Experience whose single published Review the admin review-moderation E2E flags / removes / publishes. Isolated from every other spec.',
      cancellationPreset: 'flexible' as const,
      paymentModesAllowed: ['full_upfront'] as (
        | 'full_upfront'
        | 'partial_pay'
        | 'reserve_now_pay_later'
      )[],
      pricePerPerson_1_2: '2500.00',
      pricePerPerson_3_5: '2500.00',
      pricePerPerson_6_plus: '2500.00',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
      status: 'published' as const,
    })
    .onConflictDoNothing()
    .returning({ id: experiences.id })

  const reviewModExpId =
    reviewModExp?.id ??
    (
      await db
        .select({ id: experiences.id })
        .from(experiences)
        .where(eq(experiences.slug, REVIEW_MOD_SLUG))
    )[0]?.id

  if (reviewModExpId) {
    const reviewModSlotAt = new Date('2026-01-09T05:00:00.000Z')
    const reviewModSlotEndAt = new Date(
      reviewModSlotAt.getTime() + 4 * 60 * 60 * 1000,
    )

    const [reviewModSlot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: reviewModExpId,
        startAt: reviewModSlotAt,
        endAt: reviewModSlotEndAt,
        capacity: 8,
        capacityTaken: 2,
      })
      .onConflictDoNothing()
      .returning({ id: availabilitySlots.id })

    const reviewModSlotId =
      reviewModSlot?.id ??
      (
        await db
          .select({ id: availabilitySlots.id })
          .from(availabilitySlots)
          .where(eq(availabilitySlots.startAt, reviewModSlotAt))
      ).find(() => true)?.id

    if (reviewModSlotId) {
      const [reviewModBooking] = await db
        .insert(bookings)
        .values({
          customerUserId: 'u_seed_customer',
          experienceId: reviewModExpId,
          slotId: reviewModSlotId,
          participantCount: 2,
          state: 'completed',
          paymentMode: 'full_upfront',
          grossTotalSnapshot: '5000.00',
          pricePerParticipantSnapshot: '2500.00',
          pricingBasisSnapshot: 'base_price',
          commissionRateSnapshot: '20.00',
          commissionBasisSnapshot: 'platform_default',
          gstRateOnCommissionSnapshot: '18.00',
          tdsAmountSnapshot: '5.00',
          cancellationPresetSnapshot: 'flexible',
          vendorIsResidentSnapshot: true,
          confirmedAt: new Date(
            reviewModSlotAt.getTime() - 5 * 24 * 60 * 60 * 1000,
          ),
          completedAt: reviewModSlotEndAt,
        })
        .onConflictDoNothing()
        .returning({ id: bookings.id })

      // Only insert the Review when the Booking was freshly created (the unique
      // booking_id on reviews makes a duplicate a no-op anyway).
      if (reviewModBooking) {
        await db
          .insert(reviews)
          .values({
            bookingId: reviewModBooking.id,
            customerUserId: 'u_seed_customer',
            experienceId: reviewModExpId,
            vendorUserId: 'u_seed_v_identity',
            rating: 5,
            title: 'Moderation fixture review (#27)',
            body: 'A dedicated published Review the admin moderation E2E flags, removes, then re-publishes. Should appear on the public Experience page while published.',
            status: 'published',
          })
          .onConflictDoNothing()
      }
    }
  }

  // ===================================================================
  // #24 ADMIN PAYOUT QUEUE — pending Payout fixtures for the first-3 gate
  // ===================================================================
  // The admin payout queue (executeApprovePayout / Hold / Reject) acts on
  // completed Bookings whose payout_state is pending/held, and the ADR-0016
  // first-3-manual gate decrements PAYOUT_QUEUE_VENDOR.manual_payouts_remaining
  // 3→2→1→0 across the vendor's first three approvals (auto thereafter).
  //
  // Seed a DEDICATED Experience owned by PAYOUT_QUEUE_VENDOR + SIX completed,
  // payout_state='pending' Bookings on it (round ₹50,000 gross each), at
  // distinct fixed-UTC (10:00) past slots disjoint from every other fixture:
  //   - 4 for the approve-sequence E2E (approve x3 proves 3→2→1→0; the 4th
  //     proves the gate is open → no further decrement / auto path)
  //   - 1 for the HOLD E2E (pending → held, Dispute pause)
  //   - 1 for the REJECT E2E (pending → rejected, reason recorded)
  // Each Booking is keyed by a DISTINCT slot start_at so the queue rows are
  // individually addressable from the UI and reseed-idempotent.
  const PAYOUT_QUEUE_SLUG = 'payout-queue-fixture-bir-billing'
  const [payoutQueueExp] = await db
    .insert(experiences)
    .values({
      vendorUserId: PAYOUT_QUEUE_VENDOR.userId,
      slug: PAYOUT_QUEUE_SLUG,
      title: 'Payout Queue Fixture — Bir Billing (admin #24)',
      shortDescription: 'Dedicated fixture Experience for the admin payout-queue E2E (#24).',
      longDescription:
        'A dedicated Experience whose completed, pending-payout Bookings drive admin approve/hold/reject + the ADR-0016 first-3 manual-approval gate. Not in any public catalog flow.',
      cancellationPreset: 'flexible' as const,
      paymentModesAllowed: ['full_upfront'] as (
        | 'full_upfront'
        | 'partial_pay'
        | 'reserve_now_pay_later'
      )[],
      pricePerPerson_1_2: '25000.00',
      pricePerPerson_3_5: '25000.00',
      pricePerPerson_6_plus: '25000.00',
      regionSlug: 'bir-billing',
      activitySlug: 'paragliding',
      status: 'published' as const,
    })
    .onConflictDoNothing()
    .returning({ id: experiences.id })

  const payoutQueueExpId =
    payoutQueueExp?.id ??
    (
      await db
        .select({ id: experiences.id })
        .from(experiences)
        .where(eq(experiences.slug, PAYOUT_QUEUE_SLUG))
    )[0]?.id

  if (payoutQueueExpId) {
    // Six distinct fixed-UTC past slots, one per pending-payout Booking. Gross
    // ₹50,000 @ 20% commission, 18% GST on commission, 0.1% TDS, 0.5% TCS.
    const PAYOUT_QUEUE_GROSS = 50000
    const PAYOUT_QUEUE_PARTICIPANTS = 2
    for (let i = 0; i < 6; i++) {
      const slotAt = new Date('2026-02-01T10:00:00.000Z')
      slotAt.setUTCDate(slotAt.getUTCDate() + i)
      const slotEndAt = new Date(slotAt.getTime() + 4 * 60 * 60 * 1000)

      const [slot] = await db
        .insert(availabilitySlots)
        .values({
          experienceId: payoutQueueExpId,
          startAt: slotAt,
          endAt: slotEndAt,
          capacity: 8,
          capacityTaken: PAYOUT_QUEUE_PARTICIPANTS,
        })
        .onConflictDoNothing()
        .returning({ id: availabilitySlots.id })

      const slotId =
        slot?.id ??
        (
          await db
            .select({ id: availabilitySlots.id })
            .from(availabilitySlots)
            .where(eq(availabilitySlots.startAt, slotAt))
        ).find(() => true)?.id

      if (!slotId) continue

      await db
        .insert(bookings)
        .values({
          customerUserId: REFUND_QUEUE_CUSTOMER.userId,
          experienceId: payoutQueueExpId,
          slotId,
          participantCount: PAYOUT_QUEUE_PARTICIPANTS,
          state: 'completed',
          paymentMode: 'full_upfront',
          grossTotalSnapshot: String(PAYOUT_QUEUE_GROSS),
          pricePerParticipantSnapshot: String(PAYOUT_QUEUE_GROSS / PAYOUT_QUEUE_PARTICIPANTS),
          pricingBasisSnapshot: 'base_price',
          commissionRateSnapshot: '20.00',
          commissionBasisSnapshot: 'platform_default',
          gstRateOnCommissionSnapshot: '18.00',
          tdsAmountSnapshot: String(Math.floor(PAYOUT_QUEUE_GROSS * 0.001)),
          tcsAmountSnapshot: String(Math.floor(PAYOUT_QUEUE_GROSS * 0.005)),
          tcsRateSnapshot: '0.50',
          cancellationPresetSnapshot: 'flexible',
          vendorPanSnapshot: 'PQRST6789U',
          vendorIsResidentSnapshot: true,
          payoutState: 'pending',
          confirmedAt: new Date(slotAt.getTime() - 5 * 24 * 60 * 60 * 1000),
          completedAt: slotEndAt,
        })
        .onConflictDoNothing()
    }
  }

  // ===================================================================
  // #28 ADMIN PERMISSION-GATE PAYOUT — single dedicated pending Booking
  // ===================================================================
  // The #28 server-side permission-gate E2E force-stages ONE completed Booking
  // of PAYOUT_GATE_VENDOR to `pending` and asserts a Sub-admin lacking the
  // `payouts` permission CANNOT approve it (payout_state stays `pending`, no
  // approve audit row). This Vendor is touched by NO other admin spec, so the
  // #24 payout-queue sweep (a parallel describe block that approves/holds/
  // rejects every pending Booking of PAYOUT_QUEUE_VENDOR) can never grab and
  // mutate this Booking out from under the gate assertion (#109 payout race).
  const PAYOUT_GATE_SLUG = 'payout-gate-fixture-bir-billing'
  const [payoutGateExp] = await db
    .insert(experiences)
    .values({
      vendorUserId: PAYOUT_GATE_VENDOR.userId,
      slug: PAYOUT_GATE_SLUG,
      title: 'Payout Gate Fixture — Bir Billing (admin #28)',
      shortDescription: 'Dedicated fixture Experience for the admin permission-gate payout E2E (#28).',
      longDescription:
        'A dedicated Experience whose single completed, pending-payout Booking drives the #28 server-side permission-gate assertion (a Sub-admin lacking `payouts` cannot approve a Payout). Not in any public catalog flow.',
      cancellationPreset: 'flexible' as const,
      paymentModesAllowed: ['full_upfront'] as (
        | 'full_upfront'
        | 'partial_pay'
        | 'reserve_now_pay_later'
      )[],
      pricePerPerson_1_2: '25000.00',
      pricePerPerson_3_5: '25000.00',
      pricePerPerson_6_plus: '25000.00',
      regionSlug: 'bir-billing',
      activitySlug: 'paragliding',
      status: 'published' as const,
    })
    .onConflictDoNothing()
    .returning({ id: experiences.id })

  const payoutGateExpId =
    payoutGateExp?.id ??
    (
      await db
        .select({ id: experiences.id })
        .from(experiences)
        .where(eq(experiences.slug, PAYOUT_GATE_SLUG))
    )[0]?.id

  if (payoutGateExpId) {
    // A single fixed-UTC past slot disjoint from every other fixture's slots.
    const PAYOUT_GATE_GROSS = 50000
    const PAYOUT_GATE_PARTICIPANTS = 2
    const gateSlotAt = new Date('2026-02-20T10:00:00.000Z')
    const gateSlotEndAt = new Date(gateSlotAt.getTime() + 4 * 60 * 60 * 1000)

    const [gateSlot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: payoutGateExpId,
        startAt: gateSlotAt,
        endAt: gateSlotEndAt,
        capacity: 8,
        capacityTaken: PAYOUT_GATE_PARTICIPANTS,
      })
      .onConflictDoNothing()
      .returning({ id: availabilitySlots.id })

    const gateSlotId =
      gateSlot?.id ??
      (
        await db
          .select({ id: availabilitySlots.id })
          .from(availabilitySlots)
          .where(eq(availabilitySlots.startAt, gateSlotAt))
      ).find(() => true)?.id

    if (gateSlotId) {
      await db
        .insert(bookings)
        .values({
          customerUserId: REFUND_QUEUE_CUSTOMER.userId,
          experienceId: payoutGateExpId,
          slotId: gateSlotId,
          participantCount: PAYOUT_GATE_PARTICIPANTS,
          state: 'completed',
          paymentMode: 'full_upfront',
          grossTotalSnapshot: String(PAYOUT_GATE_GROSS),
          pricePerParticipantSnapshot: String(PAYOUT_GATE_GROSS / PAYOUT_GATE_PARTICIPANTS),
          pricingBasisSnapshot: 'base_price',
          commissionRateSnapshot: '20.00',
          commissionBasisSnapshot: 'platform_default',
          gstRateOnCommissionSnapshot: '18.00',
          tdsAmountSnapshot: String(Math.floor(PAYOUT_GATE_GROSS * 0.001)),
          tcsAmountSnapshot: String(Math.floor(PAYOUT_GATE_GROSS * 0.005)),
          tcsRateSnapshot: '0.50',
          cancellationPresetSnapshot: 'flexible',
          vendorPanSnapshot: 'STUVW1234X',
          vendorIsResidentSnapshot: true,
          payoutState: 'pending',
          confirmedAt: new Date(gateSlotAt.getTime() - 5 * 24 * 60 * 60 * 1000),
          completedAt: gateSlotEndAt,
        })
        .onConflictDoNothing()
    }
  }

  // ===================================================================
  // #26 ADMIN COMMISSION-TIER SCOPE COUNT — dedicated Experience + Bookings
  // ===================================================================
  // The admin commission-tier E2E (#26) creates a Festival tier scoped to a
  // dedicated Experience over a fixed September-2026 window and asserts
  // getAffectedBookingCount returns the scope-filtered count (the #34 fix,
  // ADR-0008). Seed a DEDICATED published Experience (never surfaced in any
  // public flow — a fixture slug) owned by the business Vendor on the
  // bir-billing / paragliding scope, plus COMMISSION_SCOPE_IN_WINDOW confirmed
  // Bookings whose created_at is pinned INSIDE the window + one control Booking
  // created BEFORE it. The fixed counts make the scope-count assertion stable.
  const [commissionScopeExp] = await db
    .insert(experiences)
    .values({
      vendorUserId: 'u_seed_v_business',
      slug: COMMISSION_SCOPE_SLUG,
      title: 'Commission Scope Fixture — Bir Billing (admin #26)',
      shortDescription: 'Dedicated fixture Experience for the admin commission-tier scope-count E2E (#26).',
      longDescription:
        'A dedicated Experience whose confirmed Bookings (pinned to a fixed September-2026 window) drive the admin commission-tier getAffectedBookingCount scope-filter assertion. Not in any public catalog flow.',
      cancellationPreset: 'flexible' as const,
      paymentModesAllowed: ['full_upfront'] as (
        | 'full_upfront'
        | 'partial_pay'
        | 'reserve_now_pay_later'
      )[],
      pricePerPerson_1_2: '3000.00',
      pricePerPerson_3_5: '2800.00',
      pricePerPerson_6_plus: '2600.00',
      regionSlug: 'bir-billing',
      activitySlug: 'paragliding',
      status: 'published' as const,
    })
    .onConflictDoNothing()
    .returning({ id: experiences.id })

  const commissionScopeExpId =
    commissionScopeExp?.id ??
    (
      await db
        .select({ id: experiences.id })
        .from(experiences)
        .where(eq(experiences.slug, COMMISSION_SCOPE_SLUG))
    )[0]?.id

  if (commissionScopeExpId) {
    // created_at values: three inside the [Sep 1, Sep 30] window + one control
    // before it. Booking.created_at is what getAffectedBookingCount filters on.
    const commissionScopeCreatedAts = [
      new Date('2026-09-05T08:00:00.000Z'),
      new Date('2026-09-15T08:00:00.000Z'),
      new Date('2026-09-25T08:00:00.000Z'),
      // Control: BEFORE the window — must NOT be counted.
      new Date('2026-08-15T08:00:00.000Z'),
    ]
    // Each Booking sits on its own dedicated past slot (distinct fixed UTC
    // start) so the (experience_id, start_at) pair never collides.
    for (let i = 0; i < commissionScopeCreatedAts.length; i++) {
      const createdAt = commissionScopeCreatedAts[i]
      const slotAt = new Date('2026-09-01T06:00:00.000Z')
      slotAt.setUTCDate(slotAt.getUTCDate() + i)
      const slotEndAt = new Date(slotAt.getTime() + 4 * 60 * 60 * 1000)

      const [slot] = await db
        .insert(availabilitySlots)
        .values({
          experienceId: commissionScopeExpId,
          startAt: slotAt,
          endAt: slotEndAt,
          capacity: 8,
          capacityTaken: 2,
        })
        .onConflictDoNothing()
        .returning({ id: availabilitySlots.id })

      const slotId =
        slot?.id ??
        (
          await db
            .select({ id: availabilitySlots.id })
            .from(availabilitySlots)
            .where(eq(availabilitySlots.startAt, slotAt))
        ).find(() => true)?.id

      if (!slotId) continue

      await db
        .insert(bookings)
        .values({
          customerUserId: 'u_seed_customer',
          experienceId: commissionScopeExpId,
          slotId,
          participantCount: 2,
          state: 'confirmed',
          paymentMode: 'full_upfront',
          grossTotalSnapshot: '6000.00',
          pricePerParticipantSnapshot: '3000.00',
          pricingBasisSnapshot: 'base_price',
          commissionRateSnapshot: '20.00',
          commissionBasisSnapshot: 'platform_default',
          gstRateOnCommissionSnapshot: '18.00',
          tdsAmountSnapshot: '6.00',
          cancellationPresetSnapshot: 'flexible',
          vendorPanSnapshot: 'PQRST6789U',
          vendorIsResidentSnapshot: true,
          createdAt,
          confirmedAt: createdAt,
        })
        .onConflictDoNothing()
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

  // ----- REFUND-BALANCE LEDGER — reconcile the displayed ₹500 (A0 item 3) -----
  // The wallet page critique flagged a ₹500 Refund balance with NO ledger rows
  // explaining it. Seed an immutable ledger that SUMS EXACTLY to the displayed
  // refund_balance bucket (₹500): the Hampta cancellation Refund credit (+₹650)
  // minus a later checkout deduction (−₹150) = ₹500. Signed amounts (ADR-0004:
  // positive = credit, negative = debit) so a SUM over the bucket reconciles.
  //
  // Reseed-idempotent: keyed on fixed referenceIds with a delete-before-insert
  // (wallet_transactions has no natural unique key). The runtime cancel E2Es
  // credit the SAME bucket with their OWN referenceIds, so they never collide
  // with — and only ever grow above — this seeded ₹500 baseline.
  const REFUND_CREDIT_REF = 'seed-refund-credit-hampta-u_seed_customer'
  const REFUND_DEBIT_REF = 'seed-refund-debit-checkout-u_seed_customer'
  await db
    .delete(walletTransactions)
    .where(inArray(walletTransactions.referenceId, [REFUND_CREDIT_REF, REFUND_DEBIT_REF]))
  await db.insert(walletTransactions).values([
    {
      // The Hampta Pass cancellation (the cancelled demo Booking above) →
      // inside-policy Refund auto-credited to the Refund balance (ADR-0005),
      // sized to reconcile the displayed ₹500 bucket after the debit below.
      userId: 'u_seed_customer',
      balanceType: 'refund_balance',
      amount: '650.00',
      source: 'refund',
      referenceId: REFUND_CREDIT_REF,
      createdAt: new Date('2026-05-22T00:00:00.000Z'),
    },
    {
      // A later checkout applied part of the Refund balance toward a Booking
      // (ADR-0004 spend order #2). Signed negative = debit.
      userId: 'u_seed_customer',
      balanceType: 'refund_balance',
      amount: '-150.00',
      source: 'checkout_deduction',
      referenceId: REFUND_DEBIT_REF,
      createdAt: new Date('2026-05-28T00:00:00.000Z'),
    },
  ])

  console.warn(
    `seeded ${VENDORS.length} vendors, ${EXPERIENCES.length} experiences, ${allExperiences.length} slots, ${seededBookings.length} bookings, ${completedBookings.length} reviews`,
  )

  // ----- CATALOG ENRICHMENT (parity-catchup/01) -----
  // Layer a realistic, image-rich, UNIQUE catalog (vendors, experiences,
  // media, reviews, blog, site_content, notifications, support, promos,
  // commission/pricing tiers, region closures, patterns, wallet) so every
  // surface renders populated. Isolation-safe: touches only NEW catalog
  // entities + archives the four published admin-fixtures. See db/seed-extras.ts.
  await seedCatalog(db)
  console.warn('seeded catalog enrichment (image-rich demo data)')

  // ----- TRIP GROUPS (issue #20 / ADR-0009) -----
  // Isolation-safe demo groups for /community (dedicated fixture users).
  await seedTripGroups(db)
  console.warn('seeded trip groups (community demo data)')
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('seed failed:', err)
    process.exit(1)
  })
