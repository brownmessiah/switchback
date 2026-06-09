import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  EXPERIENCE_FILTERABLE_ATTRIBUTES,
  EXPERIENCE_SORTABLE_ATTRIBUTES,
} from './indexer'
import type { MeiliIndexSettings, MeiliLike } from './meilisearch-client'
import {
  _resetSettingsGuardForTests,
  buildMeiliFilter,
  searchExperiences,
} from './search-experiences'

describe('buildMeiliFilter (Task 23)', () => {
  it('returns empty string when no filters are active', () => {
    expect(buildMeiliFilter({})).toBe('')
  })

  it('filters by activity slug', () => {
    expect(buildMeiliFilter({ activity: 'rafting' })).toBe(
      'activitySlug = "rafting"',
    )
  })

  it('filters by region slug', () => {
    expect(buildMeiliFilter({ region: 'rishikesh' })).toBe(
      'regionSlug = "rishikesh"',
    )
  })

  it('filters by min price', () => {
    expect(buildMeiliFilter({ minPrice: 1000 })).toBe(
      'pricePerPersonRupees >= 1000',
    )
  })

  it('filters by max price', () => {
    expect(buildMeiliFilter({ maxPrice: 5000 })).toBe(
      'pricePerPersonRupees <= 5000',
    )
  })

  it('combines multiple filters with AND', () => {
    const filter = buildMeiliFilter({
      activity: 'rafting',
      region: 'rishikesh',
      minPrice: 1000,
      maxPrice: 5000,
    })
    expect(filter).toBe(
      'activitySlug = "rafting" AND regionSlug = "rishikesh" AND pricePerPersonRupees >= 1000 AND pricePerPersonRupees <= 5000',
    )
  })

  it('ignores undefined values', () => {
    const filter = buildMeiliFilter({
      activity: undefined,
      region: 'goa',
    })
    expect(filter).toBe('regionSlug = "goa"')
  })

  // ADR-0017 structured facets (issue 04).
  it('filters by difficulty', () => {
    expect(buildMeiliFilter({ difficulty: 'moderate' })).toBe(
      'difficulty = "moderate"',
    )
  })

  it('filters by duration band', () => {
    expect(buildMeiliFilter({ durationBand: 'half_day' })).toBe(
      'durationBand = "half_day"',
    )
  })

  it('filters by season month membership (numeric, bare)', () => {
    expect(buildMeiliFilter({ seasonMonth: 6 })).toBe('seasonMonths = 6')
  })

  it('filters by group size as a "fits a group of N" lower-bound (maxGroupSize >= N)', () => {
    expect(buildMeiliFilter({ maxGroupSize: 8 })).toBe('maxGroupSize >= 8')
  })

  // Category + Destination(State) facets (issue 04 follow-up).
  it('filters by category', () => {
    expect(buildMeiliFilter({ category: 'water' })).toBe('category = "water"')
  })

  it('filters by state', () => {
    expect(buildMeiliFilter({ state: 'Himachal Pradesh' })).toBe(
      'state = "Himachal Pradesh"',
    )
  })

  it('combines category and state with the existing facets', () => {
    const filter = buildMeiliFilter({
      category: 'water',
      state: 'Himachal Pradesh',
      activity: 'rafting',
    })
    expect(filter).toBe(
      'activitySlug = "rafting" AND category = "water" AND state = "Himachal Pradesh"',
    )
  })

  it('combines the new facets with the existing ones in declaration order', () => {
    const filter = buildMeiliFilter({
      activity: 'rafting',
      region: 'rishikesh',
      minPrice: 1000,
      maxPrice: 5000,
      difficulty: 'moderate',
      durationBand: 'half_day',
      seasonMonth: 6,
      maxGroupSize: 8,
    })
    expect(filter).toBe(
      'activitySlug = "rafting" AND regionSlug = "rishikesh" AND pricePerPersonRupees >= 1000 AND pricePerPersonRupees <= 5000 AND difficulty = "moderate" AND durationBand = "half_day" AND seasonMonths = 6 AND maxGroupSize >= 8',
    )
  })
})

describe('isFilteredSearch', () => {
  it('returns true when any filter param is set', async () => {
    const { isFilteredSearch } = await import('./search-experiences')
    expect(isFilteredSearch({ activity: 'rafting' })).toBe(true)
    expect(isFilteredSearch({ minPrice: 1000 })).toBe(true)
    expect(isFilteredSearch({ sort: 'price_asc' })).toBe(true)
  })

  it('returns true when only a new structured facet is set (ADR-0017, issue 04)', async () => {
    const { isFilteredSearch } = await import('./search-experiences')
    expect(isFilteredSearch({ difficulty: 'moderate' })).toBe(true)
    expect(isFilteredSearch({ durationBand: 'half_day' })).toBe(true)
    expect(isFilteredSearch({ seasonMonth: 6 })).toBe(true)
    expect(isFilteredSearch({ maxGroupSize: 8 })).toBe(true)
    expect(isFilteredSearch({ sort: 'duration_asc' })).toBe(true)
  })

  it('returns true when only category or only state is set (issue 04 follow-up)', async () => {
    const { isFilteredSearch } = await import('./search-experiences')
    expect(isFilteredSearch({ category: 'water' })).toBe(true)
    expect(isFilteredSearch({ state: 'Goa' })).toBe(true)
  })

  it('returns false when only q is set', async () => {
    const { isFilteredSearch } = await import('./search-experiences')
    expect(isFilteredSearch({ q: 'rafting' })).toBe(false)
  })

  it('returns false when no params are set', async () => {
    const { isFilteredSearch } = await import('./search-experiences')
    expect(isFilteredSearch({})).toBe(false)
  })
})

interface ProbeStub {
  client: MeiliLike
  settingsCalls: MeiliIndexSettings[]
  searchCalls: number
  searchArgs: Array<{ q: string; opts: Record<string, unknown> }>
}

function makeProbeStub(searchImpl?: () => Promise<{ hits: unknown[] }>): ProbeStub {
  const settingsCalls: MeiliIndexSettings[] = []
  const searchArgs: Array<{ q: string; opts: Record<string, unknown> }> = []
  let searchCalls = 0
  const stub: ProbeStub = {
    settingsCalls,
    searchArgs,
    get searchCalls() {
      return searchCalls
    },
    client: {
      index: () => ({
        addDocuments: vi.fn(),
        deleteDocument: vi.fn(),
        updateSettings: async (settings) => {
          settingsCalls.push(settings)
          return { taskUid: 1 }
        },
        search: async (q: string, opts: Record<string, unknown>) => {
          searchCalls += 1
          searchArgs.push({ q, opts: opts ?? {} })
          return searchImpl ? searchImpl() : { hits: [] }
        },
      }),
    },
  }
  return stub
}

describe('searchExperiences resilience (ADR-0013)', () => {
  beforeEach(() => {
    _resetSettingsGuardForTests()
  })

  it('configures the index filter/sort settings before searching', async () => {
    const stub = makeProbeStub(async () => ({ hits: [{ id: 'x' }] }))
    await searchExperiences({ activity: 'rafting' }, { client: stub.client })
    expect(stub.settingsCalls).toHaveLength(1)
    expect(stub.settingsCalls[0]!.filterableAttributes).toEqual([
      ...EXPERIENCE_FILTERABLE_ATTRIBUTES,
    ])
    expect(stub.settingsCalls[0]!.sortableAttributes).toEqual([
      ...EXPERIENCE_SORTABLE_ATTRIBUTES,
    ])
  })

  it('ensures settings at most once per process across many searches', async () => {
    const stub = makeProbeStub()
    await searchExperiences({ q: 'a' }, { client: stub.client })
    await searchExperiences({ q: 'b' }, { client: stub.client })
    await searchExperiences({ region: 'goa' }, { client: stub.client })
    expect(stub.settingsCalls).toHaveLength(1)
    expect(stub.searchCalls).toBe(3)
  })

  it('degrades to empty hits AND logs server-side when Meilisearch throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const stub = makeProbeStub(async () => {
        throw new Error('invalid_search_filter')
      })
      const result = await searchExperiences(
        { activity: 'rafting' },
        { client: stub.client },
      )
      expect(result.hits).toEqual([])
      // A full Meili outage must be observable, not a silent "0 results".
      expect(errSpy).toHaveBeenCalledTimes(1)
      expect(errSpy.mock.calls[0]![0]).toContain('Meilisearch query failed')
      expect(errSpy.mock.calls[0]![1]).toBeInstanceOf(Error)
    } finally {
      errSpy.mockRestore()
    }
  })

  it('returns the index hits on a successful search', async () => {
    const stub = makeProbeStub(async () => ({
      hits: [{ id: 'h1', slug: 'grand-rafting', title: 'Grand Rafting' }],
    }))
    const result = await searchExperiences({ q: 'rafting' }, { client: stub.client })
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]!.slug).toBe('grand-rafting')
  })

  it('defensively drops any admin/E2E fixture hit (issue 04 leak hardening)', async () => {
    // Belt-and-suspenders: even if a stale Meili index still holds a fixture
    // document, the shared public-filter predicate strips it from the results.
    const stub = makeProbeStub(async () => ({
      hits: [
        { id: 'h1', slug: 'grand-rafting', title: 'Grand Rafting' },
        {
          id: 'h2',
          slug: 'commission-scope-fixture-bir-billing',
          title: 'Commission Scope Fixture',
        },
      ],
    }))
    const result = await searchExperiences({ q: 'rafting' }, { client: stub.client })
    expect(result.hits.map((h) => h.slug)).toEqual(['grand-rafting'])
  })

  it('maps the duration sort options onto Meili sort directives (ADR-0017)', async () => {
    const asc = makeProbeStub()
    await searchExperiences({ sort: 'duration_asc' }, { client: asc.client })
    expect(asc.searchArgs[0]!.opts.sort).toEqual(['durationMinutes:asc'])

    _resetSettingsGuardForTests()
    const desc = makeProbeStub()
    await searchExperiences({ sort: 'duration_desc' }, { client: desc.client })
    expect(desc.searchArgs[0]!.opts.sort).toEqual(['durationMinutes:desc'])
  })

  it('requests facet counts for the structured facets the UI surfaces', async () => {
    const stub = makeProbeStub()
    await searchExperiences({ q: 'rafting' }, { client: stub.client })
    const facets = stub.searchArgs[0]!.opts.facets as string[]
    expect(facets).toContain('activitySlug')
    expect(facets).toContain('regionSlug')
    expect(facets).toContain('difficulty')
    expect(facets).toContain('durationBand')
    expect(facets).toContain('category')
  })

  it('passes the new structured facets through to the Meili filter string', async () => {
    const stub = makeProbeStub()
    await searchExperiences(
      { difficulty: 'moderate', seasonMonth: 6 },
      { client: stub.client },
    )
    expect(stub.searchArgs[0]!.opts.filter).toBe(
      'difficulty = "moderate" AND seasonMonths = 6',
    )
  })
})
