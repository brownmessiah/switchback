/**
 * Curated, on-subject stock-photo pools for adventure activities + regions.
 *
 * The activity pools below were each VISUALLY VERIFIED (downloaded + eyeballed)
 * to actually depict the activity — a previous hand-typed set had silently
 * mis-tagged IDs (e.g. "paragliding" pointed at a jigsaw puzzle). Every pool has
 * 6 distinct landscape photos so a listing can show a varied gallery and two
 * same-activity listings never share a cover (see `db/seed-photos.ts`).
 *
 * IDs are the Unsplash path segment only (`photo-…`); `px()` builds the URL.
 */

/** Build an Unsplash delivery URL from a `photo-…` path-segment id. */
const px = (id: string, w = 800, h = 600): string =>
  `https://images.unsplash.com/${id}?w=${w}&h=${h}&fit=crop&q=80`

/**
 * Verified per-activity photo pools, keyed by the canonical activity-registry
 * slug (`lib/activities/registry.ts`). Short aliases (`scuba`, `bungee`) point
 * at the same arrays so legacy callers keep working.
 */
const ACTIVITY_PHOTO_IDS: Record<string, string[]> = {
  rafting: [
    'photo-1512675628397-28288d1220ef',
    'photo-1593107757644-25f0b23e9297',
    'photo-1595637729374-631ef9c4da10',
    'photo-1624646580989-9f059e25eb78',
    'photo-1629248457649-b082812aea6c',
    'photo-1690905765810-665a1e6f294f',
  ],
  paragliding: [
    'photo-1418846531910-2b7bb1043512',
    'photo-1546779175-a70fdbd4481d',
    'photo-1500953925139-9d5fe7ba54f2',
    'photo-1719949122509-74d0a1d08b44',
    'photo-1573507712396-586c2fc99b36',
    'photo-1551891590-eeac39130199',
  ],
  'scuba-diving': [
    'photo-1759414478236-292c50016d7f',
    'photo-1544551763-46a013bb70d5',
    'photo-1544551763-8dd44758c2dd',
    'photo-1583212292454-1fe6229603b7',
    'photo-1586508577428-120d6b072945',
    'photo-1595323397978-65433d24fc23',
  ],
  trekking: [
    'photo-1526772662000-3f88f10405ff',
    'photo-1551632811-561732d1e306',
    'photo-1598524589996-78edc8ddba2e',
    'photo-1629185752152-fe65698ddee4',
    'photo-1568454537842-d933259bb258',
    'photo-1458442310124-dde6edb43d10',
  ],
  'bungee-jumping': [
    'photo-1549221360-456a9c197d5b',
    'photo-1559677624-3c956f10d431',
    'photo-1564797663359-624328971f55',
    'photo-1576599372775-95a24ce93abc',
    'photo-1595778039451-58a7c2946e7d',
    'photo-1609750186885-453cb10e58fb',
  ],
  skiing: [
    'photo-1507534192483-69914c0692d7',
    'photo-1551698618-1dfe5d97d256',
    'photo-1528659862616-22886eb53642',
    'photo-1605540436563-5bca919ae766',
    'photo-1614358606268-aa86853578b4',
    'photo-1664436341001-b02974ae7524',
  ],
  kayaking: [
    'photo-1450500392544-c2cb0fd6e3b8',
    'photo-1480480565647-1c4385c7c0bf',
    'photo-1558281050-4c33200099c7',
    'photo-1588472235276-7638965471e2',
    'photo-1653593548856-23fdff295e2d',
    'photo-1709657179878-5c3e732a7832',
  ],
  'rock-climbing': [
    'photo-1522163182402-834f871fd851',
    'photo-1586627161720-ee2849303aee',
    'photo-1597698063932-9450882bb1be',
    'photo-1601025678763-e8f5835995db',
    'photo-1601224748193-d24f166b5c77',
    'photo-1602531734042-c565f8365a0b',
  ],
  safari: [
    'photo-1498038116800-4159eb9b2a62',
    'photo-1516426122078-c23e76319801',
    'photo-1521651201144-634f700b36ef',
    'photo-1527073620320-77635188c627',
    'photo-1577971132997-c10be9372519',
    'photo-1709402606682-400133d92ab2',
  ],
  camping: [
    'photo-1475483768296-6163e08872a1',
    'photo-1478131143081-80f7f84ca84d',
    'photo-1504280390367-361c6d9f38f4',
    'photo-1510312305653-8ed496efae75',
    'photo-1532339142463-fd0a8979791a',
    'photo-1537905569824-f89f14cceb68',
  ],
}

// Short aliases used by some callers / older data.
ACTIVITY_PHOTO_IDS.scuba = ACTIVITY_PHOTO_IDS['scuba-diving']
ACTIVITY_PHOTO_IDS.bungee = ACTIVITY_PHOTO_IDS['bungee-jumping']

/** Generic mountain-landscape pool for activities without a curated set. */
const FALLBACK_PHOTO_IDS = ACTIVITY_PHOTO_IDS.trekking

/**
 * The curated photo-ID pool for an activity (path segments, not URLs). Falls
 * back to a generic landscape pool for unknown slugs. Used by the seeds
 * (`db/seed-photos.ts`) to build per-listing galleries via Unsplash URLs.
 */
export function getActivityPhotoIds(activitySlug: string): string[] {
  return ACTIVITY_PHOTO_IDS[activitySlug] ?? FALLBACK_PHOTO_IDS
}

/**
 * The fallback image URL for an activity. Backward-compatible: called with no
 * `variant` it returns the first (canonical) photo. An optional `variant` index
 * rotates through the curated pool so adjacent cards / gallery tiles vary
 * instead of repeating one photo.
 */
export function getActivityImage(activitySlug: string, variant = 0): string {
  const pool = getActivityPhotoIds(activitySlug)
  const id = pool[((variant % pool.length) + pool.length) % pool.length]
  return px(id)
}

const REGION_IMAGES: Record<string, string> = {
  rishikesh:
    'https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=800&h=600&fit=crop&q=80',
  manali:
    'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?w=800&h=600&fit=crop&q=80',
  'bir-billing':
    'https://images.unsplash.com/photo-1546779175-a70fdbd4481d?w=800&h=600&fit=crop&q=80',
  goa:
    'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=800&h=600&fit=crop&q=80',
  ladakh:
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=600&fit=crop&q=80',
  // Canonical region-registry slugs (lib/regions/registry.ts).
  'leh-ladakh':
    'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800&h=600&fit=crop&q=80',
  kasol:
    'https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=800&h=600&fit=crop&q=80',
  spiti:
    'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800&h=600&fit=crop&q=80',
  lonavala:
    'https://images.unsplash.com/photo-1604537466158-719b1972feb8?w=800&h=600&fit=crop&q=80',
  auli:
    'https://images.unsplash.com/photo-1551524559-8af4e6624178?w=800&h=600&fit=crop&q=80',
  sikkim:
    'https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=800&h=600&fit=crop&q=80',
  kerala:
    'https://images.unsplash.com/photo-1602216056096-3b40cc0c9944?w=800&h=600&fit=crop&q=80',
  meghalaya:
    'https://images.unsplash.com/photo-1593693397690-362cb9666fc2?w=800&h=600&fit=crop&q=80',
  andaman:
    'https://images.unsplash.com/photo-1559494007-9f5847c49d94?w=800&h=600&fit=crop&q=80',
  coorg:
    'https://images.unsplash.com/photo-1605640840605-14ac1855827b?w=800&h=600&fit=crop&q=80',
}

/**
 * Auto-rotating homepage hero pool (home-redesign issue 04). The FIRST id is
 * the long-standing hero photo — it stays the preloaded LCP frame; rotation
 * through the rest starts client-side after mount (components/home/
 * hero-rotator.tsx). Every other id is drawn from the VISUALLY VERIFIED
 * activity pools above (rafting / paragliding / trekking / scuba), so the
 * hero can never regress to off-subject stock. Imagery is decorative: generic
 * adventure scenes under a heavy scrim, never tied to a specific listing.
 */
const HERO_PHOTO_IDS = [
  'photo-1530866495561-507c9faab2ed', // canonical hero (mountain scene) — LCP
  'photo-1512675628397-28288d1220ef', // rafting
  'photo-1546779175-a70fdbd4481d', // paragliding
  'photo-1526772662000-3f88f10405ff', // trekking
  'photo-1583212292454-1fe6229603b7', // scuba
]

export function getRegionImage(regionSlug: string): string {
  return REGION_IMAGES[regionSlug] ?? REGION_IMAGES.rishikesh
}

/** The full rotating hero pool as delivery URLs (1600×900 hero crop). */
export function getHeroImages(): string[] {
  return HERO_PHOTO_IDS.map((id) => px(id, 1600, 900))
}

/** The first (LCP/preload) hero frame — always `getHeroImages()[0]`. */
export function getHeroImage(): string {
  return getHeroImages()[0]
}
