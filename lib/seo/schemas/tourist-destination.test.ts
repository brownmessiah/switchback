import { describe, expect, it } from 'vitest'

import {
  touristDestination,
  type TouristDestinationArgs,
} from './tourist-destination'

describe('TouristDestination JSON-LD (ADR-0013)', () => {
  const base: TouristDestinationArgs = {
    name: 'Rishikesh',
    description: 'Adventure capital of India on the Ganges.',
    url: 'https://outvers.com/destinations/rishikesh',
    state: 'Uttarakhand',
    geo: { lat: 30.0869, lng: 78.2676 },
  }

  it('generates a valid TouristDestination schema with required fields', () => {
    const result = touristDestination(base)
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('TouristDestination')
    expect(result.name).toBe('Rishikesh')
    expect(result.description).toBe('Adventure capital of India on the Ganges.')
    expect(result.url).toBe('https://outvers.com/destinations/rishikesh')
  })

  it('sets containedInPlace to the Indian state', () => {
    const result = touristDestination(base)
    expect(result.containedInPlace).toEqual({
      '@type': 'AdministrativeArea',
      name: 'Uttarakhand',
    })
  })

  it('includes geo coordinates from a real centroid', () => {
    const result = touristDestination(base)
    expect(result.geo).toEqual({
      '@type': 'GeoCoordinates',
      latitude: 30.0869,
      longitude: 78.2676,
    })
  })

  it('omits geo when no centroid is available (D0: no fabricated coordinates)', () => {
    const result = touristDestination({ ...base, geo: undefined })
    expect(result.geo).toBeUndefined()
  })

  it('throws on empty name', () => {
    expect(() => touristDestination({ ...base, name: '' })).toThrow()
  })

  it('throws on empty url', () => {
    expect(() => touristDestination({ ...base, url: '' })).toThrow()
  })
})
