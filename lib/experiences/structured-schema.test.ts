import { describe, expect, it } from 'vitest'

import {
  formatDuration,
  formatSeason,
  itinerarySchema,
  KNOWN_GUIDE_LANGUAGES,
  structuredExperienceSchema,
} from './structured-schema'

describe('formatDuration', () => {
  it('formats whole hours', () => {
    expect(formatDuration(180)).toBe('3 hours')
  })

  it('singularizes one hour', () => {
    expect(formatDuration(60)).toBe('1 hour')
  })

  it('formats sub-hour minutes', () => {
    expect(formatDuration(45)).toBe('45 minutes')
  })

  it('formats hours plus minutes', () => {
    expect(formatDuration(90)).toBe('1 hour 30 minutes')
  })

  it('formats a single day', () => {
    expect(formatDuration(1440)).toBe('1 day')
  })

  it('formats multiple whole days', () => {
    expect(formatDuration(7200)).toBe('5 days')
  })

  it('formats two days', () => {
    expect(formatDuration(2880)).toBe('2 days')
  })

  it('formats days with an hour remainder', () => {
    expect(formatDuration(1500)).toBe('1 day 1 hour')
  })

  it('formats a single minute', () => {
    expect(formatDuration(1)).toBe('1 minute')
  })
})

describe('formatSeason', () => {
  it('renders a contiguous ascending run as First–Last with an en dash', () => {
    expect(formatSeason([6, 7, 8, 9, 10])).toBe('Jun–Oct')
  })

  it('renders a single month as its abbreviation', () => {
    expect(formatSeason([3])).toBe('Mar')
  })

  it('renders a non-contiguous set as a sorted comma list', () => {
    expect(formatSeason([1, 2, 12])).toBe('Jan, Feb, Dec')
  })

  it('renders an empty array as an empty string', () => {
    expect(formatSeason([])).toBe('')
  })

  it('dedupes and sorts the input before deciding contiguity', () => {
    expect(formatSeason([8, 6, 7, 6])).toBe('Jun–Aug')
  })

  it('renders a wrap-around set as a comma list', () => {
    expect(formatSeason([12, 1, 2])).toBe('Jan, Feb, Dec')
  })
})

describe('structuredExperienceSchema — season months', () => {
  it('rejects month 0', () => {
    expect(structuredExperienceSchema.safeParse({ seasonMonths: [0] }).success).toBe(false)
  })

  it('rejects month 13', () => {
    expect(structuredExperienceSchema.safeParse({ seasonMonths: [13] }).success).toBe(false)
  })

  it('rejects duplicate months', () => {
    expect(structuredExperienceSchema.safeParse({ seasonMonths: [6, 6] }).success).toBe(false)
  })

  it('accepts a valid month set', () => {
    expect(structuredExperienceSchema.safeParse({ seasonMonths: [6, 7, 8] }).success).toBe(true)
  })
})

describe('structuredExperienceSchema — highlights', () => {
  it('rejects 7 highlights (max 6)', () => {
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(structuredExperienceSchema.safeParse({ highlights: seven }).success).toBe(false)
  })

  it('accepts 6 highlights', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(structuredExperienceSchema.safeParse({ highlights: six }).success).toBe(true)
  })

  it('rejects a 121-char highlight', () => {
    expect(
      structuredExperienceSchema.safeParse({ highlights: ['x'.repeat(121)] }).success,
    ).toBe(false)
  })

  it('accepts a 120-char highlight', () => {
    expect(
      structuredExperienceSchema.safeParse({ highlights: ['x'.repeat(120)] }).success,
    ).toBe(true)
  })
})

describe('structuredExperienceSchema — inclusions/exclusions/whatToBring', () => {
  it('rejects 16 inclusions (max 15)', () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => `item-${i}`)
    expect(structuredExperienceSchema.safeParse({ inclusions: sixteen }).success).toBe(false)
  })

  it('accepts 15 inclusions', () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => `item-${i}`)
    expect(structuredExperienceSchema.safeParse({ inclusions: fifteen }).success).toBe(true)
  })
})

describe('structuredExperienceSchema — languages', () => {
  it('rejects an unknown language code', () => {
    expect(structuredExperienceSchema.safeParse({ languages: ['fr'] }).success).toBe(false)
  })

  it('accepts a known subset', () => {
    expect(structuredExperienceSchema.safeParse({ languages: ['en', 'hi'] }).success).toBe(true)
  })

  it('rejects duplicate languages', () => {
    expect(structuredExperienceSchema.safeParse({ languages: ['en', 'en'] }).success).toBe(false)
  })

  it('exposes the known guide language set', () => {
    expect(KNOWN_GUIDE_LANGUAGES).toContain('en')
    expect(KNOWN_GUIDE_LANGUAGES).toContain('ur')
    expect(KNOWN_GUIDE_LANGUAGES).not.toContain('fr')
  })
})

describe('structuredExperienceSchema — durationMinutes', () => {
  it('rejects 14 (below min 15)', () => {
    expect(structuredExperienceSchema.safeParse({ durationMinutes: 14 }).success).toBe(false)
  })

  it('accepts 15', () => {
    expect(structuredExperienceSchema.safeParse({ durationMinutes: 15 }).success).toBe(true)
  })

  it('accepts 43200', () => {
    expect(structuredExperienceSchema.safeParse({ durationMinutes: 43200 }).success).toBe(true)
  })

  it('rejects 43201 (above max)', () => {
    expect(structuredExperienceSchema.safeParse({ durationMinutes: 43201 }).success).toBe(false)
  })
})

describe('structuredExperienceSchema — minAge', () => {
  it('rejects -1', () => {
    expect(structuredExperienceSchema.safeParse({ minAge: -1 }).success).toBe(false)
  })

  it('accepts 0', () => {
    expect(structuredExperienceSchema.safeParse({ minAge: 0 }).success).toBe(true)
  })

  it('rejects 100', () => {
    expect(structuredExperienceSchema.safeParse({ minAge: 100 }).success).toBe(false)
  })
})

describe('structuredExperienceSchema — maxGroupSize', () => {
  it('rejects 0', () => {
    expect(structuredExperienceSchema.safeParse({ maxGroupSize: 0 }).success).toBe(false)
  })

  it('accepts 1', () => {
    expect(structuredExperienceSchema.safeParse({ maxGroupSize: 1 }).success).toBe(true)
  })

  it('rejects 101', () => {
    expect(structuredExperienceSchema.safeParse({ maxGroupSize: 101 }).success).toBe(false)
  })
})

describe('itinerarySchema', () => {
  it('rejects 31 steps (max 30)', () => {
    const thirtyOne = Array.from({ length: 31 }, (_, i) => ({ title: `Step ${i}` }))
    expect(itinerarySchema.safeParse(thirtyOne).success).toBe(false)
  })

  it('accepts 30 steps', () => {
    const thirty = Array.from({ length: 30 }, (_, i) => ({ title: `Step ${i}` }))
    expect(itinerarySchema.safeParse(thirty).success).toBe(true)
  })

  it('rejects a step title of 121 chars', () => {
    expect(itinerarySchema.safeParse([{ title: 'x'.repeat(121) }]).success).toBe(false)
  })

  it('rejects a step description of 601 chars', () => {
    expect(
      itinerarySchema.safeParse([{ title: 'ok', description: 'x'.repeat(601) }]).success,
    ).toBe(false)
  })

  it('accepts a step with a 600-char description', () => {
    expect(
      itinerarySchema.safeParse([{ title: 'ok', description: 'x'.repeat(600) }]).success,
    ).toBe(true)
  })

  it('accepts a step with optional dayOffset and durationMinutes', () => {
    expect(
      itinerarySchema.safeParse([{ title: 'ok', dayOffset: 0, durationMinutes: 30 }]).success,
    ).toBe(true)
  })

  it('rejects a blank step title', () => {
    expect(itinerarySchema.safeParse([{ title: '   ' }]).success).toBe(false)
  })
})

describe('structuredExperienceSchema — bare object', () => {
  it('validates a fully-empty object (a bare Experience)', () => {
    expect(structuredExperienceSchema.safeParse({}).success).toBe(true)
  })
})
