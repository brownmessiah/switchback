/**
 * PDP meeting-point map composition (Issue 15, decision D0 — coordinate honesty).
 *
 * `experiences.meetingPoint` is FREE-TEXT (nullable) with NO per-listing
 * coordinate. This pure helper composes the honest map block for the PDP:
 *
 *   - `pin`     → the REGION centroid (`getRegionCoords`), an APPROXIMATE
 *                 city-level area — never a fabricated precise meeting-point
 *                 coordinate. `null` when the region has no known centroid, in
 *                 which case the PDP gracefully falls back to text only.
 *   - `mapsHref`→ an "Open in Maps" SEARCH deep link for the REAL named place
 *                 ("<meetingPoint>, <regionName>"), so the user's maps app
 *                 searches the actual location rather than dropping them at a
 *                 centroid. Falls back to the region name alone when the
 *                 meeting point is absent, and to `null` when there is nothing
 *                 to search for.
 *
 * Pure: no React, no DB, no router. The Leaflet render is a thin client
 * component (`components/maps/single-pin-map.tsx`) that consumes `pin`.
 */

import { buildMapsDeepLink } from './deep-link'
import { getRegionCoords, type LatLng } from './region-coords'

export interface MeetingPointMapInput {
  /** Free-text meeting point (e.g. "Lakshman Jhula"), or null when not set. */
  readonly meetingPoint: string | null
  /** Region slug from the controlled vocabulary, used to look up the centroid. */
  readonly regionSlug: string
  /** Localised region display name, used for the search deep-link query. */
  readonly regionName: string
}

export interface MeetingPointMap {
  /** Region centroid for the approximate-area pin, or null (text fallback). */
  readonly pin: LatLng | null
  /** Whether an approximate-area pin should be rendered. */
  readonly hasPin: boolean
  /** "Open in Maps" deep link, or null when there is nothing to search for. */
  readonly mapsHref: string | null
}

/**
 * Build the search-query text for the deep link from the (optional) free-text
 * meeting point and the region name. Returns an empty string when neither
 * yields anything searchable so `buildMapsDeepLink` resolves to `null`.
 */
function buildQuery(meetingPoint: string | null, regionName: string): string {
  const place = meetingPoint?.trim()
  const region = regionName.trim()

  if (place && region) return `${place}, ${region}`
  return place || region
}

export function resolveMeetingPointMap(
  input: MeetingPointMapInput,
): MeetingPointMap {
  const { meetingPoint, regionSlug, regionName } = input

  const pin = getRegionCoords(regionSlug) ?? null
  const mapsHref = buildMapsDeepLink({ query: buildQuery(meetingPoint, regionName) })

  return { pin, hasPin: pin !== null, mapsHref }
}
