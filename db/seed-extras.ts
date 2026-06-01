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

import {
  availabilityPatterns,
  availabilitySlots,
  bookings,
  blogPosts,
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

/** Published admin-fixture experiences that must leave public surfaces. */
const FIXTURE_SLUGS = [
  'refund-queue-fixture-rishikesh',
  'payout-queue-fixture-bir-billing',
  'payout-gate-fixture-bir-billing',
  'commission-scope-fixture-bir-billing',
]

/** Regions used by E2E booking flows — never seed closures here. */
const E2E_REGIONS = new Set(['rishikesh', 'manali', 'bir-billing', 'goa'])

// ── Curated, HTTP-200-verified Unsplash photo IDs grouped by activity ───────
const IMG = (id: string, w = 1200): string =>
  `https://images.unsplash.com/${id}?w=${w}&q=80&auto=format&fit=crop`

const ACTIVITY_PHOTOS: Record<string, string[]> = {
  rafting: ['photo-1530866495561-507c9faab2ed', 'photo-1599494284091-2b6f5b6c7e2c', 'photo-1604537466158-719b1972feb8'],
  trekking: ['photo-1551632811-561732d1e306', 'photo-1454496522488-7a8e488e8606', 'photo-1469474968028-56623f02e42e', 'photo-1486870591958-9b9d0d1dda99', 'photo-1508739773434-c26b3d09e071'],
  paragliding: ['photo-1597400473366-371a80b251eb', 'photo-1504280390367-361c6d9f38f4', 'photo-1502082553048-f009c37129b9'],
  'scuba-diving': ['photo-1583364512105-951b6f7080ae', 'photo-1544551763-46a013bb70d5', 'photo-1582967788606-a171c1080cb0', 'photo-1530053969600-caed2596d242'],
  skiing: ['photo-1551524559-8af4e6624178', 'photo-1483721310020-03333e577078', 'photo-1551698618-1dfe5d97d256'],
  'bungee-jumping': ['photo-1567604528969-2f9ffd981816', 'photo-1564769662533-4f00a87b4056', 'photo-1533227268428-f9ed0900fb3b'],
  camping: ['photo-1504280390367-361c6d9f38f4', 'photo-1537565266759-34bbc16be345', 'photo-1504851149312-7a075b496cc7', 'photo-1496545672447-f699b503d270'],
  kayaking: ['photo-1472745942893-4b9f730c7668', 'photo-1604537466158-719b1972feb8', 'photo-1545153996-e01b1e29c8a8'],
  safari: ['photo-1516426122078-c23e76319801', 'photo-1549366021-9f761d450615', 'photo-1547970810-dc1eac37d174', 'photo-1534177616072-ef7dc120449d'],
  'rock-climbing': ['photo-1522163182402-834f871fd851', 'photo-1516592673884-4a382d1124c2', 'photo-1518609878373-06d740f60d8b'],
}
const FALLBACK_PHOTOS = ['photo-1506905925346-21bda4d32df4', 'photo-1470071459604-3b5ec3a7fe05', 'photo-1426604966848-d7adac402bff', 'photo-1501785888041-af3ef285b470']
const AVATAR_PHOTOS = ['photo-1500648767791-00dcc994a43e', 'photo-1494790108377-be9c29b29330', 'photo-1507003211169-0a1dd7228f2d', 'photo-1438761681033-6461ffad8d80', 'photo-1472099645785-5658abf4ff4e', 'photo-1544005313-94ddf0286df2', 'photo-1633332755192-727a05c4013d', 'photo-1607746882042-944635dfe10e']
const VENDOR_LOGO_PHOTOS = ['photo-1557804506-669a67965ba0', 'photo-1487058792275-0ad4aaf24ca7']
const BLOG_COVER_PHOTOS = ['photo-1530866495561-507c9faab2ed', 'photo-1551632811-561732d1e306', 'photo-1597400473366-371a80b251eb', 'photo-1583364512105-951b6f7080ae', 'photo-1516426122078-c23e76319801', 'photo-1551524559-8af4e6624178', 'photo-1504280390367-361c6d9f38f4', 'photo-1522163182402-834f871fd851', 'photo-1506905925346-21bda4d32df4', 'photo-1470071459604-3b5ec3a7fe05']

/** Up to 6 distinct photo IDs for an activity, padded with fallbacks. */
function photosFor(activitySlug: string): string[] {
  const pool = [...(ACTIVITY_PHOTOS[activitySlug] ?? FALLBACK_PHOTOS), ...FALLBACK_PHOTOS, ...AVATAR_PHOTOS]
  const out: string[] = []
  for (const p of pool) {
    if (!out.includes(p)) out.push(p)
    if (out.length >= 6) break
  }
  return out
}

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
  { userId: 'u_cat_apex', email: 'catalog+apex@seed.outvers.dev', businessName: 'Apex River Co.', slug: 'apex-river-co', pan: 'AAACA1111A', vpa: 'apexriver@upi' },
  { userId: 'u_cat_summit', email: 'catalog+summit@seed.outvers.dev', businessName: 'Summit Seekers Himalaya', slug: 'summit-seekers-himalaya', pan: 'AAACS2222B', vpa: 'summitseekers@upi' },
  { userId: 'u_cat_cloud', email: 'catalog+cloud@seed.outvers.dev', businessName: 'Cloudbase Paragliding', slug: 'cloudbase-paragliding', pan: 'AAACC3333C', vpa: 'cloudbase@upi' },
  { userId: 'u_cat_coral', email: 'catalog+coral@seed.outvers.dev', businessName: 'Coral Coast Divers', slug: 'coral-coast-divers', pan: 'AAACR4444D', vpa: 'coralcoast@upi' },
  { userId: 'u_cat_ladakh', email: 'catalog+ladakh@seed.outvers.dev', businessName: 'Ladakh Explorers', slug: 'ladakh-explorers', pan: 'AAACL5555E', vpa: 'ladakhexp@upi' },
  { userId: 'u_cat_sahyadri', email: 'catalog+sahyadri@seed.outvers.dev', businessName: 'Sahyadri Outdoors', slug: 'sahyadri-outdoors', pan: 'AAACH6666F', vpa: 'sahyadri@upi' },
  { userId: 'u_cat_parvati', email: 'catalog+parvati@seed.outvers.dev', businessName: 'Parvati Valley Treks', slug: 'parvati-valley-treks', pan: 'AAACP7777G', vpa: 'parvatitreks@upi' },
  { userId: 'u_cat_island', email: 'catalog+island@seed.outvers.dev', businessName: 'Island Paddle Co.', slug: 'island-paddle-co', pan: 'AAACI8888H', vpa: 'islandpaddle@upi' },
]

// ── Catalog experiences (region-prefixed slugs, controlled vocab) ───────────
type Preset = 'flexible' | 'moderate' | 'strict'
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
  { vendor: 'u_cat_ladakh', slug: 'leh-ladakh-trekking-markha-valley-6d', title: 'Markha Valley Trek — 6 Days, Homestay Route', short: 'A 6-day Ladakh classic crossing Kongmaru La (5,260 m) with village homestays and two river fords. Permits included.', long: 'The Markha Valley trek threads Hemis National Park past Buddhist gompas and Gaddi homestays, crossing Kongmaru La at 5,260 m on the final day. Six days, full acclimatisation built in, homestay + camp mix. Includes guide, meals, permits and stock animals for kit. Jun–Sep.', region: 'leh-ladakh', activity: 'trekking', p12: '21500.00', p35: '19500.00', p6: '17500.00', preset: 'strict', permits: ['Inner Line Permit'] },
  { vendor: 'u_cat_ladakh', slug: 'leh-ladakh-rafting-zanskar-grade-iv', title: 'Zanskar Grade IV Rafting — Chilling to Nimu', short: 'A big-water 26 km Grade III–IV run through the Zanskar gorge to the Indus confluence. Dry-suits, expedition guides.', long: 'Raft the dramatic Zanskar gorge from Chilling to the Indus confluence at Nimu — towering walls, Grade III–IV rapids and glacial water. Dry-suits, expedition rafts and IRF-certified guides provided. Strong swimmers, ages 16+. Jul–Aug only.', region: 'leh-ladakh', activity: 'rafting', p12: '4500.00', p35: '4100.00', p6: '3700.00', preset: 'strict', permits: ['Inner Line Permit'] },
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

// Real customer names for review authors + booking/wallet spread.
const PEOPLE: Array<{ id: string; name: string; email: string }> = [
  { id: 'u_enr_cust_aanya', name: 'Aanya Kapoor', email: 'enrich+aanya@seed.outvers.dev' },
  { id: 'u_enr_cust_rohan', name: 'Rohan Mehta', email: 'enrich+rohan@seed.outvers.dev' },
  { id: 'u_enr_cust_ishaan', name: 'Ishaan Verma', email: 'enrich+ishaan@seed.outvers.dev' },
  { id: 'u_enr_cust_diya', name: 'Diya Nair', email: 'enrich+diya@seed.outvers.dev' },
  { id: 'u_enr_cust_kabir', name: 'Kabir Singh', email: 'enrich+kabir@seed.outvers.dev' },
  { id: 'u_enr_cust_meera', name: 'Meera Iyer', email: 'enrich+meera@seed.outvers.dev' },
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
  { rating: 2, title: 'Weather cut it short', body: 'Not the operators fault, but the session ended early due to conditions. They handled the refund fairly though.', resp: 'Sorry the weather turned — your refund was processed to your Outvers wallet the same day.' },
  { rating: 5, title: 'Incredible guides', body: 'Knowledgeable, funny, and patient. They made the whole thing memorable for our group of six.' },
  { rating: 4, title: 'Smooth from start to finish', body: 'Clear instructions, good gear, fair price. Checkout was quick and the confirmation was instant.' },
  { rating: 5, title: 'Highly recommend', body: 'Already planning to come back with friends. The transparent pricing and verified badge sealed it for us.' },
  { rating: 3, title: 'Decent value', body: 'Solid experience for the price. Equipment was a touch worn but everything worked and felt safe.' },
  { rating: 5, title: 'Five stars, no notes', body: 'Punctual, professional, and genuinely thrilling. The kind of trip you talk about for months.' },
  { rating: 4, title: 'Loved it', body: 'Great instructors and a gorgeous setting. Would book through Outvers again in a heartbeat.', resp: 'Means a lot — thank you for choosing us!' },
]

const BLOG: Array<{ slug: string; title: string; category: string; excerpt: string }> = [
  { slug: 'rishikesh-rafting-grades-explained', title: 'Rishikesh Rafting Grades, Explained (I–V)', category: 'guides', excerpt: 'What the Grade III+ on your booking actually means — and which stretch of the Ganga is right for first-timers.' },
  { slug: 'best-time-bir-billing-paragliding', title: 'The Best Time to Fly Bir-Billing', category: 'destinations', excerpt: 'Thermals, monsoon windows, and the two paragliding seasons that make Bir the world’s second-best flying site.' },
  { slug: 'first-scuba-dive-india-checklist', title: 'Your First Scuba Dive in India: A Checklist', category: 'tips', excerpt: 'From cert cards to ear-equalising — everything to know before a Discover-Scuba dive in Goa or the Andamans.' },
  { slug: 'packing-for-a-himalayan-trek', title: 'Packing for a Himalayan Trek (Without Overpacking)', category: 'tips', excerpt: 'The layering system, the footwear test, and the five items trekkers always forget.' },
  { slug: 'how-outvers-verifies-vendors', title: 'How Outvers Verifies Every Vendor', category: 'culture', excerpt: 'Inside the three-tier KYC ladder — phone, identity, and business — and why it makes booking safer.' },
  { slug: 'monsoon-adventures-in-the-sahyadris', title: 'Monsoon Adventures in the Sahyadris', category: 'adventure', excerpt: 'Waterfall rappelling, valley crossings, and the green-season magic of Lonavala and the Western Ghats.' },
  { slug: 'understanding-free-cancellation', title: 'Understanding Free Cancellation & Refunds', category: 'guides', excerpt: 'Flexible vs moderate vs strict — how our cancellation presets work and when you get a full refund.' },
  { slug: 'leh-ladakh-acclimatisation-guide', title: 'Leh-Ladakh: An Acclimatisation Guide', category: 'destinations', excerpt: 'Altitude is the real challenge in Ladakh. Here is how to arrive, rest, and ramp up safely before a high pass.' },
  { slug: 'snow-leopard-spotting-spiti', title: 'Snow-Leopard Spotting in Spiti', category: 'adventure', excerpt: 'Why winter in Kibber is the world’s best chance to see the ghost of the mountains — with local spotters.' },
  { slug: 'beginner-skiing-solang-vs-auli', title: 'Beginner Skiing: Solang vs Auli', category: 'guides', excerpt: 'Two of India’s best learner slopes compared — lifts, lessons, season length, and total cost.' },
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
  for (const v of CATALOG_VENDORS) {
    await db
      .insert(vendorProfiles)
      .values({
        userId: v.userId,
        businessName: v.businessName,
        slug: v.slug,
        kycTier: 'business',
        pan: v.pan,
        payoutMethod: 'upi',
        payoutDestination: { vpa: v.vpa },
        about:
          'A KYC-verified Outvers operator running certified, safety-first adventures with experienced local guides. Small groups, transparent pricing, free cancellation within policy.',
      })
      .onConflictDoNothing()
  }

  // ── 2. Catalog experiences (published) ────────────────────────────────────
  await db
    .insert(experiences)
    .values(
      CATALOG_EXPERIENCES.map((e) => ({
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
        regionSlug: e.region,
        activitySlug: e.activity,
        status: 'published' as const,
      })),
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

  // ── 4. media_assets — 6 per catalog experience + vendor logo/cover ────────
  // Re-runnable: clear only catalog-owned rows (storage_key prefix) first.
  await db.delete(mediaAssets).where(sql`${mediaAssets.storageKey} LIKE 'seed/catalog/%'`)
  for (const exp of catalog) {
    const photos = photosFor(exp.activitySlug)
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

  // ── 8. payments for catalog confirmed/completed bookings ──────────────────
  const payable = await db
    .select({ id: bookings.id, gross: bookings.grossTotalSnapshot })
    .from(bookings)
    .where(and(inArray(bookings.experienceId, catalogIds), inArray(bookings.state, ['confirmed', 'completed', 'awaiting_completion'])))
  for (const b of payable) {
    const has = await db.select({ id: payments.id }).from(payments).where(eq(payments.bookingId, b.id)).limit(1)
    if (has.length > 0) continue
    await db.insert(payments).values({
      bookingId: b.id,
      razorpayPaymentId: `pay_cat_${b.id}_full`,
      razorpayOrderId: `order_cat_${b.id}_full`,
      amount: Number(b.gross).toFixed(2),
      captureTrigger: 'booking_create',
      capturedAt: ago(30),
    })
  }

  // ── 9. Blog posts (>=6) with cover images + markdown body ─────────────────
  for (let i = 0; i < BLOG.length; i++) {
    const p = BLOG[i]
    const exists = await db.select({ id: blogPosts.id }).from(blogPosts).where(eq(blogPosts.slug, p.slug)).limit(1)
    if (exists.length > 0) continue
    const body = `# ${p.title}\n\n${p.excerpt}\n\n## Why it matters\n\nAdventure travel in India is booming, but the gap between a great day out and a disappointing one usually comes down to preparation and a trustworthy operator. Below we break it down.\n\n- **Safety first.** Every Outvers vendor is KYC-verified and carries the right permits.\n- **Transparent pricing.** What you see is what you pay — no surprise gear fees.\n- **Free cancellation.** Book early, change plans freely within policy.\n\n## The bottom line\n\nDo your homework, book a verified operator, and the rest takes care of itself. See you out there.`
    await db.insert(blogPosts).values({
      title: p.title,
      slug: p.slug,
      content: body,
      excerpt: p.excerpt,
      category: p.category,
      coverImageUrl: IMG(BLOG_COVER_PHOTOS[i % BLOG_COVER_PHOTOS.length], 1200),
      status: 'published',
      publishedAt: ago((i + 1) * 4),
      authorAdminId: ADMIN_ID,
    })
  }

  // ── 10. site_content — all 6 sections (admin CMS; not yet read publicly) ──
  const featuredIds = catalogIds.slice(0, 6)
  const SITE: Array<{ section: string; value: Record<string, unknown> }> = [
    { section: 'hero', value: { title: 'Find your next adventure', subtitle: 'KYC-verified vendors. Transparent pricing. Free cancellation.', ctaText: 'Explore experiences', ctaLink: '/search', backgroundImageUrl: IMG('photo-1530866495561-507c9faab2ed', 1600) } },
    { section: 'announcement_bar', value: { text: 'Monsoon season is here — waterfall rappelling now live in Lonavala', linkText: 'Browse', linkUrl: '/search?region=lonavala', enabled: true, backgroundColor: '#0f766e' } },
    { section: 'homepage', value: { featuredSectionTitle: 'Featured experiences', featuredExperienceIds: featuredIds, showCategories: true, showTestimonials: true } },
    { section: 'branding', value: { siteName: 'Outvers', primaryColor: '#0f766e', logoUrl: IMG('photo-1557804506-669a67965ba0', 256), faviconUrl: IMG('photo-1557804506-669a67965ba0', 64) } },
    { section: 'seo', value: { defaultTitle: 'Outvers — India adventure marketplace', titleTemplate: '%s · Outvers', defaultDescription: 'Book rafting, paragliding, scuba, trekking and more from KYC-verified Indian adventure operators.', ogImageUrl: IMG('photo-1530866495561-507c9faab2ed', 1200), robots: 'index,follow' } },
    { section: 'footer', value: { companyName: 'Outvers', copyrightText: '© 2026 Outvers. All rights reserved.', links: [{ label: 'Cancellation policy', url: '/cancellation-policy' }, { label: 'Search', url: '/search' }], socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/outvers' }] } },
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
    { id: ns('tkt', 1), subject: 'Refund not yet credited to wallet', status: 'in_progress', priority: 'high', category: 'cancellation', creator: PEOPLE[0].id, msgs: [{ from: PEOPLE[0].id, body: 'I cancelled within policy 3 days ago but the refund has not shown in my Outvers wallet yet.' }, { from: ADMIN_ID, body: 'Thanks for flagging — I have escalated this to our payments team and will update you within 24h.' }] },
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
        .values({ userId: person.id, balanceType: 'outvers_credit', amount: p.credit, source: 'promo', referenceId: pid, expiresAt: ahead(365) })
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
    for (const [bucket, amount] of [['outvers_credit', w.credit] as const, ['refund_balance', w.refund] as const]) {
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
          ...(bucket === 'outvers_credit' ? { expiresAt: ahead(365) } : {}),
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
}

/**
 * Public entrypoint — call at the end of `db/seed.ts` (after the core fixtures)
 * to layer the realistic, image-rich, isolation-safe catalog.
 */
export async function seedCatalog(db: SeedDb): Promise<void> {
  await main(db)
}
