import { describe, expect, it } from 'vitest'

import { buildHomeSearchQuery, type HomeSearchFields } from './home-query'

/**
 * `lib/search/home-query` is the PURE mapping from the home hero's structured
 * 4-field search ({destination, activity, date, groupSize}) onto the EXISTING
 * `/search` facet query params (issue 09). It introduces NO new query infra —
 * it maps to the param names `parseSearchParams` already accepts:
 *   destination → region   (region slug)
 *   activity    → activity  (activity slug)
 *   date        → season    (the MONTH 1-12 extracted from the date)
 *   groupSize   → groupSize (integer)
 * Empty/unset fields are OMITTED (the search page treats "" as "not filtered").
 */
describe('buildHomeSearchQuery', () => {
  it('maps all four fields onto the existing /search facet params', () => {
    const fields: HomeSearchFields = {
      destination: 'rishikesh',
      activity: 'rafting',
      // A June date — the month (6) is what maps to the season facet.
      date: '2026-06-15',
      groupSize: 4,
    }
    expect(buildHomeSearchQuery(fields)).toBe(
      '/search?region=rishikesh&activity=rafting&season=6&groupSize=4',
    )
  })

  it('extracts the MONTH (1-12) from the date for the season facet', () => {
    expect(buildHomeSearchQuery({ date: '2026-01-02' })).toBe('/search?season=1')
    expect(buildHomeSearchQuery({ date: '2026-12-31' })).toBe('/search?season=12')
  })

  it('omits empty-string and unset fields entirely', () => {
    // No fields at all → bare /search (unfiltered, indexable per ADR-0013).
    expect(buildHomeSearchQuery({})).toBe('/search')
    // Empty strings must NOT appear as params.
    expect(
      buildHomeSearchQuery({ destination: '', activity: '', date: '' }),
    ).toBe('/search')
  })

  it('supports a destination-only chip target', () => {
    expect(buildHomeSearchQuery({ destination: 'goa' })).toBe('/search?region=goa')
  })

  it('supports an activity-only chip target', () => {
    expect(buildHomeSearchQuery({ activity: 'paragliding' })).toBe(
      '/search?activity=paragliding',
    )
  })

  it('supports a destination + activity chip target (the popular-chip shape)', () => {
    expect(
      buildHomeSearchQuery({ destination: 'rishikesh', activity: 'rafting' }),
    ).toBe('/search?region=rishikesh&activity=rafting')
  })

  it('omits a non-positive or unparseable group size', () => {
    expect(buildHomeSearchQuery({ groupSize: 0 })).toBe('/search')
    expect(buildHomeSearchQuery({ groupSize: -3 })).toBe('/search')
    expect(buildHomeSearchQuery({ groupSize: Number.NaN })).toBe('/search')
  })

  it('floors a fractional group size to an integer', () => {
    expect(buildHomeSearchQuery({ groupSize: 4.9 })).toBe('/search?groupSize=4')
  })

  it('ignores an invalid date rather than emitting an empty season param', () => {
    expect(buildHomeSearchQuery({ date: 'not-a-date' })).toBe('/search')
    expect(buildHomeSearchQuery({ destination: 'goa', date: '' })).toBe(
      '/search?region=goa',
    )
  })

  it('emits params in a stable order (region, activity, season, groupSize)', () => {
    // The order is deterministic regardless of the input key order so the URL
    // is stable for caching + snapshotting.
    expect(
      buildHomeSearchQuery({
        groupSize: 2,
        date: '2026-03-10',
        activity: 'scuba-diving',
        destination: 'goa',
      }),
    ).toBe('/search?region=goa&activity=scuba-diving&season=3&groupSize=2')
  })
})
