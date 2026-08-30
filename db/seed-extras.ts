/**
 * Canonical-seed catalog enrichment (parity-catchup/01).
 *
 * Layers a realistic, image-rich, UNIQUE catalog on top of the canonical
 * `db/seed.ts` baseline so every public + dashboard surface renders populated
 * out of the box (the parity-audit "looks immature on a fresh DB" fix).
 *
 * ISOLATION CONTRACT — this module is replayed by the Playwright harness
 * (tests/e2e/global-setup.ts runs `db/seed.ts` once before all specs), so it
 * MUST NOT perturb any fixture an E2E spec asserts on. It therefore:
 *   - inserts only NEW catalog vendors (u_cat_*), customers (u_enr_cust_*) and
 *     experiences, and attaches all volume (media, reviews, bookings, payments,
 *     wallet, patterns, slots) ONLY to that catalog set — never a blanket
 *     `WHERE status='published'` scan (which would hit the seed fixtures);
 *   - scope-locks every commission/pricing tier to catalog experience IDs with
 *     empty category/vendor arrays (an empty applies-to-experiences array means
 *     "all" and would hijack money-path snapshots — ADR-0008,
 *     lib/payments/commission-resolver.ts);
 *   - seeds region_closures ONLY on catalog-only regions (closures are
 *     per-region and would block E2E bookings in rishikesh/manali/bir-billing/goa);
 *   - adds zero `disputed` bookings (admin dashboard #29 asserts the count);
 *   - archives the four published admin-fixture experiences so they leave the
 *     public Featured/search surfaces.
 *
 * IDEMPOTENT: natural-key guards / onConflictDoNothing + deterministic IDs, so
 * re-running against an already-seeded DB is a no-op.
 *
 * Imagery: curated, HTTP-200-verified Unsplash photo IDs. media_assets are
 * seeded for data completeness + the vendor read paths; PUBLIC imagery wiring
 * to media_assets is parity-catchup/02.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'

import { getActivity } from '@/lib/activities/registry'
import { PUBLISHED_FIXTURE_SLUGS } from '@/lib/experiences/fixture-slugs'
import { replaceItinerary } from '@/lib/experiences/itinerary'
import type {
  GuideLanguage,
  ItineraryStepInput,
} from '@/lib/experiences/structured-schema'

import { upsertBlogPosts } from './content/blog/upsert'

import {
  availabilityPatterns,
  availabilitySlots,
  bookings,
  commissionTiers,
  conversations,
  customerProfiles,
  experiences,
  mediaAssets,
  messages,
  notificationOutbox,
  notificationPreferences,
  notifications,
  payments,
  pricingTiers,
  promoCodes,
  promoRedemptions,
  refundRequests,
  regionClosures,
  reviews,
  siteContent,
  supportMessages,
  supportTickets,
  users,
  vendorProfiles,
  walletBalances,
  walletTransactions,
} from './schema'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from './schema'

import { seedDefaultAvailability } from './seed-availability'
import { galleryFor } from './seed-photos'
import { vendorVariety } from './seed-vendor-variety'

/**
 * Accept either the top-level postgres-js handle (production seed) or the
 * PGlite handle (test harness) — both extend drizzle's PgDatabase base type.
 */
export type SeedDb = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

const ADMIN_ID = 'u_seed_admin'

/**
 * Published admin-fixture experiences that must leave public surfaces. Sourced
 * from the single fixture-slug registry so the seed-archive and the human-facing
 * list-query exclusion (customer dashboard + admin bookings) never drift.
 */
const FIXTURE_SLUGS = PUBLISHED_FIXTURE_SLUGS

/** Regions used by E2E booking flows — never seed closures here. */
const E2E_REGIONS = new Set(['rishikesh', 'manali', 'bir-billing', 'goa'])

// ── Unsplash URL builder + non-activity photo pools ─────────────────────────
// Per-activity experience galleries now come from the curated, visually-verified
// pools in `lib/images.ts` (via `galleryFor` in db/seed-photos.ts) — the old
// hand-typed ACTIVITY_PHOTOS map had mis-tagged IDs (e.g. a jigsaw puzzle under
// "paragliding"). IMG is exported so the demo-catalog seed reuses the builder.
export const IMG = (id: string, w = 1200): string =>
  `https://images.unsplash.com/${id}?w=${w}&q=80&auto=format&fit=crop`

const FALLBACK_PHOTOS = ['photo-1506905925346-21bda4d32df4', 'photo-1470071459604-3b5ec3a7fe05', 'photo-1426604966848-d7adac402bff', 'photo-1501785888041-af3ef285b470']
const AVATAR_PHOTOS = ['photo-1500648767791-00dcc994a43e', 'photo-1494790108377-be9c29b29330', 'photo-1507003211169-0a1dd7228f2d', 'photo-1438761681033-6461ffad8d80', 'photo-1472099645785-5658abf4ff4e', 'photo-1544005313-94ddf0286df2', 'photo-1633332755192-727a05c4013d', 'photo-1607746882042-944635dfe10e']
export const VENDOR_LOGO_PHOTOS = ['photo-1557804506-669a67965ba0', 'photo-1487058792275-0ad4aaf24ca7']

/** Deterministic uuid-shaped IDs in a private namespace (idempotent re-runs). */
function ns(prefix: string, n: number): string {
  const hex = (prefix.split('').reduce((a, c) => a + c.charCodeAt(0), 0) + n)
    .toString(16)
    .padStart(4, '0')
    .slice(-4)
  return `e7000401-0000-4000-8${hex.slice(0, 3)}-${n.toString(16).padStart(12, '0')}`
}

const ago = (n: number, unit: 'days' | 'hours' = 'days'): Date =>
  new Date(Date.now() - n * (unit === 'hours' ? 3600 : 86400) * 1000)
const ahead = (n: number): Date => new Date(Date.now() + n * 86400 * 1000)

// ── Catalog vendors (business-tier, verified) ───────────────────────────────
interface CatalogVendor {
  userId: string
  email: string
  businessName: string
  slug: string
  pan: string
  vpa: string
}
const CATALOG_VENDORS: CatalogVendor[] = [
  { userId: 'u_cat_apex', email: 'catalog+apex@seed.switchback.dev', businessName: 'Apex River Co.', slug: 'apex-river-co', pan: 'AAACA1111A', vpa: 'apexriver@upi' },
  { userId: 'u_cat_summit', email: 'catalog+summit@seed.switchback.dev', businessName: 'Summit Seekers Himalaya', slug: 'summit-seekers-himalaya', pan: 'AAACS2222B', vpa: 'summitseekers@upi' },
  { userId: 'u_cat_cloud', email: 'catalog+cloud@seed.switchback.dev', businessName: 'Cloudbase Paragliding', slug: 'cloudbase-paragliding', pan: 'AAACC3333C', vpa: 'cloudbase@upi' },
  { userId: 'u_cat_coral', email: 'catalog+coral@seed.switchback.dev', businessName: 'Coral Coast Divers', slug: 'coral-coast-divers', pan: 'AAACR4444D', vpa: 'coralcoast@upi' },
  { userId: 'u_cat_ladakh', email: 'catalog+ladakh@seed.switchback.dev', businessName: 'Ladakh Explorers', slug: 'ladakh-explorers', pan: 'AAACL5555E', vpa: 'ladakhexp@upi' },
  { userId: 'u_cat_sahyadri', email: 'catalog+sahyadri@seed.switchback.dev', businessName: 'Sahyadri Outdoors', slug: 'sahyadri-outdoors', pan: 'AAACH6666F', vpa: 'sahyadri@upi' },
  { userId: 'u_cat_parvati', email: 'catalog+parvati@seed.switchback.dev', businessName: 'Parvati Valley Treks', slug: 'parvati-valley-treks', pan: 'AAACP7777G', vpa: 'parvatitreks@upi' },
  { userId: 'u_cat_island', email: 'catalog+island@seed.switchback.dev', businessName: 'Island Paddle Co.', slug: 'island-paddle-co', pan: 'AAACI8888H', vpa: 'islandpaddle@upi' },
]

// ── Catalog experiences (region-prefixed slugs, controlled vocab) ───────────
type Preset = 'flexible' | 'moderate' | 'strict'
type Difficulty = 'easy' | 'moderate' | 'challenging' | 'extreme'

/**
 * ADR-0017 structured backfill for the existing catalog (issue 06). Derived
 * from each row's rich prose + the fact-check report — additive, never altering
 * slugs/prices/regions or the isolation contract. Optional so rows omitting it
 * stay bare. `itinerary` is written via replaceItinerary for the multi-day rows.
 */
interface CatalogStructured {
  durationMinutes: number
  difficulty: Difficulty
  minAge: number
  maxGroupSize: number
  languages: GuideLanguage[]
  meetingPoint: string
  seasonMonths: number[]
  highlights: string[]
  inclusions: string[]
  exclusions: string[]
  whatToBring: string[]
  itinerary?: ItineraryStepInput[]
}

interface CatalogExp {
  vendor: string
  slug: string
  title: string
  short: string
  long: string
  region: string
  activity: string
  p12: string
  p35: string
  p6: string
  preset: Preset
  permits?: string[]
  structured?: CatalogStructured
}
const CATALOG_EXPERIENCES: CatalogExp[] = [
  // Apex River Co. — Rishikesh + Lonavala
  { vendor: 'u_cat_apex', slug: 'rishikesh-rafting-marine-drive-25km', title: 'Marine Drive to Shivpuri — 25 km Rafting Expedition', short: 'A longer 25-km Grade III+ Ganga run past Roller-Coaster and Golf Course rapids. Full safety kit, certified guides, riverside lunch.', long: 'Start above Marine Drive for the biggest commercial-rafting stretch on the Ganga — nine named rapids including the legendary Roller-Coaster wave train. Expedition rafts, 1:6 guide ratio, dry-bags and a mid-run beach stop with lunch. Ages 14+, swimmers and non-swimmers welcome.', region: 'rishikesh', activity: 'rafting', p12: '2200.00', p35: '1900.00', p6: '1650.00', preset: 'flexible' },
  { vendor: 'u_cat_apex', slug: 'rishikesh-bungee-jumping-83m-hyul', title: '83-Metre Fixed-Platform Bungee Jump (Rishikesh)', short: 'India’s original 83 m bungee over the Hyul river gorge. Australian-built platform, master jumpers, full harness rig.', long: 'Leap from a cantilevered platform 83 m above a seasonal river gorge — India’s highest fixed bungee. Equipment and jumpmasters are trained to AJ Hackett standards. Includes practice harness brief, the jump, and a recovery-winch ride back up. Weight 40–110 kg.', region: 'rishikesh', activity: 'bungee-jumping', p12: '3700.00', p35: '3700.00', p6: '3500.00', preset: 'strict' },
  { vendor: 'u_cat_apex', slug: 'rishikesh-camping-beas-ghat', title: 'Beas Ghat Riverside Camping + Bonfire', short: 'One night in Swiss tents on a quiet Ganga beach upstream of the crowds. Bonfire, dinner, breakfast, stargazing.', long: 'Drive 45 minutes upriver to a calm sandy bend for a single-night riverside camp. Twin-share Swiss tents with mattresses and sleeping bags, a hot buffet dinner, bonfire, and morning chai with breakfast. Optional short rapids float next morning. Family-friendly.', region: 'rishikesh', activity: 'camping', p12: '2400.00', p35: '2100.00', p6: '1800.00', preset: 'moderate' },
  { vendor: 'u_cat_apex', slug: 'rishikesh-kayaking-whitewater-clinic', title: 'White-Water Kayaking Clinic — 2 Days (Rishikesh)', short: 'A two-day beginner white-water kayaking clinic on graded Ganga sections. Boats, gear, and a 1:3 instructor ratio included.', long: 'Progress from flat-water strokes and the wet-exit to Grade II rapids over two coached days. Includes river-runner kayaks, spray-decks, helmets, PFDs and a 1:3 instructor ratio with safety-kayak cover. Basic swimming required. Best Oct–Jun.', region: 'rishikesh', activity: 'kayaking', p12: '4200.00', p35: '3800.00', p6: '3400.00', preset: 'moderate' },
  { vendor: 'u_cat_sahyadri', slug: 'lonavala-rock-climbing-valley-crossing', title: 'Monsoon Rappel & Valley Crossing (Lonavala)', short: 'A half-day of waterfall rappelling and a Tyrolean valley crossing in the Sahyadris. Beginner-friendly, gear included.', long: 'Rappel a 90-ft monsoon waterfall and clip into a Tyrolean traverse across a green ravine near Lonavala. All technical gear, helmets and certified instructors provided. No experience needed; closed-toe shoes required. Best Jun–Sep.', region: 'lonavala', activity: 'rock-climbing', p12: '1900.00', p35: '1700.00', p6: '1500.00', preset: 'flexible' },
  { vendor: 'u_cat_sahyadri', slug: 'lonavala-trekking-rajmachi-fort', title: 'Rajmachi Fort Monsoon Trek (Lonavala)', short: 'A guided 7-km monsoon trek to the twin Rajmachi forts through Sahyadri grasslands. Easy-moderate, breakfast included.', long: 'Trek from Udhewadi to the Shrivardhan and Manaranjan forts of Rajmachi, threading mist-soaked grasslands and seasonal streams. Easy-to-moderate, 7 km return with a guide, breakfast and fort history. Leeches likely in peak monsoon — we brief on prevention. Best Jul–Sep.', region: 'lonavala', activity: 'trekking', p12: '1400.00', p35: '1250.00', p6: '1100.00', preset: 'flexible' },
  { vendor: 'u_cat_sahyadri', slug: 'lonavala-camping-pawna-lakeside', title: 'Pawna Lakeside Camping — 1 Night', short: 'A lakeside tent night beside Pawna reservoir with kayaking, bonfire, BBQ dinner and sunrise over the forts.', long: 'Pitch up on the grassy banks of Pawna Lake with the Tung and Tikona forts on the skyline. Includes twin-share tents, evening kayak paddle, bonfire, BBQ dinner, breakfast and clean washrooms. A 90-minute drive from Lonavala. Year-round except peak monsoon.', region: 'lonavala', activity: 'camping', p12: '1700.00', p35: '1500.00', p6: '1300.00', preset: 'moderate' },

  // Summit Seekers Himalaya — Manali + Auli
  { vendor: 'u_cat_summit', slug: 'manali-trekking-beas-kund-3d', title: 'Beas Kund Glacier Trek — 3 Days', short: 'A classic 3-day trek to the glacial source of the Beas at 3,650 m. Tents, meals, forest-department permits included.', long: 'Walk from Solang through Dhundi and Bakarthach meadows to the moraine lake of Beas Kund, ringed by Hanuman Tibba and Friendship Peak. Three days, two nights, moderate grade with one steep moraine push. Includes guide, porter-cooked meals, tents, and permits. Best May–Oct.', region: 'manali', activity: 'trekking', p12: '8500.00', p35: '7800.00', p6: '7200.00', preset: 'moderate' },
  { vendor: 'u_cat_summit', slug: 'manali-skiing-solang-beginner', title: 'Solang Slopes Beginner Skiing — Half Day', short: 'A 3-hour guided beginner skiing session on the Solang nursery slopes. Boots, skis, poles and instructor included.', long: 'Learn the snowplough, traverse and stop on the gentle Solang nursery slope with a certified instructor (max 4 learners). Includes all rental gear and a button-lift pass. No experience required; warm layers and gloves recommended. Season Dec–Mar (snow-dependent).', region: 'manali', activity: 'skiing', p12: '3200.00', p35: '2900.00', p6: '2600.00', preset: 'flexible' },
  { vendor: 'u_cat_summit', slug: 'manali-camping-hampta-meadow', title: 'Hampta Meadow Camping — 2 Nights', short: 'Two nights camping in the Hampta meadows below the pass, with day walks, river crossings and a campfire.', long: 'Base in the green Hampta meadows above Sethan for two relaxed nights of alpine camping. Day walks to viewpoints, a glacial stream crossing, hot meals and a campfire under the stars. Includes guide, tents and full board. Easy-moderate. Best Jun–Sep.', region: 'manali', activity: 'camping', p12: '5500.00', p35: '4900.00', p6: '4400.00', preset: 'moderate' },
  { vendor: 'u_cat_summit', slug: 'auli-skiing-cedar-slope-full-day', title: 'Auli Cedar-Slope Skiing — Full Day', short: 'A full day on Auli’s 3 km groomed runs at 2,800 m, with the GMVN chairlift and an instructor for the morning.', long: 'Ski Auli’s famous cedar-lined slopes with Nanda Devi on the horizon. Full-day gear rental, chairlift and cable-car access, and a 2-hour morning lesson for beginners. Intermediate skiers can free-ride the upper runs. Season Jan–Mar.', region: 'auli', activity: 'skiing', p12: '4200.00', p35: '3800.00', p6: '3400.00', preset: 'moderate' },
  { vendor: 'u_cat_summit', slug: 'auli-trekking-gorson-bugyal', title: 'Gorson Bugyal Day Trek (Auli)', short: 'A scenic 6-km day trek across the Gorson Bugyal meadows above Auli, with Nanda Devi views. Easy, lunch included.', long: 'Ride the Auli cable car then walk to the rolling Gorson Bugyal alpine meadows at 3,050 m, with a panorama of Nanda Devi, Kamet and Dunagiri. Easy 6-km out-and-back with a guide and a packed lunch. Snow underfoot in winter. Best Apr–Nov (and snow-trek in winter).', region: 'auli', activity: 'trekking', p12: '2600.00', p35: '2300.00', p6: '2000.00', preset: 'flexible' },

  // Cloudbase Paragliding — Bir-Billing
  { vendor: 'u_cat_cloud', slug: 'bir-billing-paragliding-acro-cross-country', title: 'Bir-Billing Acro Paragliding — Cross-Country Flight', short: 'A 30–45 min cross-country tandem from the 2,400 m Billing launch with optional acro wingovers. APPI pilots, HD reel.', long: 'The longest tandem on offer at India’s paragliding capital: launch from Billing, ridge-soar the Dhauladhar thermals, and glide cross-country toward the Bir landing field. Optional gentle acro on request. APPI-rated pilots, full gear, and a high-res GoPro reel. Mar–May, Sep–Nov.', region: 'bir-billing', activity: 'paragliding', p12: '3800.00', p35: '3500.00', p6: '3200.00', preset: 'flexible' },
  { vendor: 'u_cat_cloud', slug: 'bir-billing-trekking-rajgundha-2d', title: 'Rajgundha Valley Trek from Billing — 2 Days', short: 'A gentle 2-day trek from Billing over Thalu ridge to the roadless Rajgundha hamlet. Homestay night, meals, guide.', long: 'Walk from the Billing launch over the Thalu Jot ridge into the green, roadless Rajgundha valley, sleeping in a Gaddi shepherd homestay. Two easy-to-moderate days through cedar and rhododendron. Includes guide, homestay, and home-cooked meals. Apr–Nov.', region: 'bir-billing', activity: 'trekking', p12: '5200.00', p35: '4700.00', p6: '4300.00', preset: 'moderate' },
  { vendor: 'u_cat_cloud', slug: 'bir-billing-camping-cloudbase-meadow', title: 'Billing Launch Meadow Camping — 1 Night', short: 'Camp at the 2,400 m Billing launch meadow for sunset gliders, a bonfire, and a dawn flight option.', long: 'Spend a night at the Billing take-off meadow watching the day’s last gliders land in golden light. Twin-share tents, bonfire, hot dinner and breakfast, with the option to add a dawn tandem flight. Warm layers essential at altitude. Mar–Jun, Sep–Nov.', region: 'bir-billing', activity: 'camping', p12: '2200.00', p35: '1900.00', p6: '1700.00', preset: 'moderate' },

  // Coral Coast Divers — Goa + Andaman
  { vendor: 'u_cat_coral', slug: 'goa-scuba-diving-grande-twin-tank', title: 'Grande Island Twin-Tank Boat Dive (Goa)', short: 'Two guided boat dives at Grande Island for certified divers — Suzy’s Wreck and Davy Jones’ Locker. Gear + logbook.', long: 'A morning boat from Vasco to two of Goa’s best sites: the Suzy’s Wreck steamer and the reef at Davy Jones’ Locker. Two ~30-min dives, 12–18 m, for PADI/SSI Open Water+ divers. Full gear, guide, surface snacks and a logbook stamp. Oct–May.', region: 'goa', activity: 'scuba-diving', p12: '5800.00', p35: '5400.00', p6: '5000.00', preset: 'moderate' },
  { vendor: 'u_cat_coral', slug: 'goa-kayaking-mandovi-mangrove', title: 'Mandovi Backwater Kayak & Mangrove Tour', short: 'A calm 2-hour guided kayak through the Mandovi mangroves at dawn. Birdlife, stable sit-on-tops, no experience needed.', long: 'Paddle the quiet mangrove channels off the Mandovi at first light with a naturalist guide — kingfishers, herons and the odd mudskipper. Stable sit-on-top kayaks, life-jackets and a short paddling brief. Suitable for ages 8+. Year-round except peak monsoon.', region: 'goa', activity: 'kayaking', p12: '1600.00', p35: '1400.00', p6: '1200.00', preset: 'flexible' },
  { vendor: 'u_cat_coral', slug: 'goa-camping-cola-beach-hideaway', title: 'Cola Beach Tented Hideaway — 1 Night', short: 'A night in a beachfront tent at secluded Cola Beach, with a freshwater lagoon, seafood dinner and sunrise swim.', long: 'Escape to the quiet south-Goa cove of Cola Beach for a single night in a sea-facing tent beside its emerald lagoon. Includes a fresh seafood dinner, breakfast, kayak on the lagoon and a sunrise swim. A bumpy jeep track keeps the crowds away. Best Nov–Mar.', region: 'goa', activity: 'camping', p12: '3200.00', p35: '2900.00', p6: '2600.00', preset: 'moderate' },
  { vendor: 'u_cat_island', slug: 'andaman-scuba-diving-havelock-discovery', title: 'Havelock Reef Discovery Dive (Andaman)', short: 'A first-timer’s guided reef dive off Havelock’s Nemo Reef. PADI instructor 1:2, all gear, underwater photos included.', long: 'Discover scuba on the clear house reefs off Havelock (Swaraj Dweep) — Nemo Reef and Lighthouse. A pool-skills brief then a 30-min guided reef dive to ~10 m with a 1:2 instructor ratio. Turtles, batfish and soft coral common. Includes gear and an underwater photo set. Oct–May.', region: 'andaman', activity: 'scuba-diving', p12: '4900.00', p35: '4500.00', p6: '4200.00', preset: 'moderate' },
  { vendor: 'u_cat_island', slug: 'andaman-kayaking-mangrove-bioluminescence', title: 'Bioluminescence Night Kayak (Andaman)', short: 'A guided night kayak through Havelock mangroves to watch the water glow with bioluminescent plankton. New-moon only.', long: 'On the darkest nights, paddle silently into the Havelock mangrove creeks and watch every stroke light up the water with blue-green bioluminescence. Stable tandem kayaks, life-jackets, glow-safe guiding and a naturalist briefing. Runs around the new moon, Nov–Apr.', region: 'andaman', activity: 'kayaking', p12: '2600.00', p35: '2300.00', p6: '2000.00', preset: 'moderate' },
  { vendor: 'u_cat_island', slug: 'andaman-camping-radhanagar-eco', title: 'Radhanagar Eco-Camp — 1 Night (Andaman)', short: 'A low-impact beach eco-camp a short walk from Radhanagar Beach, with snorkelling, a campfire and island meals.', long: 'Sleep in a sea-breeze eco-tent minutes from Asia’s acclaimed Radhanagar Beach. Includes guided snorkelling off the rocks, island-style meals, a beach campfire and a sunset walk. Solar lighting and dry-composting keep the footprint light. Best Nov–Apr.', region: 'andaman', activity: 'camping', p12: '4400.00', p35: '4000.00', p6: '3600.00', preset: 'moderate' },

  // Ladakh Explorers — Leh-Ladakh + Spiti
  { vendor: 'u_cat_ladakh', slug: 'leh-ladakh-trekking-markha-valley-6d', title: 'Markha Valley Trek — 6 Days, Homestay Route', short: 'A 6-day Ladakh classic crossing Kongmaru La (5,260 m) with village homestays and two river fords. Permits included.', long: 'The Markha Valley trek threads Hemis National Park past Buddhist gompas and Gaddi homestays, crossing Kongmaru La at 5,260 m on the final day. Six days, full acclimatisation built in, homestay + camp mix. Includes guide, meals, a Hemis National Park / Wildlife Department entry permit and stock animals for kit. Jun–Sep.', region: 'leh-ladakh', activity: 'trekking', p12: '21500.00', p35: '19500.00', p6: '17500.00', preset: 'strict', permits: ['Hemis National Park / Wildlife Department entry permit'] },
  { vendor: 'u_cat_ladakh', slug: 'leh-ladakh-rafting-zanskar-grade-iv', title: 'Zanskar Grade IV Rafting — Chilling to Nimu', short: 'A big-water 28 km Grade III–IV run through the Zanskar gorge to the Indus confluence. Dry-suits, expedition guides.', long: 'Raft the dramatic Zanskar gorge ~28 km from Chilling to the Indus confluence at Nimu — towering walls, Grade III–IV rapids and glacial water. Dry-suits, expedition rafts and IRF-certified guides provided. Strong swimmers, ages 16+. Jul–Aug only.', region: 'leh-ladakh', activity: 'rafting', p12: '4500.00', p35: '4100.00', p6: '3700.00', preset: 'strict', permits: ['Inner Line Permit'] },
  { vendor: 'u_cat_ladakh', slug: 'leh-ladakh-safari-nubra-overland-2d', title: 'Nubra Valley Overland Safari — 2 Days', short: 'A 2-day 4×4 safari over Khardung La to the Nubra dunes, with a camel ride and a desert camp night.', long: 'Cross Khardung La (5,359 m) by 4×4 into the Nubra valley — Diskit monastery, the Hunder sand dunes, a double-humped Bactrian camel ride, and a night in a luxury desert camp. Includes vehicle, driver, permits, camp and meals. May–Sep.', region: 'leh-ladakh', activity: 'safari', p12: '16500.00', p35: '14500.00', p6: '12500.00', preset: 'moderate', permits: ['Inner Line Permit'] },
  { vendor: 'u_cat_ladakh', slug: 'leh-ladakh-camping-pangong-lakeside', title: 'Pangong Tso Lakeside Camp — 1 Night', short: 'A night in a premium lakeside tent beside the colour-shifting Pangong Tso at 4,350 m. Dinner, breakfast, stargazing.', long: 'Wake beside the surreal blues of Pangong Tso, the high-altitude lake straddling the India–Tibet line. Premium twin-share tents with proper bedding, hot dinner and breakfast, oxygen on standby, and some of the clearest night skies in India. Permits included. May–Sep.', region: 'leh-ladakh', activity: 'camping', p12: '6500.00', p35: '5900.00', p6: '5400.00', preset: 'moderate', permits: ['Inner Line Permit'] },
  { vendor: 'u_cat_ladakh', slug: 'spiti-safari-snow-leopard-trail', title: 'Spiti Winter Wildlife Safari — Snow-Leopard Trail', short: 'A guided winter wildlife safari in Kibber, tracking snow leopard, ibex and blue sheep with local spotters and scopes.', long: 'Join Kibber’s legendary local spotters on a winter wildlife safari in the Spiti valley — snow leopard, Himalayan ibex, blue sheep and red fox. Spotting scopes, homestay base, and warm gear guidance. Patience and altitude tolerance required (4,000 m+). Jan–Mar.', region: 'spiti', activity: 'safari', p12: '18500.00', p35: '16500.00', p6: '14500.00', preset: 'strict' },
  { vendor: 'u_cat_ladakh', slug: 'spiti-trekking-pin-parvati-base', title: 'Pin Valley Base Trek — 3 Days (Spiti)', short: 'A 3-day high-desert trek into the Pin Valley National Park, with Buddhist hamlets, fossils and ibex country.', long: 'Trek the stark, beautiful Pin Valley from Mud village, past Kungri gompa and grazing-grounds where ibex and the occasional snow leopard roam. Three days of high-desert walking with a guide, camps, meals and a fossil-hunting stop. Moderate, altitude 3,600 m+. Best Jun–Sep.', region: 'spiti', activity: 'trekking', p12: '9500.00', p35: '8700.00', p6: '8000.00', preset: 'moderate' },
  { vendor: 'u_cat_ladakh', slug: 'spiti-camping-chandratal-lakeside', title: 'Chandratal Lakeside Camp — 1 Night (Spiti)', short: 'A night beside the moon-shaped Chandratal lake at 4,300 m, with a guided lake circuit and Milky-Way skies.', long: 'Camp a short walk from the crescent-shaped Chandratal (“Moon Lake”) on the Spiti–Lahaul boundary. Includes a guided 1-hour lake circuit, twin-share tents, hot meals, and a chance at some of the darkest Milky-Way skies anywhere. Road open Jun–Sep only.', region: 'spiti', activity: 'camping', p12: '5800.00', p35: '5300.00', p6: '4800.00', preset: 'moderate' },

  // Parvati Valley Treks — Kasol
  { vendor: 'u_cat_parvati', slug: 'kasol-trekking-sar-pass-4d', title: 'Sar Pass Trek — 4 Days from Kasol', short: 'A 4-day Parvati-valley trek crossing the 4,220 m Sar Pass with a snow-slide descent. Camps, meals, guide included.', long: 'From Kasol through Grahan village and Min Thach meadows to the snowbound Sar Pass, finishing with the famous glissade descent to Biskeri Thach. Four days of pine forest, meadow and snow. Includes guide, camps, and all meals. Moderate-plus; best May–Jun.', region: 'kasol', activity: 'trekking', p12: '7500.00', p35: '6900.00', p6: '6300.00', preset: 'moderate' },
  { vendor: 'u_cat_parvati', slug: 'kasol-trekking-kheerganga-2d', title: 'Kheerganga Trek & Hot Springs — 2 Days', short: 'A 2-day trek up the Parvati valley to the Kheerganga hot springs at 3,050 m. Forest, waterfalls, riverside camp.', long: 'Walk from Barshaini through Kalga’s apple orchards and pine forest to the natural hot springs of Kheerganga, soaking under open sky. One night in a riverside camp, with a guide, meals and the spring-side dip. Easy-moderate; best Apr–Jun, Sep–Nov.', region: 'kasol', activity: 'trekking', p12: '3200.00', p35: '2900.00', p6: '2600.00', preset: 'flexible' },
  { vendor: 'u_cat_parvati', slug: 'kasol-camping-parvati-riverside', title: 'Parvati Riverside Camping — 1 Night (Kasol)', short: 'A riverside tent night on the Parvati near Kasol, with a bonfire, café-hopping and mountain breakfast.', long: 'Pitch beside the rushing Parvati a short walk from Kasol’s cafés. Twin-share tents, a riverside bonfire, dinner and breakfast, with easy access to the Israeli-café trail and the Chalal walk. A relaxed introduction to the valley. Best Mar–Jun, Sep–Nov.', region: 'kasol', activity: 'camping', p12: '1800.00', p35: '1600.00', p6: '1400.00', preset: 'moderate' },
  { vendor: 'u_cat_parvati', slug: 'kasol-rock-climbing-chalal-crag', title: 'Chalal Crag Climbing Session (Kasol)', short: 'A half-day bouldering and top-rope session on the granite crags above Chalal. Beginner-friendly, all gear included.', long: 'Cross the Parvati footbridge to the granite crags above Chalal village for a coached half-day of top-rope climbing and bouldering. Routes from Grade 4 to 6a, all gear (harness, shoes, helmet, ropes), and certified instructors. No experience needed. Best Mar–Jun, Sep–Nov.', region: 'kasol', activity: 'rock-climbing', p12: '2200.00', p35: '1950.00', p6: '1750.00', preset: 'flexible' },
]

// ── ADR-0017 structured backfill (issue 06) ─────────────────────────────────
// Per-slug structured attributes derived from each row's prose + the fact-check
// report (docs/plans/structured-experiences-fact-check-report.md). Additive
// only — slugs/prices/regions are untouched. Multi-day rows carry an itinerary
// (written via replaceItinerary). The two audit corrections (Markha permit,
// Zanskar distance) are applied in CATALOG_EXPERIENCES above.
const EN_HI: GuideLanguage[] = ['en', 'hi']
const STRUCTURED_BY_SLUG: Record<string, CatalogStructured> = {
  'rishikesh-rafting-marine-drive-25km': {
    durationMinutes: 300, difficulty: 'moderate', minAge: 14, maxGroupSize: 8, languages: EN_HI,
    meetingPoint: 'Marine Drive rafting put-in, NH-58, ~35 km from Rishikesh',
    seasonMonths: [9, 10, 11, 12, 1, 2, 3, 4, 5, 6],
    highlights: ['Nine named rapids including Roller-Coaster', 'Longest commercial Ganga stretch (25 km)', '1:6 guide ratio with safety kayak', 'Mid-run beach stop with lunch'],
    inclusions: ['Helmet, PFD and paddle', 'Expedition raft with certified guide', 'Riverside lunch', 'Dry-bag for the group'],
    exclusions: ['GoPro footage', 'Hotel pickup', 'Change of clothes'],
    whatToBring: ['Quick-dry clothes', 'Secured river footwear', 'A change of dry clothes', 'Sunscreen'],
    itinerary: [
      { title: 'Safety briefing & gear-up', description: 'Meet your guide above Marine Drive, fit your PFD and helmet, and run through paddle commands.', dayOffset: 0, durationMinutes: 30 },
      { title: 'The 25 km run', description: 'Tackle nine rapids including the Roller-Coaster wave train, with a beach lunch stop.', dayOffset: 0, durationMinutes: 210 },
      { title: 'De-rig & return', description: 'Beach at Shivpuri, return gear and transfer back.', dayOffset: 0, durationMinutes: 60 },
    ],
  },
  'rishikesh-bungee-jumping-83m-hyul': {
    durationMinutes: 90, difficulty: 'extreme', minAge: 12, maxGroupSize: 6, languages: EN_HI,
    meetingPoint: 'Jumpin Heights, Mohan Chatti, ~25 km from Rishikesh',
    seasonMonths: [9, 10, 11, 12, 1, 2, 3, 4, 5, 6],
    highlights: ['India’s highest fixed-platform bungee at 83 m', 'Australian-built cantilevered platform', 'AJ Hackett-standard jumpmasters', 'Recovery-winch ride back up'],
    inclusions: ['Full harness rig and brief', 'The 83 m jump', 'Recovery winch', 'Certificate of completion'],
    exclusions: ['Photo/video package', 'Transport to the site', 'Meals'],
    whatToBring: ['Closed sports shoes', 'Comfortable activewear', 'Weight 40–110 kg compliance'],
  },
  'rishikesh-camping-beas-ghat': {
    durationMinutes: 1080, difficulty: 'easy', minAge: 6, maxGroupSize: 20, languages: EN_HI,
    meetingPoint: 'Beas Ghat riverside camp, ~45 min upriver from Rishikesh',
    seasonMonths: [9, 10, 11, 2, 3, 4, 5, 6],
    highlights: ['Quiet Ganga beach away from crowds', 'Bonfire and stargazing', 'Twin-share Swiss tents', 'Optional morning rapids float'],
    inclusions: ['Twin-share Swiss tent with bedding', 'Hot buffet dinner and breakfast', 'Bonfire', 'Morning chai'],
    exclusions: ['Rafting add-on', 'Transport from Rishikesh', 'Lunch'],
    whatToBring: ['Warm layers for the evening', 'Torch or headlamp', 'Personal toiletries'],
  },
  'rishikesh-kayaking-whitewater-clinic': {
    durationMinutes: 960, difficulty: 'moderate', minAge: 14, maxGroupSize: 6, languages: EN_HI,
    meetingPoint: 'Ganga kayaking base, Shivpuri stretch, Rishikesh',
    seasonMonths: [10, 11, 12, 1, 2, 3, 4, 5, 6],
    highlights: ['Two coached days from flat-water to Grade II', 'Wet-exit and self-rescue drills', '1:3 instructor ratio with safety cover', 'River-runner kayaks and spray-decks'],
    inclusions: ['River-runner kayak, spray-deck, helmet and PFD', '1:3 instructor ratio', 'Safety-kayak cover', 'Two coached sessions'],
    exclusions: ['Accommodation between days', 'Meals', 'Transport'],
    whatToBring: ['Basic swimming ability', 'Quick-dry clothes', 'River footwear', 'A change of dry clothes'],
    itinerary: [
      { title: 'Day 1 — flat-water skills', description: 'Strokes, the wet-exit and self-rescue on a sheltered channel.', dayOffset: 0, durationMinutes: 240 },
      { title: 'Day 2 — Grade II rapids', description: 'Progress onto graded sections with safety-kayak cover.', dayOffset: 1, durationMinutes: 240 },
    ],
  },
  'lonavala-rock-climbing-valley-crossing': {
    durationMinutes: 240, difficulty: 'moderate', minAge: 12, maxGroupSize: 12, languages: ['en', 'hi', 'mr'],
    meetingPoint: 'Lonavala rappelling base, Western Ghats (Sahyadris)',
    seasonMonths: [6, 7, 8, 9],
    highlights: ['90-ft monsoon waterfall rappel', 'Tyrolean valley crossing', 'Lush green-season Sahyadri ravine', 'Beginner-friendly with full gear'],
    inclusions: ['Helmets, harness and technical gear', 'Certified instructors', 'Waterfall rappel and valley crossing'],
    exclusions: ['Meals', 'Transport', 'Photos'],
    whatToBring: ['Closed-toe shoes', 'Clothes you can get wet', 'A change of dry clothes', 'A towel'],
  },
  'lonavala-trekking-rajmachi-fort': {
    durationMinutes: 360, difficulty: 'easy', minAge: 10, maxGroupSize: 20, languages: ['en', 'hi', 'mr'],
    meetingPoint: 'Udhewadi village trailhead, Rajmachi, near Lonavala',
    seasonMonths: [7, 8, 9],
    highlights: ['Twin Shrivardhan and Manaranjan forts', 'Mist-soaked Sahyadri grasslands', '7 km easy-moderate return trek', 'Breakfast and fort history included'],
    inclusions: ['Local trekking guide', 'Breakfast', 'Fort history orientation', 'Leech-prevention brief'],
    exclusions: ['Transport to Udhewadi', 'Lunch', 'Personal gear'],
    whatToBring: ['Trekking or trail shoes with grip', 'Rain jacket in monsoon', 'Water bottle', 'Anti-leech socks'],
  },
  'lonavala-camping-pawna-lakeside': {
    durationMinutes: 1080, difficulty: 'easy', minAge: 6, maxGroupSize: 30, languages: ['en', 'hi', 'mr'],
    meetingPoint: 'Pawna Lake camp, ~90 min drive from Lonavala',
    seasonMonths: [10, 11, 12, 1, 2, 3, 4, 5],
    highlights: ['Lakeside tents with Tung and Tikona fort views', 'Evening kayak paddle', 'Bonfire and BBQ dinner', 'Sunrise over the forts'],
    inclusions: ['Twin-share tent', 'Kayak paddle', 'Bonfire and BBQ dinner', 'Breakfast', 'Clean washrooms'],
    exclusions: ['Transport from Lonavala', 'Lunch', 'Alcohol'],
    whatToBring: ['Light layers', 'Torch', 'Personal toiletries'],
  },
  'manali-trekking-beas-kund-3d': {
    durationMinutes: 4320, difficulty: 'moderate', minAge: 12, maxGroupSize: 14, languages: EN_HI,
    meetingPoint: 'Solang Nala / Palchan roadhead, ~14 km from Manali',
    seasonMonths: [5, 6, 7, 8, 9, 10],
    highlights: ['Glacial source of the Beas at ~3,650 m', 'Dhundi and Bakarthach meadows', 'Hanuman Tibba and Friendship Peak views', 'Forest-department permits included'],
    inclusions: ['Certified guide and porter-cooked meals', 'Tents and sleeping bags', 'Forest-department permits', 'Full board'],
    exclusions: ['Personal trekking gear', 'Travel insurance', 'Tips'],
    whatToBring: ['Broken-in trekking boots', 'Warm layers and a rain shell', 'Refillable water bottle', 'Headlamp'],
    itinerary: [
      { title: 'Solang to Dhundi', description: 'Walk from the roadhead through pine to the Dhundi meadow camp.', dayOffset: 0, durationMinutes: 300 },
      { title: 'Bakarthach to Beas Kund', description: 'Climb the moraine to the glacial lake of Beas Kund and back.', dayOffset: 1, durationMinutes: 420 },
      { title: 'Descend to Solang', description: 'Trek back down to the roadhead and transfer to Manali.', dayOffset: 2, durationMinutes: 240 },
    ],
  },
  'manali-skiing-solang-beginner': {
    durationMinutes: 180, difficulty: 'easy', minAge: 8, maxGroupSize: 4, languages: EN_HI,
    meetingPoint: 'Solang nursery slopes, ~14 km from Manali',
    seasonMonths: [12, 1, 2, 3],
    highlights: ['Snowplough, traverse and stop on gentle slopes', 'Certified instructor (max 4 learners)', 'All rental gear included', 'Button-lift pass'],
    inclusions: ['Boots, skis and poles', 'Certified instructor', 'Button-lift pass'],
    exclusions: ['Warm clothing', 'Transport', 'Meals'],
    whatToBring: ['Warm waterproof layers', 'Gloves', 'Sunglasses or goggles'],
  },
  'manali-camping-hampta-meadow': {
    durationMinutes: 4320, difficulty: 'easy', minAge: 8, maxGroupSize: 16, languages: EN_HI,
    meetingPoint: 'Sethan village base, above Manali',
    seasonMonths: [6, 7, 8, 9],
    highlights: ['Green Hampta meadows below the pass', 'Day walks and a glacial stream crossing', 'Campfire under the stars', 'Two relaxed nights of alpine camping'],
    inclusions: ['Guide and full board', 'Tents and sleeping bags', 'Campfire', 'Day-walk guiding'],
    exclusions: ['Personal gear', 'Transport to Sethan', 'Tips'],
    whatToBring: ['Warm layers', 'Trekking shoes', 'Rain shell', 'Headlamp'],
    itinerary: [
      { title: 'Base to Hampta meadows', description: 'Trek up to the green meadow camp above Sethan.', dayOffset: 0, durationMinutes: 240 },
      { title: 'Meadow day walks', description: 'Viewpoints and a glacial stream crossing, with a campfire evening.', dayOffset: 1, durationMinutes: 300 },
    ],
  },
  'auli-skiing-cedar-slope-full-day': {
    durationMinutes: 480, difficulty: 'moderate', minAge: 8, maxGroupSize: 8, languages: EN_HI,
    meetingPoint: 'Auli GMVN slopes, ~16 km from Joshimath',
    seasonMonths: [1, 2, 3],
    highlights: ['3 km groomed runs at ~2,800 m', 'GMVN chairlift and cable-car access', 'Nanda Devi on the horizon', '2-hour morning lesson for beginners'],
    inclusions: ['Full-day gear rental', 'Chairlift and cable-car access', '2-hour morning lesson'],
    exclusions: ['Warm clothing', 'Transport to Auli', 'Meals'],
    whatToBring: ['Warm waterproof layers', 'Gloves and goggles', 'Sunscreen'],
  },
  'auli-trekking-gorson-bugyal': {
    durationMinutes: 300, difficulty: 'easy', minAge: 8, maxGroupSize: 16, languages: EN_HI,
    meetingPoint: 'Auli cable-car top station, near Joshimath',
    seasonMonths: [4, 5, 6, 7, 8, 9, 10, 11],
    highlights: ['Rolling Gorson Bugyal meadows at ~3,050 m', 'Panorama of Nanda Devi, Kamet and Dunagiri', 'Easy 6 km out-and-back', 'Packed lunch included'],
    inclusions: ['Cable-car ride', 'Local guide', 'Packed lunch'],
    exclusions: ['Transport to Auli', 'Personal gear', 'Tips'],
    whatToBring: ['Trekking shoes', 'Warm layers', 'Water bottle', 'Sun protection'],
  },
  'bir-billing-paragliding-acro-cross-country': {
    durationMinutes: 90, difficulty: 'moderate', minAge: 14, maxGroupSize: 1, languages: EN_HI,
    meetingPoint: 'Billing take-off, ~14 km above Bir, Himachal Pradesh',
    seasonMonths: [3, 4, 5, 9, 10, 11],
    highlights: ['30–45 min cross-country tandem from 2,400 m', 'Ridge-soar the Dhauladhar thermals', 'Optional gentle acro wingovers', 'APPI-rated pilots and HD reel'],
    inclusions: ['APPI-rated tandem pilot and gear', 'Cross-country flight', 'High-res GoPro reel', 'Landing-field transfer'],
    exclusions: ['Transport to Billing', 'Meals', 'Insurance'],
    whatToBring: ['Warm layers at altitude', 'Closed shoes', 'Sunglasses'],
  },
  'bir-billing-trekking-rajgundha-2d': {
    durationMinutes: 2880, difficulty: 'easy', minAge: 10, maxGroupSize: 16, languages: EN_HI,
    meetingPoint: 'Billing launch meadow, above Bir',
    seasonMonths: [4, 5, 6, 7, 8, 9, 10, 11],
    highlights: ['Over Thalu Jot ridge to roadless Rajgundha', 'Gaddi shepherd homestay night', 'Cedar and rhododendron forest', 'Easy-to-moderate two days'],
    inclusions: ['Guide', 'Homestay', 'Home-cooked meals'],
    exclusions: ['Transport to Billing', 'Personal gear', 'Tips'],
    whatToBring: ['Trekking shoes', 'Warm layers', 'Rain shell', 'Headlamp'],
    itinerary: [
      { title: 'Billing over Thalu Jot', description: 'Walk from the launch over the ridge into the Rajgundha valley.', dayOffset: 0, durationMinutes: 300 },
      { title: 'Rajgundha to Billing', description: 'Return through cedar forest after a homestay night.', dayOffset: 1, durationMinutes: 300 },
    ],
  },
  'bir-billing-camping-cloudbase-meadow': {
    durationMinutes: 1080, difficulty: 'easy', minAge: 6, maxGroupSize: 20, languages: EN_HI,
    meetingPoint: 'Billing take-off meadow, above Bir',
    seasonMonths: [3, 4, 5, 6, 9, 10, 11],
    highlights: ['Camp at the 2,400 m Billing launch', 'Sunset gliders landing in golden light', 'Bonfire and hot dinner', 'Optional dawn tandem flight'],
    inclusions: ['Twin-share tent', 'Bonfire', 'Hot dinner and breakfast'],
    exclusions: ['Dawn flight add-on', 'Transport to Billing', 'Lunch'],
    whatToBring: ['Warm layers (altitude)', 'Torch', 'Personal toiletries'],
  },
  'goa-scuba-diving-grande-twin-tank': {
    durationMinutes: 300, difficulty: 'moderate', minAge: 12, maxGroupSize: 8, languages: EN_HI,
    meetingPoint: 'Vasco boat jetty, Mormugao, Goa',
    seasonMonths: [10, 11, 12, 1, 2, 3, 4, 5],
    highlights: ['Two boat dives at Grande Island', 'Suzy’s Wreck and Davy Jones’ Locker', '12–18 m for certified divers', 'Logbook stamp included'],
    inclusions: ['Full dive gear', 'Boat and guide', 'Two ~30-min dives', 'Surface snacks and logbook stamp'],
    exclusions: ['Certification course', 'Transport to Vasco', 'Lunch'],
    whatToBring: ['PADI/SSI Open Water cert or higher', 'Swimwear', 'Towel', 'Sunscreen'],
  },
  'goa-kayaking-mandovi-mangrove': {
    durationMinutes: 120, difficulty: 'easy', minAge: 8, maxGroupSize: 12, languages: EN_HI,
    meetingPoint: 'Mandovi backwater launch, near Panaji, Goa',
    seasonMonths: [10, 11, 12, 1, 2, 3, 4, 5],
    highlights: ['Calm dawn paddle through mangroves', 'Kingfishers, herons and mudskippers', 'Stable sit-on-top kayaks', 'Naturalist guide'],
    inclusions: ['Sit-on-top kayak and life-jacket', 'Naturalist guide', 'Paddling brief'],
    exclusions: ['Transport', 'Meals', 'Photos'],
    whatToBring: ['Sun hat and sunscreen', 'Water bottle', 'Quick-dry clothes'],
  },
  'goa-camping-cola-beach-hideaway': {
    durationMinutes: 1080, difficulty: 'easy', minAge: 8, maxGroupSize: 16, languages: EN_HI,
    meetingPoint: 'Cola Beach, Canacona, South Goa',
    seasonMonths: [11, 12, 1, 2, 3],
    highlights: ['Sea-facing tent beside an emerald lagoon', 'Fresh seafood dinner', 'Lagoon kayak', 'Sunrise swim'],
    inclusions: ['Sea-facing tent', 'Seafood dinner and breakfast', 'Lagoon kayak'],
    exclusions: ['Transport (bumpy jeep track)', 'Lunch', 'Alcohol'],
    whatToBring: ['Swimwear', 'Light layers', 'Torch', 'Insect repellent'],
  },
  'andaman-scuba-diving-havelock-discovery': {
    durationMinutes: 180, difficulty: 'easy', minAge: 10, maxGroupSize: 4, languages: EN_HI,
    meetingPoint: 'Havelock (Swaraj Dweep) dive base, Andaman Islands',
    seasonMonths: [10, 11, 12, 1, 2, 3, 4, 5],
    highlights: ['First-timer reef dive off Nemo Reef', '1:2 instructor ratio', 'Turtles, batfish and soft coral', 'Underwater photo set included'],
    inclusions: ['Full gear and 1:2 instructor', 'Pool-skills brief and 30-min dive', 'Underwater photos'],
    exclusions: ['Certification course', 'Transport to Havelock', 'Meals'],
    whatToBring: ['Swimwear', 'Towel', 'Basic swimming ability', 'Sunscreen (reef-safe)'],
  },
  'andaman-kayaking-mangrove-bioluminescence': {
    durationMinutes: 120, difficulty: 'easy', minAge: 12, maxGroupSize: 10, languages: EN_HI,
    meetingPoint: 'Havelock mangrove creek launch, Andaman Islands',
    seasonMonths: [11, 12, 1, 2, 3, 4],
    highlights: ['Night paddle through glowing plankton', 'New-moon only for darkest skies', 'Stable tandem kayaks', 'Glow-safe naturalist guiding'],
    inclusions: ['Tandem kayak and life-jacket', 'Naturalist guide', 'Glow-safe brief'],
    exclusions: ['Transport', 'Meals', 'Photos (low light)'],
    whatToBring: ['Quick-dry clothes', 'Insect repellent', 'A light jacket'],
  },
  'andaman-camping-radhanagar-eco': {
    durationMinutes: 1080, difficulty: 'easy', minAge: 8, maxGroupSize: 16, languages: EN_HI,
    meetingPoint: 'Radhanagar Beach eco-camp, Havelock, Andaman Islands',
    seasonMonths: [11, 12, 1, 2, 3, 4],
    highlights: ['Eco-tent minutes from Radhanagar Beach', 'Guided snorkelling off the rocks', 'Beach campfire and sunset walk', 'Solar lighting, low footprint'],
    inclusions: ['Sea-breeze eco-tent', 'Guided snorkelling', 'Island-style meals', 'Beach campfire'],
    exclusions: ['Transport to Havelock', 'Alcohol', 'Personal gear'],
    whatToBring: ['Swimwear', 'Reef-safe sunscreen', 'Torch', 'Light layers'],
  },
  'leh-ladakh-trekking-markha-valley-6d': {
    durationMinutes: 8640, difficulty: 'challenging', minAge: 14, maxGroupSize: 12, languages: EN_HI,
    meetingPoint: 'Chilling / Skiu roadhead, Hemis National Park, Ladakh',
    seasonMonths: [6, 7, 8, 9],
    highlights: ['Crosses Kongmaru La at 5,260 m', 'Through Hemis National Park gompas and homestays', 'Two river fords', 'Full acclimatisation built in'],
    inclusions: ['Guide and meals', 'Hemis NP / Wildlife Department entry permit', 'Stock animals for kit', 'Homestay and camp mix'],
    exclusions: ['Flights to Leh', 'Personal trekking gear', 'Travel insurance'],
    whatToBring: ['High-altitude trekking boots', 'Down jacket and warm layers', 'Sun protection', 'Personal medication and headlamp'],
    itinerary: [
      { title: 'Leh to Chilling, trek to Skiu', description: 'Drive to the roadhead and walk to Skiu village.', dayOffset: 0, durationMinutes: 240 },
      { title: 'Skiu to Markha', description: 'Follow the valley past gompas to Markha village, with river fords.', dayOffset: 1, durationMinutes: 360 },
      { title: 'Markha to Thachungtse', description: 'Climb toward the high meadows below the pass.', dayOffset: 2, durationMinutes: 360 },
      { title: 'Thachungtse to Nimaling', description: 'Acclimatisation walk to the Nimaling plateau (~4,700 m).', dayOffset: 3, durationMinutes: 300 },
      { title: 'Cross Kongmaru La (5,260 m)', description: 'Summit-day crossing of the pass, then descend to Chokdo.', dayOffset: 4, durationMinutes: 480 },
      { title: 'Chokdo to Leh', description: 'Final walk out and drive back to Leh.', dayOffset: 5, durationMinutes: 240 },
    ],
  },
  'leh-ladakh-rafting-zanskar-grade-iv': {
    durationMinutes: 360, difficulty: 'challenging', minAge: 16, maxGroupSize: 8, languages: EN_HI,
    meetingPoint: 'Chilling put-in, Zanskar gorge, Ladakh',
    seasonMonths: [7, 8],
    highlights: ['~28 km Grade III–IV through the Zanskar gorge', 'Towering canyon walls', 'Ends at the Indus–Zanskar confluence at Nimu', 'Dry-suits and expedition rafts'],
    inclusions: ['Dry-suit and full gear', 'Expedition raft and IRF-certified guides', 'Inner Line Permit', 'Confluence finish'],
    exclusions: ['Transport to Chilling', 'Meals', 'Insurance'],
    whatToBring: ['Strong swimming ability', 'Warm base layers', 'Secured footwear', 'A change of dry clothes'],
  },
  'leh-ladakh-safari-nubra-overland-2d': {
    durationMinutes: 2880, difficulty: 'easy', minAge: 6, maxGroupSize: 6, languages: EN_HI,
    meetingPoint: 'Leh city pickup (4×4 departure)',
    seasonMonths: [5, 6, 7, 8, 9],
    highlights: ['Crosses Khardung La at 5,359 m', 'Diskit monastery and Hunder dunes', 'Double-humped Bactrian camel ride', 'Luxury desert-camp night'],
    inclusions: ['4×4 vehicle and driver', 'Inner Line Permit', 'Desert camp and meals', 'Camel ride'],
    exclusions: ['Flights to Leh', 'Personal expenses', 'Tips'],
    whatToBring: ['Warm layers for the pass', 'Sun protection', 'Personal medication', 'Camera'],
    itinerary: [
      { title: 'Leh over Khardung La to Nubra', description: 'Drive over the 5,359 m pass to Diskit and the Hunder dunes.', dayOffset: 0, durationMinutes: 420 },
      { title: 'Nubra to Leh', description: 'Camel ride and monastery visit, then return drive to Leh.', dayOffset: 1, durationMinutes: 420 },
    ],
  },
  'leh-ladakh-camping-pangong-lakeside': {
    durationMinutes: 1080, difficulty: 'easy', minAge: 8, maxGroupSize: 16, languages: EN_HI,
    meetingPoint: 'Pangong Tso lakeside camp, Ladakh',
    seasonMonths: [5, 6, 7, 8, 9],
    highlights: ['Lakeside tent at ~4,350 m', 'Colour-shifting Pangong Tso', 'Oxygen on standby', 'Some of India’s clearest night skies'],
    inclusions: ['Premium twin-share tent with bedding', 'Hot dinner and breakfast', 'Inner Line Permit', 'Oxygen on standby'],
    exclusions: ['Transport from Leh', 'Lunch', 'Personal expenses'],
    whatToBring: ['Down jacket and thermals', 'Personal medication for altitude', 'Torch', 'Sun protection'],
  },
  'spiti-safari-snow-leopard-trail': {
    durationMinutes: 10080, difficulty: 'challenging', minAge: 16, maxGroupSize: 8, languages: EN_HI,
    meetingPoint: 'Kibber village base, Spiti Valley, Himachal Pradesh',
    seasonMonths: [1, 2, 3],
    highlights: ['Track snow leopard, ibex and blue sheep', 'Local Kibber spotters and scopes', 'Winter homestay base', 'High-altitude wildlife (4,000 m+)'],
    inclusions: ['Local spotters and spotting scopes', 'Homestay base', 'Warm-gear guidance', 'Daily tracking'],
    exclusions: ['Transport to Kibber', 'Personal winter gear', 'Travel insurance'],
    whatToBring: ['Expedition-grade down layers', 'Insulated boots', 'Patience and altitude tolerance', 'Personal medication'],
  },
  'spiti-trekking-pin-parvati-base': {
    durationMinutes: 4320, difficulty: 'moderate', minAge: 14, maxGroupSize: 12, languages: EN_HI,
    meetingPoint: 'Mud village, Pin Valley, Spiti, Himachal Pradesh',
    seasonMonths: [6, 7, 8, 9],
    highlights: ['High-desert Pin Valley National Park', 'Kungri gompa and Buddhist hamlets', 'Fossil-hunting stop', 'Ibex country at 3,600 m+'],
    inclusions: ['Guide and camps', 'Meals', 'Fossil-hunting stop'],
    exclusions: ['Transport to Mud', 'Personal gear', 'Insurance'],
    whatToBring: ['Trekking boots', 'Warm layers', 'Sun protection', 'Headlamp'],
    itinerary: [
      { title: 'Mud to Kungri', description: 'Trek past Kungri gompa into the high desert.', dayOffset: 0, durationMinutes: 300 },
      { title: 'Pin Valley grazing grounds', description: 'Walk through ibex country with a fossil stop.', dayOffset: 1, durationMinutes: 360 },
      { title: 'Return to Mud', description: 'Trek back down to the village roadhead.', dayOffset: 2, durationMinutes: 240 },
    ],
  },
  'spiti-camping-chandratal-lakeside': {
    durationMinutes: 1080, difficulty: 'easy', minAge: 8, maxGroupSize: 16, languages: EN_HI,
    meetingPoint: 'Chandratal camp, Spiti–Lahaul boundary, Himachal Pradesh',
    seasonMonths: [6, 7, 8, 9],
    highlights: ['Camp near the crescent Chandratal at 4,300 m', 'Guided 1-hour lake circuit', 'Among the darkest Milky-Way skies', 'Road open Jun–Sep only'],
    inclusions: ['Twin-share tent', 'Hot meals', 'Guided lake circuit'],
    exclusions: ['Transport to Chandratal', 'Lunch en route', 'Personal expenses'],
    whatToBring: ['Down jacket and thermals', 'Torch', 'Personal medication for altitude'],
  },
  'kasol-trekking-sar-pass-4d': {
    durationMinutes: 5760, difficulty: 'moderate', minAge: 14, maxGroupSize: 16, languages: EN_HI,
    meetingPoint: 'Kasol base, Parvati Valley, Himachal Pradesh',
    seasonMonths: [5, 6],
    highlights: ['Crosses the 4,220 m Sar Pass', 'Famous glissade descent to Biskeri Thach', 'Through Grahan village and Min Thach', 'Pine forest, meadow and snow'],
    inclusions: ['Guide and camps', 'All meals', 'Glissade descent'],
    exclusions: ['Transport to Kasol', 'Personal gear', 'Insurance'],
    whatToBring: ['Trekking boots', 'Warm and waterproof layers', 'Gaiters for snow', 'Headlamp'],
    itinerary: [
      { title: 'Kasol to Grahan', description: 'Walk through pine forest to Grahan village.', dayOffset: 0, durationMinutes: 300 },
      { title: 'Grahan to Min Thach', description: 'Climb to the Min Thach meadow camp.', dayOffset: 1, durationMinutes: 300 },
      { title: 'Cross Sar Pass (4,220 m)', description: 'Summit the pass and glissade down to Biskeri Thach.', dayOffset: 2, durationMinutes: 420 },
      { title: 'Descend to Barshaini', description: 'Final descent and transfer back to Kasol.', dayOffset: 3, durationMinutes: 240 },
    ],
  },
  'kasol-trekking-kheerganga-2d': {
    durationMinutes: 2880, difficulty: 'easy', minAge: 10, maxGroupSize: 16, languages: EN_HI,
    meetingPoint: 'Barshaini roadhead, Parvati Valley, Himachal Pradesh',
    seasonMonths: [4, 5, 6, 9, 10, 11],
    highlights: ['Natural hot springs at ~3,050 m', 'Kalga apple orchards and pine forest', 'Riverside camp', 'Spring-side dip under open sky'],
    inclusions: ['Guide', 'Riverside camp and meals', 'Hot-spring dip'],
    exclusions: ['Transport to Barshaini', 'Personal gear', 'Tips'],
    whatToBring: ['Trekking shoes', 'Swimwear for the springs', 'Warm layers', 'Headlamp'],
    itinerary: [
      { title: 'Barshaini to Kheerganga', description: 'Trek up through forest and waterfalls to the hot springs.', dayOffset: 0, durationMinutes: 300 },
      { title: 'Kheerganga to Barshaini', description: 'Morning dip, then descend to the roadhead.', dayOffset: 1, durationMinutes: 240 },
    ],
  },
  'kasol-camping-parvati-riverside': {
    durationMinutes: 1080, difficulty: 'easy', minAge: 6, maxGroupSize: 20, languages: EN_HI,
    meetingPoint: 'Parvati riverside camp, near Kasol, Himachal Pradesh',
    seasonMonths: [3, 4, 5, 6, 9, 10, 11],
    highlights: ['Riverside tent near Kasol’s cafés', 'Bonfire by the rushing Parvati', 'Israeli-café trail and Chalal walk', 'Relaxed valley introduction'],
    inclusions: ['Twin-share tent', 'Riverside bonfire', 'Dinner and breakfast'],
    exclusions: ['Transport to Kasol', 'Lunch', 'Café spends'],
    whatToBring: ['Light layers', 'Torch', 'Personal toiletries'],
  },
  'kasol-rock-climbing-chalal-crag': {
    durationMinutes: 240, difficulty: 'moderate', minAge: 12, maxGroupSize: 10, languages: EN_HI,
    meetingPoint: 'Chalal crags, across the Parvati footbridge from Kasol',
    seasonMonths: [3, 4, 5, 6, 9, 10, 11],
    highlights: ['Top-rope and bouldering on granite', 'Routes from Grade 4 to 6a', 'All gear and certified instructors', 'No experience needed'],
    inclusions: ['Harness, shoes, helmet and ropes', 'Certified instructors', 'Coached half-day'],
    exclusions: ['Transport', 'Meals', 'Photos'],
    whatToBring: ['Athletic clothing', 'Closed-toe shoes', 'Water bottle'],
  },
}

// Real customer names for review authors + booking/wallet spread.
const PEOPLE: Array<{ id: string; name: string; email: string }> = [
  { id: 'u_enr_cust_aanya', name: 'Aanya Kapoor', email: 'enrich+aanya@seed.switchback.dev' },
  { id: 'u_enr_cust_rohan', name: 'Rohan Mehta', email: 'enrich+rohan@seed.switchback.dev' },
  { id: 'u_enr_cust_ishaan', name: 'Ishaan Verma', email: 'enrich+ishaan@seed.switchback.dev' },
  { id: 'u_enr_cust_diya', name: 'Diya Nair', email: 'enrich+diya@seed.switchback.dev' },
  { id: 'u_enr_cust_kabir', name: 'Kabir Singh', email: 'enrich+kabir@seed.switchback.dev' },
  { id: 'u_enr_cust_meera', name: 'Meera Iyer', email: 'enrich+meera@seed.switchback.dev' },
]

const REVIEW_BANK: Array<{ rating: number; title: string; body: string; resp?: string }> = [
  { rating: 5, title: 'Absolutely unforgettable', body: 'Guides were certified and calm, kit was spotless, and the views were unreal. Booking and the partial-pay split made it painless.', resp: 'Thank you so much! Hope to host you again next season.' },
  { rating: 5, title: 'Worth every rupee', body: 'Small group, great safety briefing, and the team genuinely cared. The free-cancellation policy gave us confidence to book early.' },
  { rating: 4, title: 'Great day out, minor delay', body: 'The experience itself was 5-star. Pickup ran ~20 min late but the crew more than made up for it.', resp: 'Apologies for the delay — we have tightened our pickup window since.' },
  { rating: 4, title: 'Beautiful and well organised', body: 'Everything was as described. Would have liked a few more photos included but the activity was superb.' },
  { rating: 5, title: 'Best part of our trip', body: 'Professional, punctual, and so much fun. The instructors put nervous first-timers at ease immediately.' },
  { rating: 3, title: 'Good but crowded', body: 'Enjoyed it overall. The site was busier than expected so it felt a little rushed at peak hour.', resp: 'Thanks for the honest note — we now offer early-morning slots to avoid the rush.' },
  { rating: 5, title: 'Felt completely safe', body: 'As a solo traveller this mattered most. Verified vendor badge was accurate — proper gear and a real safety stack.' },
  { rating: 4, title: 'Stunning scenery', body: 'A genuine highlight. Knock a star only because the meeting point was a little hard to find on Maps.' },
  { rating: 2, title: 'Weather cut it short', body: 'Not the operators fault, but the session ended early due to conditions. They handled the refund fairly though.', resp: 'Sorry the weather turned — your refund was processed to your Switchback wallet the same day.' },
  { rating: 5, title: 'Incredible guides', body: 'Knowledgeable, funny, and patient. They made the whole thing memorable for our group of six.' },
  { rating: 4, title: 'Smooth from start to finish', body: 'Clear instructions, good gear, fair price. Checkout was quick and the confirmation was instant.' },
  { rating: 5, title: 'Highly recommend', body: 'Already planning to come back with friends. The transparent pricing and verified badge sealed it for us.' },
  { rating: 3, title: 'Decent value', body: 'Solid experience for the price. Equipment was a touch worn but everything worked and felt safe.' },
  { rating: 5, title: 'Five stars, no notes', body: 'Punctual, professional, and genuinely thrilling. The kind of trip you talk about for months.' },
  { rating: 4, title: 'Loved it', body: 'Great instructors and a gorgeous setting. Would book through Switchback again in a heartbeat.', resp: 'Means a lot — thank you for choosing us!' },
]

/**
 * Hero social-proof enrichment (card-badges P1 fix).
 *
 * The card badges in `lib/experiences/card-badges.ts` are data-backed:
 *   - `bestseller`  ⇐ >= BESTSELLER_MIN_BOOKINGS (6) demand-state bookings
 *                     (confirmed / awaiting_completion / completed).
 *   - `top_rated`   ⇐ >= TOP_RATED_MIN_COUNT (5) published reviews whose
 *                     average rating is >= TOP_RATED_MIN_AVG (4.6), AND
 *                     fewer than 6 demand bookings (so bestseller wins ties).
 *
 * Step 6 above only gives each catalog row ~2 reviews and ~2 demand bookings,
 * so on a fresh DB nothing earns a badge. This block deliberately enriches a
 * handful of FLAGSHIP catalog experiences so the badges actually render.
 *
 * Demand bookkeeping (matters for the top_rated < 6 constraint): step 6 already
 * attaches 2 `completed` (= demand) bookings to every catalog row at index
 * 0..13, and step 7 attaches one booking to indices 14..19. The two top_rated
 * targets below (marine-drive @0, paragliding @12) therefore already carry 2
 * demand bookings each. To keep them UNDER 6 demand (so they read as top_rated,
 * not bestseller) their 5 hero reviews ride on `cancelled_post_experience`
 * bookings — the experience happened (a legit review) but the booking was later
 * cancelled post-experience, so card-badges excludes it from the demand count.
 * Net demand for each top_rated target stays at 2 (< 6) while review count
 * reaches 7 (>= 5) at an average >= 4.6.
 *
 * The two bestseller targets get 7 fresh demand-state bookings (a realistic
 * confirmed / awaiting_completion / completed mix), pushing them comfortably
 * over the 6-booking bestseller threshold. No disputed bookings are ever added
 * (isolation contract); all targets are catalog (u_cat_*) experiences.
 */
const HERO_REVIEW_BANK: Array<{ rating: number; title: string; body: string; resp?: string }> = [
  { rating: 5, title: 'A genuine bucket-list day', body: 'From the safety brief to the final stretch, every detail was dialled in. The guides were calm, certified, and clearly loved their craft. Easily the highlight of our entire trip.', resp: 'This made our week — thank you for the kind words!' },
  { rating: 5, title: 'Flawless from booking to finish', body: 'Transparent pricing, instant confirmation, and an experience that exceeded the photos. The verified-vendor badge turned out to be completely earned.' },
  { rating: 5, title: 'Better than I dared hope', body: 'I was nervous as a first-timer but the crew put me at ease in minutes. Top-tier gear, real expertise, and a setting that took my breath away.' },
  { rating: 4, title: 'Superb — and great value', body: 'Knocking a single star only because I wish a couple of photos had been included. The activity itself was a clean five out of five.' },
  { rating: 5, title: 'Would do it again tomorrow', body: 'Professional, punctual and genuinely thrilling. You can feel the difference when an operator actually cares about safety and the guest experience.', resp: 'Come back any time — the door is always open.' },
  { rating: 5, title: 'Worth every single rupee', body: 'A small group, a brilliant guide, and a memory we will be telling people about for years. The free-cancellation policy gave us the confidence to book early.' },
  { rating: 5, title: 'The real deal', body: 'No upselling, no shortcuts, no surprises. Just a superbly run adventure by people who know exactly what they are doing. Highly, highly recommended.' },
]

async function main(db: SeedDb): Promise<void> {
  // ── 1. Catalog vendors (users + verified business-tier profiles) ──────────
  await db
    .insert(users)
    .values(
      CATALOG_VENDORS.map((v, i) => ({
        id: v.userId,
        email: v.email,
        name: v.businessName,
        image: IMG(VENDOR_LOGO_PHOTOS[i % VENDOR_LOGO_PHOTOS.length], 256),
      })),
    )
    .onConflictDoNothing()
  // A1 — differentiate every catalog Vendor: commission rate, SLA/trust score,
  // and a staggered historical join date (vendorVariety) so the admin vendor
  // list + the analytics "Vendor growth (monthly)" chart read as a real
  // marketplace, not "20% / 100% / joined today" everywhere.
  for (let vi = 0; vi < CATALOG_VENDORS.length; vi++) {
    const v = CATALOG_VENDORS[vi]
    const variety = vendorVariety(vi, CATALOG_VENDORS.length)
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
          'A KYC-verified Switchback operator running certified, safety-first adventures with experienced local guides. Small groups, transparent pricing, flexible cancellation within policy.',
      })
      .onConflictDoNothing()
  }

  // ── 2. Catalog experiences (published) ────────────────────────────────────
  // Structured ADR-0017 attributes (issue 06) are merged from STRUCTURED_BY_SLUG
  // and `requiresSafetyStack` is derived from the activity registry. Additive:
  // rows without a structured entry fall back to the nullable/array defaults.
  await db
    .insert(experiences)
    .values(
      CATALOG_EXPERIENCES.map((e) => {
        const s = STRUCTURED_BY_SLUG[e.slug]
        return {
          vendorUserId: e.vendor,
          slug: e.slug,
          title: e.title,
          shortDescription: e.short,
          longDescription: e.long,
          cancellationPreset: e.preset,
          paymentModesAllowed: ['full_upfront', 'partial_pay'] as (
            | 'full_upfront'
            | 'partial_pay'
            | 'reserve_now_pay_later'
          )[],
          pricePerPerson_1_2: e.p12,
          pricePerPerson_3_5: e.p35,
          pricePerPerson_6_plus: e.p6,
          requiredPermits: e.permits ?? [],
          requiresSafetyStack: getActivity(e.activity)?.requiresSafetyStack ?? false,
          regionSlug: e.region,
          activitySlug: e.activity,
          status: 'published' as const,
          ...(s
            ? {
                durationMinutes: s.durationMinutes,
                difficulty: s.difficulty,
                minAge: s.minAge,
                maxGroupSize: s.maxGroupSize,
                languages: s.languages,
                meetingPoint: s.meetingPoint,
                seasonMonths: s.seasonMonths,
                highlights: s.highlights,
                inclusions: s.inclusions,
                exclusions: s.exclusions,
                whatToBring: s.whatToBring,
              }
            : {}),
        }
      }),
    )
    .onConflictDoNothing()

  // Authoritative catalog set (fresh OR reseed): look up by slug.
  const catalogSlugs = CATALOG_EXPERIENCES.map((e) => e.slug)
  const catalog = await db
    .select({
      id: experiences.id,
      slug: experiences.slug,
      activitySlug: experiences.activitySlug,
      vendorUserId: experiences.vendorUserId,
      price12: experiences.pricePerPerson_1_2,
      preset: experiences.cancellationPreset,
    })
    .from(experiences)
    .where(inArray(experiences.slug, catalogSlugs))
  const catalogIds = catalog.map((c) => c.id)
  const catalogIdBySlug = new Map(catalog.map((c) => [c.slug, c.id]))

  // ── 2b. Structured itineraries (ADR-0017, issue 06) for multi-day rows ─────
  // Written via replaceItinerary (delete-then-insert) wrapped per-listing in a
  // tx — same contract as the Vendor form action / db/seed.ts. Idempotent.
  for (const e of CATALOG_EXPERIENCES) {
    const itinerary = STRUCTURED_BY_SLUG[e.slug]?.itinerary
    const expId = catalogIdBySlug.get(e.slug)
    if (!itinerary || itinerary.length === 0 || !expId) continue
    await db.transaction(async (tx) => {
      await replaceItinerary(tx, expId, itinerary)
    })
  }

  // ── 3. Availability slots for catalog experiences (2 future dates each) ────
  const slotForExp = new Map<string, string>()
  for (const exp of catalog) {
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

  // ── 3b. Default recurring availability → ~90 days of bookable dates ───────
  // Fills the PDP booking calendar for every catalog Experience (the 2 explicit
  // slots above anchor the review/demand bookings). Idempotent + additive.
  for (const exp of catalog) {
    await seedDefaultAvailability(db, exp.id)
  }

  // ── 4. media_assets — 6 per catalog experience + vendor logo/cover ────────
  // Re-runnable: clear only catalog-owned rows (storage_key prefix) first.
  await db.delete(mediaAssets).where(sql`${mediaAssets.storageKey} LIKE 'seed/catalog/%'`)
  for (const exp of catalog) {
    const photos = galleryFor(exp.activitySlug, exp.slug)
    await db.insert(mediaAssets).values(
      photos.map((pid, i) => ({
        uploadedBy: ADMIN_ID,
        storageKey: `seed/catalog/experience/${exp.slug}/${i}.jpg`,
        url: IMG(pid, 1200),
        contentType: 'image/jpeg',
        sizeBytes: 180_000 + i * 4096,
        altText: `${exp.slug} — photo ${i + 1}`,
        entityType: 'experience',
        entityId: exp.id,
      })),
    )
  }
  for (let i = 0; i < CATALOG_VENDORS.length; i++) {
    const v = CATALOG_VENDORS[i]
    await db.insert(mediaAssets).values([
      { uploadedBy: ADMIN_ID, storageKey: `seed/catalog/vendor/${v.userId}/logo.jpg`, url: IMG(VENDOR_LOGO_PHOTOS[i % VENDOR_LOGO_PHOTOS.length], 400), contentType: 'image/jpeg', sizeBytes: 64_000, altText: `${v.businessName} logo`, entityType: 'vendor', entityId: v.userId },
      { uploadedBy: ADMIN_ID, storageKey: `seed/catalog/vendor/${v.userId}/cover.jpg`, url: IMG(FALLBACK_PHOTOS[i % FALLBACK_PHOTOS.length], 1200), contentType: 'image/jpeg', sizeBytes: 220_000, altText: `${v.businessName} cover`, entityType: 'vendor', entityId: v.userId },
    ])
  }

  // ── 5. Catalog customers (+ avatars + profiles) ───────────────────────────
  await db
    .insert(users)
    .values(PEOPLE.map((p, i) => ({ id: p.id, email: p.email, name: p.name, image: IMG(AVATAR_PHOTOS[i % AVATAR_PHOTOS.length], 256) })))
    .onConflictDoNothing()
  await db.insert(customerProfiles).values(PEOPLE.map((p) => ({ userId: p.id }))).onConflictDoNothing()

  // ── 6. Reviews (>=25) on dedicated completed bookings, catalog-only ───────
  const reviewTargets = catalog.slice(0, 14)
  let bankIdx = 0
  for (let ei = 0; ei < reviewTargets.length; ei++) {
    const exp = reviewTargets[ei]
    const slotId = slotForExp.get(exp.id)
    if (!slotId) continue
    for (let r = 0; r < 2; r++) {
      const person = PEOPLE[(ei * 2 + r) % PEOPLE.length]
      const tmpl = REVIEW_BANK[bankIdx % REVIEW_BANK.length]
      bankIdx++
      const bId = ns('rev', ei * 10 + r)
      const exists = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bId)).limit(1)
      if (exists.length === 0) {
        const gross = Math.round(Number(exp.price12) * 2)
        await db.insert(bookings).values({
          id: bId,
          customerUserId: person.id,
          experienceId: exp.id,
          slotId,
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

  // ── 7. Extra catalog booking states for richer dashboards (no disputes) ───
  const stateSpread: Array<{ state: 'cancelled_by_vendor' | 'cancelled_post_experience' | 'awaiting_completion' | 'completed' | 'confirmed'; payout: 'pending' | 'approved' | 'rejected' | 'held' }> = [
    { state: 'cancelled_by_vendor', payout: 'rejected' },
    { state: 'cancelled_post_experience', payout: 'held' },
    { state: 'completed', payout: 'approved' },
    { state: 'awaiting_completion', payout: 'pending' },
    { state: 'confirmed', payout: 'pending' },
    { state: 'completed', payout: 'held' },
  ]
  for (let i = 0; i < stateSpread.length; i++) {
    const exp = catalog[(i + 14) % catalog.length]
    const slotId = slotForExp.get(exp.id)
    if (!slotId) continue
    const bId = ns('state', i)
    const exists = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bId)).limit(1)
    if (exists.length > 0) continue
    const s = stateSpread[i]
    const person = PEOPLE[i % PEOPLE.length]
    const gross = Math.round(Number(exp.price12) * 2)
    await db.insert(bookings).values({
      id: bId,
      customerUserId: person.id,
      experienceId: exp.id,
      slotId,
      participantCount: 2,
      state: s.state,
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
      payoutState: s.payout,
      ...(s.state === 'completed' ? { completedAt: ago(10) } : {}),
      ...(s.state.startsWith('cancelled') ? { cancelledAt: ago(5), cancellationReason: 'Catalog demo cancellation.' } : {}),
      confirmedAt: ago(35),
    })
  }

  // ── 7b. Hero social-proof: flagship cards that earn Bestseller / Top-rated ─
  // See HERO_REVIEW_BANK above for the full rationale + demand bookkeeping.
  const catalogBySlug = new Map(catalog.map((c) => [c.slug, c]))

  // TOP-RATED targets: 5 published reviews (avg >= 4.6) on non-demand
  // (`cancelled_post_experience`) bookings so demand stays < 6 → top_rated.
  const HERO_TOP_RATED = [
    'rishikesh-rafting-marine-drive-25km',
    'bir-billing-paragliding-acro-cross-country',
  ]
  const HERO_TOP_RATED_RATINGS = [5, 5, 5, 4, 5] as const // avg 4.8 (>= 4.6)
  for (let ti = 0; ti < HERO_TOP_RATED.length; ti++) {
    const exp = catalogBySlug.get(HERO_TOP_RATED[ti])
    const slotId = exp ? slotForExp.get(exp.id) : undefined
    if (!exp || !slotId) continue
    const gross = Math.round(Number(exp.price12) * 2)
    for (let r = 0; r < HERO_TOP_RATED_RATINGS.length; r++) {
      const person = PEOPLE[(ti * 5 + r) % PEOPLE.length]
      const bId = ns('hero', ti * 100 + r)
      const bExists = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bId)).limit(1)
      if (bExists.length === 0) {
        await db.insert(bookings).values({
          id: bId,
          customerUserId: person.id,
          experienceId: exp.id,
          slotId,
          participantCount: 2,
          state: 'cancelled_post_experience',
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
          payoutState: 'held',
          confirmedAt: ago(45),
          completedAt: ago(25),
          cancelledAt: ago(22),
          cancellationReason: 'Post-experience cancellation (demo).',
        })
      }
      const tmpl = HERO_REVIEW_BANK[(ti * 5 + r) % HERO_REVIEW_BANK.length]
      const revExists = await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.bookingId, bId)).limit(1)
      if (revExists.length === 0) {
        await db.insert(reviews).values({
          bookingId: bId,
          customerUserId: person.id,
          experienceId: exp.id,
          vendorUserId: exp.vendorUserId,
          rating: HERO_TOP_RATED_RATINGS[r],
          title: tmpl.title,
          body: tmpl.body,
          status: 'published',
          ...(tmpl.resp ? { vendorResponse: tmpl.resp, vendorRespondedAt: ago(20) } : {}),
          createdAt: ago(24 - r),
        })
      }
    }
  }

  // BESTSELLER targets: 7 demand-state bookings each (confirmed /
  // awaiting_completion / completed mix) → >= 6 demand → bestseller.
  const HERO_BESTSELLER = [
    'goa-scuba-diving-grande-twin-tank',
    'manali-trekking-beas-kund-3d',
  ]
  const HERO_BESTSELLER_STATES: Array<'confirmed' | 'awaiting_completion' | 'completed'> = [
    'completed', 'completed', 'completed', 'awaiting_completion', 'awaiting_completion', 'confirmed', 'confirmed',
  ]
  for (let bi = 0; bi < HERO_BESTSELLER.length; bi++) {
    const exp = catalogBySlug.get(HERO_BESTSELLER[bi])
    const slotId = exp ? slotForExp.get(exp.id) : undefined
    if (!exp || !slotId) continue
    const gross = Math.round(Number(exp.price12) * 2)
    for (let k = 0; k < HERO_BESTSELLER_STATES.length; k++) {
      const state = HERO_BESTSELLER_STATES[k]
      const person = PEOPLE[(bi * 7 + k) % PEOPLE.length]
      const bId = ns('hero', 1000 + bi * 100 + k)
      const bExists = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bId)).limit(1)
      if (bExists.length > 0) continue
      await db.insert(bookings).values({
        id: bId,
        customerUserId: person.id,
        experienceId: exp.id,
        slotId,
        participantCount: 2,
        state,
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
        payoutState: state === 'completed' ? 'approved' : 'pending',
        confirmedAt: ago(38 - k),
        ...(state === 'completed' ? { completedAt: ago(12 - k) } : {}),
      })
    }
  }

  // ── 8. payments for catalog confirmed/completed bookings ──────────────────
  // A1 — spread capture dates HISTORICALLY across the last ~12 months so the
  // admin revenue chart (groups payments.captured_at by month) shows a real
  // curve instead of a flat ₹0 for 13 months then one recent spike. Each
  // catalog payment is pinned to a deterministic month back from now, keyed by
  // its index in the payable set (idempotent across reseeds — the booking set
  // is stable). The most recent few stay near the present so the latest month
  // is also populated.
  const payable = await db
    .select({ id: bookings.id, gross: bookings.grossTotalSnapshot })
    .from(bookings)
    .where(and(inArray(bookings.experienceId, catalogIds), inArray(bookings.state, ['confirmed', 'completed', 'awaiting_completion'])))
    .orderBy(bookings.id)
  for (let pi = 0; pi < payable.length; pi++) {
    const b = payable[pi]
    const has = await db.select({ id: payments.id }).from(payments).where(eq(payments.bookingId, b.id)).limit(1)
    if (has.length > 0) continue
    // Walk backwards one month at a time, cycling through the last 12 months so
    // every month bucket gets capture rows (a populated 12-month window).
    const monthsBack = pi % 12
    const capturedAt = ago(monthsBack * 30 + ((pi * 7) % 25))
    await db.insert(payments).values({
      bookingId: b.id,
      razorpayPaymentId: `pay_cat_${b.id}_full`,
      razorpayOrderId: `order_cat_${b.id}_full`,
      amount: Number(b.gross).toFixed(2),
      captureTrigger: 'booking_create',
      capturedAt,
    })
  }

  // ── 9. Blog posts — the editorial corpus (db/content/blog, 40 posts) ──────
  // Idempotent upsert keyed on slug; reuses the demo admin as the byline so the
  // index/PDP render the real corpus instead of placeholder stubs.
  await upsertBlogPosts(db, { authorAdminId: ADMIN_ID })

  // ── 10. site_content — all 6 sections (admin CMS; not yet read publicly) ──
  const featuredIds = catalogIds.slice(0, 6)
  const SITE: Array<{ section: string; value: Record<string, unknown> }> = [
    { section: 'hero', value: { title: 'Find your next adventure', subtitle: 'KYC-verified vendors. Transparent pricing. Flexible cancellation.', ctaText: 'Explore experiences', ctaLink: '/search', backgroundImageUrl: IMG('photo-1530866495561-507c9faab2ed', 1600) } },
    { section: 'announcement_bar', value: { text: 'Monsoon season is here — waterfall rappelling now live in Lonavala', linkText: 'Browse', linkUrl: '/search?region=lonavala', enabled: true, backgroundColor: '#0f766e' } },
    { section: 'homepage', value: { featuredSectionTitle: 'Featured experiences', featuredExperienceIds: featuredIds, showCategories: true, showTestimonials: true } },
    { section: 'branding', value: { siteName: 'Switchback', primaryColor: '#0f766e', logoUrl: IMG('photo-1557804506-669a67965ba0', 256), faviconUrl: IMG('photo-1557804506-669a67965ba0', 64) } },
    { section: 'seo', value: { defaultTitle: 'Switchback — India adventure marketplace', titleTemplate: '%s · Switchback', defaultDescription: 'Book rafting, paragliding, scuba, trekking and more from KYC-verified Indian adventure operators.', ogImageUrl: IMG('photo-1530866495561-507c9faab2ed', 1200), robots: 'index,follow' } },
    { section: 'footer', value: { companyName: 'Switchback', copyrightText: '© 2026 Switchback. All rights reserved.', links: [{ label: 'Cancellation policy', url: '/cancellation-policy' }, { label: 'Search', url: '/search' }], socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/switchback' }] } },
  ]
  for (const s of SITE) {
    const exists = await db
      .select({ id: siteContent.id })
      .from(siteContent)
      .where(and(eq(siteContent.section, s.section), eq(siteContent.key, 'default'), eq(siteContent.locale, 'en')))
      .limit(1)
    if (exists.length > 0) continue
    await db.insert(siteContent).values({ section: s.section, key: 'default', value: s.value, locale: 'en', version: 1, updatedByAdminId: ADMIN_ID })
  }

  // ── 11. Notifications (+ outbox + preferences) — catalog users ONLY ───────
  const notifTargets = [...PEOPLE.slice(0, 4).map((p) => p.id), ...CATALOG_VENDORS.slice(0, 2).map((v) => v.userId)]
  const NOTIF_TYPES = ['booking_created', 'booking_completed', 'review_posted', 'payout_processed', 'message_received', 'listing_approved'] as const
  const NOTIF_COPY: Record<string, [string, string, string]> = {
    booking_created: ['Booking confirmed', 'Your adventure is booked. We sent a voucher to your email.', '/dashboard'],
    booking_completed: ['Experience completed', 'Hope you had a great time! Leave a review to help others.', '/dashboard'],
    review_posted: ['New review', 'A customer left a review on one of your listings.', '/vendor/reviews'],
    payout_processed: ['Payout processed', 'Your latest payout cycle has been released.', '/vendor/payouts'],
    message_received: ['New message', 'You have a new message from a customer.', '/vendor/messages'],
    listing_approved: ['Listing approved', 'Your experience is now live and discoverable.', '/vendor/listings'],
  }
  for (let ti = 0; ti < notifTargets.length; ti++) {
    const uid = notifTargets[ti]
    for (let i = 0; i < 3; i++) {
      const type = NOTIF_TYPES[(ti + i) % NOTIF_TYPES.length]
      const eventId = `cat_notif_${uid}_${i}`
      const exists = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.eventId, eventId)).limit(1)
      if (exists.length > 0) continue
      const [title, body, link] = NOTIF_COPY[type]
      const [n] = await db
        .insert(notifications)
        .values({ userId: uid, type, title, body, link, eventId, readAt: i === 0 ? new Date() : null, createdAt: ago(i + 1) })
        .returning({ id: notifications.id })
      if (n) {
        await db.insert(notificationOutbox).values([
          { notificationId: n.id, channel: 'in_app', status: 'sent', deliveredAt: new Date() },
          { notificationId: n.id, channel: 'email', status: i % 2 === 0 ? 'sent' : 'pending' },
        ])
      }
    }
  }
  for (const uid of [PEOPLE[0].id, CATALOG_VENDORS[0].userId]) {
    for (const channel of ['email', 'whatsapp']) {
      await db
        .insert(notificationPreferences)
        .values({ userId: uid, eventType: 'payout_processed', channel, enabled: channel !== 'whatsapp' })
        .onConflictDoNothing()
    }
  }

  // ── 12. Support tickets (>=8) + threaded messages — catalog customers ─────
  const TICKETS: Array<{ id: string; subject: string; status: 'open' | 'in_progress' | 'resolved' | 'closed'; priority: 'low' | 'medium' | 'high'; category: 'booking' | 'payment' | 'experience' | 'account' | 'cancellation' | 'other'; creator: string; msgs: Array<{ from: string; body: string }> }> = [
    { id: ns('tkt', 1), subject: 'Refund not yet credited to wallet', status: 'in_progress', priority: 'high', category: 'cancellation', creator: PEOPLE[0].id, msgs: [{ from: PEOPLE[0].id, body: 'I cancelled within policy 3 days ago but the refund has not shown in my Switchback wallet yet.' }, { from: ADMIN_ID, body: 'Thanks for flagging — I have escalated this to our payments team and will update you within 24h.' }] },
    { id: ns('tkt', 2), subject: 'Cannot change my booking date', status: 'open', priority: 'medium', category: 'booking', creator: PEOPLE[1].id, msgs: [{ from: PEOPLE[1].id, body: 'Is it possible to move my rafting slot to next weekend?' }] },
    { id: ns('tkt', 3), subject: 'Vendor was 30 minutes late', status: 'resolved', priority: 'medium', category: 'experience', creator: PEOPLE[2].id, msgs: [{ from: PEOPLE[2].id, body: 'The operator showed up late and we missed part of the session.' }, { from: ADMIN_ID, body: 'Sorry to hear that. We have issued a 20% goodwill credit to your wallet.' }, { from: PEOPLE[2].id, body: 'Received, thank you!' }] },
    { id: ns('tkt', 4), subject: 'Payment charged twice', status: 'in_progress', priority: 'high', category: 'payment', creator: PEOPLE[3].id, msgs: [{ from: PEOPLE[3].id, body: 'My card was charged twice for the same booking.' }, { from: ADMIN_ID, body: 'We see the duplicate and are reversing the second charge now.' }] },
    { id: ns('tkt', 5), subject: 'How do I become a vendor?', status: 'closed', priority: 'low', category: 'account', creator: PEOPLE[4].id, msgs: [{ from: PEOPLE[4].id, body: 'I run a kayaking outfit in Goa — how do I list?' }, { from: ADMIN_ID, body: 'Head to /vendor/onboarding to start the 3-step verification.' }] },
    { id: ns('tkt', 6), subject: 'Question about permits for Ladakh trek', status: 'open', priority: 'low', category: 'experience', creator: PEOPLE[5].id, msgs: [{ from: PEOPLE[5].id, body: 'Does the Markha Valley trek include the Inner Line Permit?' }] },
    { id: ns('tkt', 7), subject: 'Wallet credit expired too soon', status: 'resolved', priority: 'medium', category: 'other', creator: PEOPLE[0].id, msgs: [{ from: PEOPLE[0].id, body: 'My promo credit expired before I could use it.' }, { from: ADMIN_ID, body: 'I have reinstated the credit with a fresh 12-month expiry.' }] },
    { id: ns('tkt', 8), subject: 'Confirmation email not received', status: 'closed', priority: 'low', category: 'booking', creator: PEOPLE[1].id, msgs: [{ from: PEOPLE[1].id, body: 'I booked but never got a confirmation email.' }, { from: ADMIN_ID, body: 'Resent — please check your spam folder too.' }, { from: PEOPLE[1].id, body: 'Got it, thanks.' }] },
    { id: ns('tkt', 9), subject: 'Need invoice for company reimbursement', status: 'in_progress', priority: 'medium', category: 'payment', creator: PEOPLE[2].id, msgs: [{ from: PEOPLE[2].id, body: 'Can I get a GST invoice for my booking?' }, { from: ADMIN_ID, body: 'Generating it now — you will have it by end of day.' }] },
  ]
  for (const t of TICKETS) {
    const exists = await db.select({ id: supportTickets.id }).from(supportTickets).where(eq(supportTickets.id, t.id)).limit(1)
    if (exists.length > 0) continue
    await db.insert(supportTickets).values({
      id: t.id,
      createdByUserId: t.creator,
      assignedToAdminId: t.status === 'open' ? null : ADMIN_ID,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      category: t.category,
    })
    for (const m of t.msgs) {
      await db.insert(supportMessages).values({ ticketId: t.id, senderUserId: m.from, body: m.body })
    }
  }

  // ── 13. Promo codes (>=5) + redemptions (>=10) — catalog customers ────────
  const PROMOS: Array<{ code: string; credit: string; max?: number; perUser?: number; min?: string }> = [
    { code: 'WELCOME500', credit: '500.00', perUser: 1 },
    { code: 'MONSOON15', credit: '750.00', max: 500, min: '3000.00' },
    { code: 'FIRSTBOOKING', credit: '1000.00', perUser: 1, min: '5000.00' },
    { code: 'DIWALI2026', credit: '1500.00', max: 1000 },
    { code: 'REFER300', credit: '300.00', perUser: 5 },
    { code: 'SUMMER10', credit: '600.00', max: 800, min: '2500.00' },
    { code: 'LADAKH2000', credit: '2000.00', max: 200, min: '15000.00' },
  ]
  const promoIds = new Map<string, string>()
  for (const p of PROMOS) {
    const exists = await db.select({ id: promoCodes.id }).from(promoCodes).where(eq(promoCodes.code, p.code)).limit(1)
    if (exists.length > 0) {
      promoIds.set(p.code, exists[0].id)
      continue
    }
    const [row] = await db
      .insert(promoCodes)
      .values({ code: p.code, creditAmount: p.credit, minBookingAmount: p.min ?? null, maxTotalUses: p.max ?? null, perUserLimit: p.perUser ?? 1, active: true, startsAt: ago(30), expiresAt: ahead(180), createdByAdminId: ADMIN_ID })
      .returning({ id: promoCodes.id })
    if (row) promoIds.set(p.code, row.id)
  }
  for (const p of PROMOS.slice(0, 5)) {
    const pid = promoIds.get(p.code)
    if (!pid) continue
    for (const person of PEOPLE.slice(0, 4)) {
      const exists = await db
        .select({ id: promoRedemptions.id })
        .from(promoRedemptions)
        .where(and(eq(promoRedemptions.promoCodeId, pid), eq(promoRedemptions.customerUserId, person.id)))
        .limit(1)
      if (exists.length > 0) continue
      const [txn] = await db
        .insert(walletTransactions)
        .values({ userId: person.id, balanceType: 'switchback_credit', amount: p.credit, source: 'promo', referenceId: pid, expiresAt: ahead(365) })
        .returning({ id: walletTransactions.id })
      await db.insert(promoRedemptions).values({ promoCodeId: pid, customerUserId: person.id, walletTransactionId: txn.id })
      await db.update(promoCodes).set({ currentUses: sql`${promoCodes.currentUses} + 1` }).where(eq(promoCodes.id, pid))
    }
  }

  // ── 14. Commission + pricing tiers — SCOPE-LOCKED to catalog experiences ──
  // Empty applies-to-experiences would mean "all" and hijack money-path
  // snapshots (ADR-0008). Every tier targets ONLY catalog experience IDs.
  const waterCatalogIds = catalog.filter((c) => ['rafting', 'scuba-diving', 'kayaking'].includes(c.activitySlug)).map((c) => c.id)
  // Tier names must be slugs (CHECK commission_tier_name_slug: ^[a-z0-9_-]+$).
  const COMMISSION_TIERS: Array<{ name: string; rate: string; reason: string; exps: string[]; from: Date; to: Date }> = [
    { name: 'catalog-seasonal-review', rate: '18.00', reason: 'Demo seasonal commission review (catalog only).', exps: catalogIds.slice(0, 8), from: ago(60), to: ahead(305) },
    { name: 'diwali-festival-2026-catalog', rate: '15.00', reason: 'Reduced festival-season commission (catalog only).', exps: catalogIds.slice(8, 16), from: new Date('2026-10-15T00:00:00Z'), to: new Date('2026-11-15T23:59:59Z') },
    { name: 'water-sports-monsoon-boost-catalog', rate: '12.00', reason: 'Seasonal incentive for catalog water activities.', exps: waterCatalogIds, from: ago(0), to: ahead(90) },
  ]
  for (const c of COMMISSION_TIERS) {
    if (c.exps.length === 0) continue
    const exists = await db.select({ id: commissionTiers.id }).from(commissionTiers).where(eq(commissionTiers.name, c.name)).limit(1)
    if (exists.length > 0) continue
    await db.insert(commissionTiers).values({
      name: c.name,
      startAt: c.from,
      endAt: c.to,
      appliesToCategories: [],
      appliesToVendorIds: [],
      appliesToExperienceIds: c.exps,
      rateOverride: c.rate,
      reason: c.reason,
      createdByAdminUserId: ADMIN_ID,
    })
  }
  const PRICING_TIERS: Array<{ name: string; price: string; reason: string; exps: string[]; from: Date; to: Date }> = [
    { name: 'peak-season-catalog-surcharge', price: '2500.00', reason: 'Holiday-week surcharge (catalog only).', exps: catalogIds.slice(0, 4), from: ago(0), to: ahead(60) },
    { name: 'off-peak-catalog-discount', price: '6500.00', reason: 'Shoulder-season discount (catalog only).', exps: catalogIds.slice(16, 20), from: ago(0), to: ahead(120) },
  ]
  for (const pt of PRICING_TIERS) {
    if (pt.exps.length === 0) continue
    const exists = await db.select({ id: pricingTiers.id }).from(pricingTiers).where(eq(pricingTiers.name, pt.name)).limit(1)
    if (exists.length > 0) continue
    await db.insert(pricingTiers).values({
      name: pt.name,
      startAt: pt.from,
      endAt: pt.to,
      appliesToCategories: [],
      appliesToVendorIds: [],
      appliesToExperienceIds: pt.exps,
      pricePerPersonOverride: pt.price,
      reason: pt.reason,
      createdByAdminUserId: ADMIN_ID,
    })
  }

  // ── 15. Region closures — ONLY catalog-only regions (never E2E regions) ───
  const CLOSURES: Array<{ region: string; reason: string; source: 'admin' | 'vendor'; from: Date; to: Date }> = [
    { region: 'auli', reason: 'Slope grooming and chairlift maintenance.', source: 'vendor', from: ahead(10), to: ahead(24) },
    { region: 'spiti', reason: 'Roads closed — heavy snow, district advisory.', source: 'admin', from: new Date('2026-12-20T00:00:00Z'), to: new Date('2027-03-15T23:59:59Z') },
    { region: 'leh-ladakh', reason: 'Winter pass closure — Khardung La inaccessible.', source: 'admin', from: new Date('2026-11-01T00:00:00Z'), to: new Date('2027-04-30T23:59:59Z') },
    { region: 'lonavala', reason: 'Monsoon — waterfall rappelling paused for high water.', source: 'admin', from: new Date('2026-07-20T00:00:00Z'), to: new Date('2026-08-10T23:59:59Z') },
    { region: 'andaman', reason: 'Dive season closed — SW monsoon swell.', source: 'admin', from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-09-15T23:59:59Z') },
  ]
  for (const c of CLOSURES) {
    if (E2E_REGIONS.has(c.region)) continue // defensive guard
    const exists = await db
      .select({ id: regionClosures.id })
      .from(regionClosures)
      .where(and(eq(regionClosures.regionSlug, c.region), eq(regionClosures.reason, c.reason)))
      .limit(1)
    if (exists.length > 0) continue
    await db.insert(regionClosures).values({ regionSlug: c.region, startAt: c.from, endAt: c.to, reason: c.reason, source: c.source })
  }

  // ── 16. Availability patterns — catalog experiences ONLY ──────────────────
  for (const exp of catalog.slice(0, 12)) {
    const exists = await db.select({ id: availabilityPatterns.id }).from(availabilityPatterns).where(eq(availabilityPatterns.experienceId, exp.id)).limit(1)
    if (exists.length > 0) continue
    await db.insert(availabilityPatterns).values([
      { experienceId: exp.id, dayOfWeek: 6, startTime: '06:00', endTime: '09:00', capacity: 12 },
      { experienceId: exp.id, dayOfWeek: 0, startTime: '06:00', endTime: '09:00', capacity: 12 },
      { experienceId: exp.id, dayOfWeek: 3, startTime: '07:00', endTime: '10:00', capacity: 8 },
    ])
  }

  // ── 17. Wallet across catalog customers (both buckets) + ledger variety ───
  const walletPlan: Array<{ user: string; credit: number; refund: number }> = [
    { user: PEOPLE[0].id, credit: 1500, refund: 2400 },
    { user: PEOPLE[1].id, credit: 800, refund: 0 },
    { user: PEOPLE[2].id, credit: 0, refund: 1800 },
    { user: PEOPLE[3].id, credit: 500, refund: 600 },
    { user: PEOPLE[4].id, credit: 1200, refund: 0 },
    { user: PEOPLE[5].id, credit: 0, refund: 900 },
  ]
  for (const w of walletPlan) {
    for (const [bucket, amount] of [['switchback_credit', w.credit] as const, ['refund_balance', w.refund] as const]) {
      if (amount <= 0) continue
      const balRes = await db
        .insert(walletBalances)
        .values({ userId: w.user, balanceType: bucket, amount: amount.toFixed(2) })
        .onConflictDoNothing()
        .returning({ userId: walletBalances.userId })
      if (balRes.length > 0) {
        await db.insert(walletTransactions).values({
          userId: w.user,
          balanceType: bucket,
          amount: amount.toFixed(2),
          source: bucket === 'refund_balance' ? 'refund' : 'promo',
          referenceId: bucket === 'refund_balance' ? 'catalog-refund-credit' : 'catalog-promo-grant',
          ...(bucket === 'switchback_credit' ? { expiresAt: ahead(365) } : {}),
        })
      }
    }
  }

  // ── 18. Conversations + messages (catalog vendors <-> catalog customers) ──
  const CONVS: Array<{ id: string; vendor: string; customer: string; subject: string; status: 'active' | 'archived'; msgs: Array<{ from: 'v' | 'c'; body: string }> }> = [
    { id: ns('conv', 1), vendor: CATALOG_VENDORS[0].userId, customer: PEOPLE[0].id, subject: 'Question about gear sizing', status: 'active', msgs: [{ from: 'c', body: 'Do you have wetsuits for kids aged 10?' }, { from: 'v', body: 'Yes! We carry XS through XXL including child sizes. See you on the water.' }] },
    { id: ns('conv', 2), vendor: CATALOG_VENDORS[1].userId, customer: PEOPLE[1].id, subject: 'Trek difficulty check', status: 'active', msgs: [{ from: 'c', body: 'Is the Beas Kund trek suitable for a first-timer?' }, { from: 'v', body: 'It is moderate — with basic fitness you will be fine. We brief fully on day 1.' }, { from: 'c', body: 'Perfect, booking now!' }] },
    { id: ns('conv', 3), vendor: CATALOG_VENDORS[2].userId, customer: PEOPLE[2].id, subject: 'Best flight window', status: 'active', msgs: [{ from: 'c', body: 'What time gives the best thermals for a tandem?' }, { from: 'v', body: 'Late morning, around 10:30–12:00, is the sweet spot.' }] },
  ]
  for (const c of CONVS) {
    const exists = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, c.id)).limit(1)
    if (exists.length > 0) continue
    await db.insert(conversations).values({ id: c.id, vendorUserId: c.vendor, customerUserId: c.customer, subject: c.subject, status: c.status })
    for (let mi = 0; mi < c.msgs.length; mi++) {
      const m = c.msgs[mi]
      await db.insert(messages).values({ conversationId: c.id, senderUserId: m.from === 'v' ? c.vendor : c.customer, body: m.body, readAt: mi === 0 ? new Date() : null, createdAt: ago(c.msgs.length - mi, 'hours') })
    }
  }

  // ── 19. Archive published admin-fixtures so they leave public surfaces ────
  await db
    .update(experiences)
    .set({ status: 'archived' })
    .where(and(inArray(experiences.slug, FIXTURE_SLUGS), sql`${experiences.status} <> 'archived'`))

  // ── 20. Admin-queue variety: multi-state refunds + moderated reviews ──────
  // The admin refund queue + review-moderation surfaces looked empty/uniform on
  // a fresh DB (refunds only "Pending", reviews all "Visible"). Seed a handful
  // of NON-pending refund_requests and a couple of flagged/removed reviews so
  // those queues demonstrate their filters.
  //
  // ISOLATION (CRITICAL): the #24 admin refund-queue E2E sweeps every PENDING
  // refund_request, so the demo variety uses ONLY terminal, non-pending states
  // (credited / rejected) — never `pending`. All refunds + moderated reviews
  // attach to CATALOG bookings (u_cat_* experiences), never a seed fixture, and
  // the moderated reviews ride on dedicated cancelled_post_experience bookings
  // (excluded from demand counts + the published-only badge math) so they never
  // disturb the hero badge assertions or the #27 review-moderation fixture.

  // 20a. Multi-state refund_requests on two dedicated completed catalog bookings.
  const refundTargets = catalog.slice(20, 22)
  const REFUND_VARIETY: Array<{
    state: 'credited' | 'rejected'
    reason: 'inside_policy_cancellation' | 'outside_policy_dispute_resolved'
    basis: string
    amount: string
  }> = [
    { state: 'credited', reason: 'inside_policy_cancellation', basis: 'free_window', amount: '2400.00' },
    { state: 'rejected', reason: 'outside_policy_dispute_resolved', basis: 'no_refund_window', amount: '0.00' },
  ]
  for (let ri = 0; ri < refundTargets.length && ri < REFUND_VARIETY.length; ri++) {
    const exp = refundTargets[ri]
    const slotId = slotForExp.get(exp.id)
    if (!slotId) continue
    const rv = REFUND_VARIETY[ri]
    const person = PEOPLE[ri % PEOPLE.length]
    const bId = ns('refbk', ri)
    const exists = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bId)).limit(1)
    if (exists.length === 0) {
      const gross = Math.round(Number(exp.price12) * 2)
      await db.insert(bookings).values({
        id: bId,
        customerUserId: person.id,
        experienceId: exp.id,
        slotId,
        participantCount: 2,
        // cancelled_post_experience keeps these OUT of the demand-booking count
        // (card-badges) so the hero/top-rated math is untouched.
        state: 'cancelled_post_experience',
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
        payoutState: 'held',
        confirmedAt: ago(50),
        completedAt: ago(30),
        cancelledAt: ago(28),
        cancellationReason: 'Post-experience refund (demo).',
      })
    }
    const refExists = await db
      .select({ id: refundRequests.id })
      .from(refundRequests)
      .where(eq(refundRequests.bookingId, bId))
      .limit(1)
    if (refExists.length === 0) {
      await db.insert(refundRequests).values({
        bookingId: bId,
        requestedByUserId: person.id,
        reason: rv.reason,
        destination: 'refund_balance',
        // Non-pending terminal state — invisible to the #24 pending queue sweep.
        state: rv.state,
        amount: rv.amount,
        cancellationPresetSnapshot: exp.preset,
        policyWindowBasisSnapshot: rv.basis,
      })
    }
  }

  // 20b. Moderated reviews (flagged + removed) on dedicated catalog bookings so
  // the admin review-moderation queue demonstrates its status filters. These
  // are NOT `published`, so loadExperienceRatingMap (published-only) ignores
  // them and the hero/top-rated badge assertions stay intact.
  const moderationReviewTargets = catalog.slice(22, 24)
  const MODERATED_REVIEWS: Array<{
    status: 'flagged' | 'removed'
    rating: number
    title: string
    body: string
  }> = [
    {
      status: 'flagged',
      rating: 2,
      title: 'Felt rushed and overcrowded',
      body: 'Reported for review — the group size seemed larger than advertised and the safety brief was hurried. Awaiting moderation.',
    },
    {
      status: 'removed',
      rating: 1,
      title: 'Off-topic promotional content',
      body: 'This review was removed by moderation for containing spam / an external promotional link.',
    },
  ]
  for (let mi = 0; mi < moderationReviewTargets.length && mi < MODERATED_REVIEWS.length; mi++) {
    const exp = moderationReviewTargets[mi]
    const slotId = slotForExp.get(exp.id)
    if (!slotId) continue
    const mr = MODERATED_REVIEWS[mi]
    const person = PEOPLE[(mi + 3) % PEOPLE.length]
    const bId = ns('modrev', mi)
    const exists = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bId)).limit(1)
    if (exists.length === 0) {
      const gross = Math.round(Number(exp.price12) * 2)
      await db.insert(bookings).values({
        id: bId,
        customerUserId: person.id,
        experienceId: exp.id,
        slotId,
        participantCount: 2,
        state: 'cancelled_post_experience',
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
        payoutState: 'held',
        confirmedAt: ago(48),
        completedAt: ago(26),
        cancelledAt: ago(24),
        cancellationReason: 'Post-experience cancellation (demo).',
      })
    }
    const revExists = await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.bookingId, bId)).limit(1)
    if (revExists.length === 0) {
      await db.insert(reviews).values({
        bookingId: bId,
        customerUserId: person.id,
        experienceId: exp.id,
        vendorUserId: exp.vendorUserId,
        rating: mr.rating,
        title: mr.title,
        body: mr.body,
        status: mr.status,
        createdAt: ago(20 - mi),
      })
    }
  }
}

/**
 * Public entrypoint — call at the end of `db/seed.ts` (after the core fixtures)
 * to layer the realistic, image-rich, isolation-safe catalog.
 */
export async function seedCatalog(db: SeedDb): Promise<void> {
  await main(db)
}
