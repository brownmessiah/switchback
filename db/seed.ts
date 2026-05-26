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

import { inArray } from 'drizzle-orm'

import { db } from './client'
import {
  adminProfiles,
  availabilitySlots,
  bookings,
  customerProfiles,
  experiences,
  reviews,
  users,
  vendorProfiles,
  walletBalances,
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
      ...VENDORS.map((v) => ({ id: v.userId, email: v.email, name: v.businessName })),
    ])
    .onConflictDoNothing()

  // ----- ADMIN -----
  await db
    .insert(adminProfiles)
    .values({ userId: 'u_seed_admin', permissions: ['*'] })
    .onConflictDoNothing()

  // ----- CUSTOMER -----
  await db
    .insert(customerProfiles)
    .values({ userId: 'u_seed_customer' })
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
  const startAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
  for (const exp of allExperiences) {
    await db
      .insert(availabilitySlots)
      .values({ experienceId: exp.id, startAt, endAt, capacity: 8 })
      .onConflictDoNothing()
  }

  // ----- BOOKINGS — mix of states for demo dashboards -----
  const slotRows = await db
    .select({ id: availabilitySlots.id, experienceId: availabilitySlots.experienceId })
    .from(availabilitySlots)
    .limit(5)

  const BOOKING_SEEDS = [
    { state: 'confirmed' as const, participants: 2 },
    { state: 'confirmed' as const, participants: 4 },
    { state: 'completed' as const, participants: 3 },
    { state: 'completed' as const, participants: 2 },
    { state: 'cancelled_by_customer' as const, participants: 1 },
  ]

  const seededBookings: { id: string; experienceId: string; state: string }[] = []

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

  // ----- WALLET — give the seed customer some refund balance -----
  await db
    .insert(walletBalances)
    .values([
      { userId: 'u_seed_customer', balanceType: 'refund_balance' as const, amount: '500.00' },
      { userId: 'u_seed_customer', balanceType: 'outvers_credit' as const, amount: '200.00' },
    ])
    .onConflictDoNothing()

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
