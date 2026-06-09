/**
 * Pure pin-data transform (Issue 11, decision D4).
 *
 * Maps an Experience (or search hit) onto a map pin placed at its REGION
 * centroid. This is the testable core of the list/map toggle — the Leaflet
 * render is a thin client component that consumes these pins.
 *
 * Coordinate honesty (D0): a pin's position is the region's public city
 * centroid (`lib/maps/region-coords.ts`), NOT a fabricated per-Experience
 * coordinate. An Experience whose region has no known centroid yields `null`
 * and is excluded — never a guessed pin.
 *
 * Pure: no React, no DB, no router. Resolves the activity display name from the
 * activity registry, falling back to the raw slug when unknown.
 */

import { getActivity } from '@/lib/activities/registry'

import { getRegionCoords } from './region-coords'

/** The minimal Experience shape needed to build a pin (a `SearchExperienceHit`
 * or `RegionLandingExperience` both satisfy this). */
export interface PinnableExperience {
  readonly slug: string
  readonly title: string
  readonly regionSlug: string
  readonly activitySlug: string
  /** Starting "from Rs.X" price per person, in whole rupees. */
  readonly pricePerPersonRupees: number
}

export interface MapPin {
  readonly slug: string
  readonly title: string
  readonly regionSlug: string
  readonly lat: number
  readonly lng: number
  /** Starting price per person in whole rupees ("from Rs.X"). */
  readonly price: number
  /** Activity display name (en) for the pin label, or the raw slug if unknown. */
  readonly activity: string
}

/**
 * Transform a single Experience into a map pin, or `null` when its region has no
 * known centroid (handled gracefully — the caller drops it).
 */
export function toMapPin(experience: PinnableExperience): MapPin | null {
  const coords = getRegionCoords(experience.regionSlug)
  if (!coords) return null

  const activity =
    getActivity(experience.activitySlug)?.displayName.en ?? experience.activitySlug

  return {
    slug: experience.slug,
    title: experience.title,
    regionSlug: experience.regionSlug,
    lat: coords.lat,
    lng: coords.lng,
    price: experience.pricePerPersonRupees,
    activity,
  }
}

/**
 * Transform a list of Experiences into pins, dropping any whose region has no
 * known centroid. Preserves input order.
 */
export function toMapPins(experiences: readonly PinnableExperience[]): MapPin[] {
  const pins: MapPin[] = []
  for (const experience of experiences) {
    const pin = toMapPin(experience)
    if (pin) pins.push(pin)
  }
  return pins
}
