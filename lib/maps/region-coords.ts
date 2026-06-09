/**
 * Region centroid coordinates (Issue 11, decision D4 + D0 coordinate honesty).
 *
 * These are REAL, public, well-known CITY-CENTROID coordinates keyed by the
 * `region_slug` controlled vocabulary in `lib/regions/registry.ts`. They are
 * verifiable facts about where each launch destination sits — NOT fabricated
 * per-Experience precision.
 *
 * Why a static lookup and not a DB column:
 *   - `experiences.meetingPoint` is FREE-TEXT (no lat/lng). There is no honest
 *     per-listing coordinate to seed (D0), and inventing one would mean a
 *     migration of fabricated data.
 *   - The region registry is a small, code-reviewed controlled vocabulary. A
 *     city centroid is the right granularity for a DISCOVERY map: it shows
 *     which CITY each Experience is in. It is explicitly NOT a turn-by-turn /
 *     precise meeting-point pin.
 *
 * Every slug in the region registry MUST appear here (enforced by a test) so no
 * Experience is silently dropped from the map for lack of a known centroid.
 *
 * Sources: standard public city coordinates (OpenStreetMap / Wikipedia). India
 * bounding box ≈ lat 6–37 N, lng 68–98 E.
 */

export interface LatLng {
  readonly lat: number
  readonly lng: number
}

const REGION_COORDS: Readonly<Record<string, LatLng>> = {
  rishikesh: { lat: 30.0869, lng: 78.2676 },
  manali: { lat: 32.2432, lng: 77.1892 },
  'bir-billing': { lat: 32.0419, lng: 76.7305 },
  goa: { lat: 15.2993, lng: 74.124 },
  'leh-ladakh': { lat: 34.1526, lng: 77.5771 },
  kasol: { lat: 32.0102, lng: 77.3148 },
  spiti: { lat: 32.2461, lng: 78.0177 },
  andaman: { lat: 11.7401, lng: 92.6586 },
  lonavala: { lat: 18.7546, lng: 73.4062 },
  auli: { lat: 30.5266, lng: 79.5673 },
}

/**
 * Return the public city centroid for a region slug, or `undefined` when the
 * slug is unknown. Callers MUST treat `undefined` as "no honest pin" and skip
 * the Experience rather than fabricate a location.
 */
export function getRegionCoords(regionSlug: string): LatLng | undefined {
  return REGION_COORDS[regionSlug]
}

/** Type-guard / membership check for a region slug having a known centroid. */
export function hasRegionCoords(regionSlug: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGION_COORDS, regionSlug)
}
