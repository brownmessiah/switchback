import { describe, expect, it } from 'vitest'

import { resolveMeetingPointMap } from './meeting-point'

/**
 * Issue 15 — PDP meeting-point map composition.
 *
 * Pure decision layer that sits between the free-text meeting point + region
 * and the Leaflet pin / "Open in Maps" deep link. Coordinate honesty (D0):
 *   - `pin` = the REGION centroid (approximate city-level area), or null when
 *     the region has no known centroid.
 *   - `mapsHref` = a Google Maps SEARCH deep link for the real named place
 *     ("<meetingPoint>, <regionName>"), falling back to the region name alone
 *     when the meeting point is absent.
 */
describe('resolveMeetingPointMap', () => {
  it('pins the region centroid and queries "<meetingPoint>, <region>" when both present', () => {
    const result = resolveMeetingPointMap({
      meetingPoint: 'Lakshman Jhula',
      regionSlug: 'rishikesh',
      regionName: 'Rishikesh',
    })

    expect(result.pin).toEqual({ lat: 30.0869, lng: 78.2676 })
    expect(result.mapsHref).toBe(
      'https://www.google.com/maps/search/?api=1&query=Lakshman+Jhula%2C+Rishikesh',
    )
  })

  it('queries the region name alone when the meeting point is absent', () => {
    const result = resolveMeetingPointMap({
      meetingPoint: null,
      regionSlug: 'goa',
      regionName: 'Goa',
    })

    expect(result.pin).toEqual({ lat: 15.2993, lng: 74.124 })
    expect(result.mapsHref).toBe(
      'https://www.google.com/maps/search/?api=1&query=Goa',
    )
  })

  it('falls back to no pin but keeps the deep link when the region has no centroid', () => {
    const result = resolveMeetingPointMap({
      meetingPoint: 'Old fort gate',
      regionSlug: 'unknown-region',
      regionName: 'Somewhere',
    })

    expect(result.pin).toBeNull()
    expect(result.mapsHref).toBe(
      'https://www.google.com/maps/search/?api=1&query=Old+fort+gate%2C+Somewhere',
    )
  })

  it('returns no pin and no link when meeting point is absent AND region is unknown', () => {
    const result = resolveMeetingPointMap({
      meetingPoint: null,
      regionSlug: 'unknown-region',
      regionName: '',
    })

    expect(result.pin).toBeNull()
    expect(result.mapsHref).toBeNull()
  })

  it('trims whitespace-only meeting points and treats them as absent for the query', () => {
    const result = resolveMeetingPointMap({
      meetingPoint: '   ',
      regionSlug: 'manali',
      regionName: 'Manali',
    })

    expect(result.pin).toEqual({ lat: 32.2432, lng: 77.1892 })
    expect(result.mapsHref).toBe(
      'https://www.google.com/maps/search/?api=1&query=Manali',
    )
  })

  it('exposes whether an approximate-area pin is shown', () => {
    const withPin = resolveMeetingPointMap({
      meetingPoint: 'Pier',
      regionSlug: 'andaman',
      regionName: 'Andaman Islands',
    })
    const withoutPin = resolveMeetingPointMap({
      meetingPoint: 'Pier',
      regionSlug: 'no-such-place',
      regionName: 'Nowhere',
    })

    expect(withPin.hasPin).toBe(true)
    expect(withoutPin.hasPin).toBe(false)
  })
})
