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
})

describe('isFilteredSearch', () => {
  it('returns true when any filter param is set', async () => {
    const { isFilteredSearch } = await import('./search-experiences')
    expect(isFilteredSearch({ activity: 'rafting' })).toBe(true)
    expect(isFilteredSearch({ minPrice: 1000 })).toBe(true)
    expect(isFilteredSearch({ sort: 'price_asc' })).toBe(true)
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
}

function makeProbeStub(searchImpl?: () => Promise<{ hits: unknown[] }>): ProbeStub {
  const settingsCalls: MeiliIndexSettings[] = []
  let searchCalls = 0
  const stub: ProbeStub = {
    settingsCalls,
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
        search: async () => {
          searchCalls += 1
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
})
