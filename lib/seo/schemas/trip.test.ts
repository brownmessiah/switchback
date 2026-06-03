import { describe, expect, it } from 'vitest'

import { touristTrip, type TouristTripArgs } from './trip'

describe('TouristTrip JSON-LD (ADR-0013)', () => {
  const base: TouristTripArgs = {
    name: 'Grand Rafting Trip',
  }

  it('generates a valid TouristTrip schema with required name', () => {
    const result = touristTrip(base)
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('TouristTrip')
    expect(result.name).toBe('Grand Rafting Trip')
  })

  it('includes description when provided', () => {
    const result = touristTrip({ ...base, description: 'A thrilling day on the Ganges' })
    expect(result.description).toBe('A thrilling day on the Ganges')
  })

  it('omits description when not provided', () => {
    const result = touristTrip(base)
    expect(result.description).toBeUndefined()
  })

  it('throws on empty name', () => {
    expect(() => touristTrip({ ...base, name: '' })).toThrow()
    expect(() => touristTrip({ ...base, name: '   ' })).toThrow()
  })

  describe('itinerary', () => {
    it('renders itinerary steps as a 1-based ordered ItemList in step order', () => {
      const result = touristTrip({
        ...base,
        itinerary: [
          { name: 'Briefing', description: 'Safety briefing at base camp' },
          { name: 'Rapids', description: 'Tackle grade III rapids' },
          { name: 'Debrief' },
        ],
      })

      expect(result.itinerary).toEqual({
        '@type': 'ItemList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            item: {
              '@type': 'TouristAttraction',
              name: 'Briefing',
              description: 'Safety briefing at base camp',
            },
          },
          {
            '@type': 'ListItem',
            position: 2,
            item: {
              '@type': 'TouristAttraction',
              name: 'Rapids',
              description: 'Tackle grade III rapids',
            },
          },
          {
            '@type': 'ListItem',
            position: 3,
            item: {
              '@type': 'TouristAttraction',
              name: 'Debrief',
            },
          },
        ],
      })
    })

    it('omits itinerary when not provided', () => {
      const result = touristTrip(base)
      expect(result.itinerary).toBeUndefined()
    })

    it('omits itinerary when an empty array is provided', () => {
      const result = touristTrip({ ...base, itinerary: [] })
      expect(result.itinerary).toBeUndefined()
    })
  })

  describe('duration (ISO-8601)', () => {
    it.each([
      [180, 'PT3H'],
      [90, 'PT1H30M'],
      [60, 'PT1H'],
      [45, 'PT45M'],
      [1440, 'P1D'],
      [7200, 'P5D'],
      [2880, 'P2D'],
    ])('maps %i minutes to %s', (minutes, expected) => {
      const result = touristTrip({ ...base, durationMinutes: minutes })
      expect(result.duration).toBe(expected)
    })

    it('omits duration when not provided', () => {
      const result = touristTrip(base)
      expect(result.duration).toBeUndefined()
    })

    it('omits duration when null', () => {
      const result = touristTrip({ ...base, durationMinutes: null })
      expect(result.duration).toBeUndefined()
    })
  })
})
