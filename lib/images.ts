const ACTIVITY_IMAGES: Record<string, string> = {
  rafting:
    'https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=800&h=600&fit=crop&q=80',
  kayaking:
    'https://images.unsplash.com/photo-1472745942893-4b9f730c7668?w=800&h=600&fit=crop&q=80',
  trekking:
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=600&fit=crop&q=80',
  paragliding:
    'https://images.unsplash.com/photo-1597400473366-371a80b251eb?w=800&h=600&fit=crop&q=80',
  scuba:
    'https://images.unsplash.com/photo-1583364512105-951b6f7080ae?w=800&h=600&fit=crop&q=80',
  'scuba-diving':
    'https://images.unsplash.com/photo-1583364512105-951b6f7080ae?w=800&h=600&fit=crop&q=80',
  camping:
    'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=800&h=600&fit=crop&q=80',
  bungee:
    'https://images.unsplash.com/photo-1564769662533-4f00a87b4056?w=800&h=600&fit=crop&q=80',
  // Canonical activity-registry slug (lib/activities/registry.ts) — the map
  // previously only had the short alias `bungee`, so every bungee-jumping
  // Experience fell through to the trekking fallback (audit P0 fix).
  'bungee-jumping':
    'https://images.unsplash.com/photo-1564769662533-4f00a87b4056?w=800&h=600&fit=crop&q=80',
  skiing:
    'https://images.unsplash.com/photo-1551524559-8af4e6624178?w=800&h=600&fit=crop&q=80',
  // Registry slugs that were missing → distinct, subject-appropriate photos
  // instead of the generic trekking fallback (audit P0 fix).
  'rock-climbing':
    'https://images.unsplash.com/photo-1522163182402-834f871fd851?w=800&h=600&fit=crop&q=80',
  safari:
    'https://images.unsplash.com/photo-1516426122078-c23e76319801?w=800&h=600&fit=crop&q=80',
  surfing:
    'https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=800&h=600&fit=crop&q=80',
  canyoning:
    'https://images.unsplash.com/photo-1545558014-8692077e9b5c?w=800&h=600&fit=crop&q=80',
}

const REGION_IMAGES: Record<string, string> = {
  rishikesh:
    'https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=800&h=600&fit=crop&q=80',
  manali:
    'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?w=800&h=600&fit=crop&q=80',
  'bir-billing':
    'https://images.unsplash.com/photo-1597400473366-371a80b251eb?w=800&h=600&fit=crop&q=80',
  goa:
    'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=800&h=600&fit=crop&q=80',
  ladakh:
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=600&fit=crop&q=80',
  // Canonical region-registry slugs (lib/regions/registry.ts). The map only
  // had the alias `ladakh` + several regions that aren't in the registry, so
  // every leh-ladakh / kasol / spiti / lonavala / auli destination tile fell
  // through to the identical rishikesh fallback (audit P0 fix — restores
  // per-region visual variety for a fair design comparison).
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
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=600&fit=crop&q=80',
}

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=1600&h=900&fit=crop&q=80'

const px = (id: string): string =>
  `https://images.unsplash.com/${id}?w=800&h=600&fit=crop&q=80`

/**
 * Extra verified Unsplash IDs per activity (issue 06) so the PDP fallback
 * varies across the 151 galleries instead of repeating one photo per activity.
 * Reuses IDs already HTTP-verified in db/seed-extras.ts. The first entry of
 * each pool is the existing canonical photo (kept stable for callers that pass
 * no variant). Activities without an entry fall back to the single map image.
 */
const ACTIVITY_IMAGE_POOL: Record<string, string[]> = {
  rafting: [px('photo-1530866495561-507c9faab2ed'), px('photo-1599494284091-2b6f5b6c7e2c'), px('photo-1604537466158-719b1972feb8')],
  trekking: [px('photo-1506905925346-21bda4d32df4'), px('photo-1551632811-561732d1e306'), px('photo-1454496522488-7a8e488e8606'), px('photo-1469474968028-56623f02e42e')],
  paragliding: [px('photo-1597400473366-371a80b251eb'), px('photo-1504280390367-361c6d9f38f4'), px('photo-1502082553048-f009c37129b9')],
  'scuba-diving': [px('photo-1583364512105-951b6f7080ae'), px('photo-1544551763-46a013bb70d5'), px('photo-1582967788606-a171c1080cb0')],
  skiing: [px('photo-1551524559-8af4e6624178'), px('photo-1483721310020-03333e577078'), px('photo-1551698618-1dfe5d97d256')],
  'bungee-jumping': [px('photo-1564769662533-4f00a87b4056'), px('photo-1567604528969-2f9ffd981816'), px('photo-1533227268428-f9ed0900fb3b')],
  camping: [px('photo-1504280390367-361c6d9f38f4'), px('photo-1537565266759-34bbc16be345'), px('photo-1504851149312-7a075b496cc7')],
  kayaking: [px('photo-1472745942893-4b9f730c7668'), px('photo-1604537466158-719b1972feb8'), px('photo-1545153996-e01b1e29c8a8')],
  safari: [px('photo-1516426122078-c23e76319801'), px('photo-1549366021-9f761d450615'), px('photo-1547970810-dc1eac37d174')],
  'rock-climbing': [px('photo-1522163182402-834f871fd851'), px('photo-1516592673884-4a382d1124c2'), px('photo-1518609878373-06d740f60d8b')],
}

/**
 * The fallback image for an activity. Backward-compatible: called with no
 * `variant` it returns the canonical photo. An optional `variant` index rotates
 * through the verified per-activity pool so adjacent cards/galleries vary.
 */
export function getActivityImage(activitySlug: string, variant = 0): string {
  const pool = ACTIVITY_IMAGE_POOL[activitySlug]
  if (pool && pool.length > 0) {
    return pool[((variant % pool.length) + pool.length) % pool.length]
  }
  return ACTIVITY_IMAGES[activitySlug] ?? ACTIVITY_IMAGES.trekking
}

export function getRegionImage(regionSlug: string): string {
  return REGION_IMAGES[regionSlug] ?? REGION_IMAGES.rishikesh
}

export function getHeroImage(): string {
  return HERO_IMAGE
}
