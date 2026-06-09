/**
 * "Open in Maps" deep-link builder (Issue 11, decision D4).
 *
 * Produces a Google Maps *universal* URL (works on web, Android, and iOS, which
 * all honour the `maps.google.com/maps/search/?api=1` scheme). No API key, no
 * billing — it is a plain navigable URL.
 *
 * Accepts EITHER coords OR a free-text query:
 *   - coords → `query=LAT,LNG` (the precise centroid for a map pin).
 *   - query  → URL-encoded free text. Issue 15 consumes this for the PDP
 *     meeting point, which is FREE-TEXT (e.g. "Lakshman Jhula, Rishikesh").
 *
 * coords win when both are supplied. Returns `null` when there is nothing to
 * link to (no coords and an empty/whitespace query) so callers can omit the CTA
 * rather than render a dead link.
 *
 * Pure: no React, no DOM.
 */

const GMAPS_BASE = 'https://www.google.com/maps/search/?api=1&query='

export interface MapsDeepLinkInput {
  /** Latitude — paired with `lng` to build a precise coordinate link. */
  readonly lat?: number
  /** Longitude — paired with `lat`. */
  readonly lng?: number
  /** Free-text place query (used only when coords are absent). */
  readonly query?: string
}

export function buildMapsDeepLink(input: MapsDeepLinkInput): string | null {
  const { lat, lng, query } = input

  if (typeof lat === 'number' && typeof lng === 'number') {
    // Coordinates: `LAT,LNG`. `encodeURIComponent` escapes the comma to %2C,
    // which Google Maps parses back to a coordinate pair.
    return GMAPS_BASE + encodeURIComponent(`${lat},${lng}`)
  }

  const trimmed = query?.trim()
  if (trimmed) {
    // `URLSearchParams` encodes spaces as `+` and commas as %2C, matching the
    // `query` param convention Google Maps expects.
    return GMAPS_BASE + new URLSearchParams({ query: trimmed }).toString().slice('query='.length)
  }

  return null
}
