import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type ExperienceSearchDoc,
  _resetSettingsGuardForTests,
  deindexExperience,
  ensureExperienceIndexSettings,
  EXPERIENCE_FILTERABLE_ATTRIBUTES,
  EXPERIENCE_SORTABLE_ATTRIBUTES,
  indexExperience,
} from './indexer'
import type { MeiliIndexSettings, MeiliLike } from './meilisearch-client'

function makeStub(): {
  client: MeiliLike
  addCalls: unknown[][]
  deleteCalls: string[]
  settingsCalls: MeiliIndexSettings[]
} {
  const addCalls: unknown[][] = []
  const deleteCalls: string[] = []
  const settingsCalls: MeiliIndexSettings[] = []
  const client: MeiliLike = {
    index: () => ({
      addDocuments: async (docs) => {
        addCalls.push(docs as unknown[])
        return { taskUid: 1 }
      },
      deleteDocument: async (id) => {
        deleteCalls.push(String(id))
        return { taskUid: 2 }
      },
      search: vi.fn(async () => ({ hits: [] })),
      updateSettings: async (settings) => {
        settingsCalls.push(settings)
        return { taskUid: 3 }
      },
    }),
  }
  return { client, addCalls, deleteCalls, settingsCalls }
}

const sampleDoc: ExperienceSearchDoc = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'grand-rafting',
  title: 'Grand Rafting Adventure',
  shortDescription: 'Class IV rapids on the Ganga',
  activitySlug: 'rafting',
  regionSlug: 'rishikesh',
  vendorSlug: 'test-adventures',
  pricePerPersonRupees: 1500,
  isCombo: false,
  publishedAt: new Date('2026-05-01T00:00:00Z'),
  // ADR-0017 structured facets (issue 04).
  difficulty: 'moderate',
  durationMinutes: 240,
  maxGroupSize: 12,
  seasonMonths: [3, 4, 5, 6, 9, 10, 11],
}

describe('search indexer', () => {
  beforeEach(() => {
    // Each case starts with a fresh one-shot guard so settings re-apply.
    _resetSettingsGuardForTests()
  })

  it('indexExperience sends the document to the experiences index', async () => {
    const { client, addCalls } = makeStub()
    await indexExperience(sampleDoc, { client })
    expect(addCalls).toHaveLength(1)
    const docs = addCalls[0] as ExperienceSearchDoc[]
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      id: sampleDoc.id,
      slug: sampleDoc.slug,
      title: sampleDoc.title,
      activitySlug: 'rafting',
      regionSlug: 'rishikesh',
    })
  })

  it('deindexExperience removes the document by id', async () => {
    const { client, deleteCalls } = makeStub()
    await deindexExperience(sampleDoc.id, { client })
    expect(deleteCalls).toEqual([sampleDoc.id])
  })

  it('does NOT index an admin/E2E fixture Experience (issue 04 leak hardening)', async () => {
    // A fixture slug must never become searchable, even if it is somehow
    // published when (re)indexed — the shared public-filter predicate is the
    // single gate (lib/experiences/public-filter).
    const { client, addCalls } = makeStub()
    await indexExperience(
      { ...sampleDoc, slug: 'commission-scope-fixture-bir-billing' },
      { client },
    )
    expect(addCalls).toHaveLength(0)
  })

  it('indexExperience converts a numeric price to integer rupees and a Date to epoch ms', async () => {
    const { client, addCalls } = makeStub()
    await indexExperience(sampleDoc, { client })
    const doc = (addCalls[0] as Array<Record<string, unknown>>)[0]!
    expect(doc.pricePerPersonRupees).toBe(1500)
    expect(typeof doc.publishedAtEpochMs).toBe('number')
    expect(doc.publishedAtEpochMs).toBe(sampleDoc.publishedAt.getTime())
  })

  it('indexExperience tolerates a null shortDescription', async () => {
    const { client, addCalls } = makeStub()
    await indexExperience({ ...sampleDoc, shortDescription: null }, { client })
    const doc = (addCalls[0] as Array<Record<string, unknown>>)[0]!
    expect(doc.shortDescription).toBeNull()
  })

  it('maps the ADR-0017 structured facet fields onto the Meili document', async () => {
    const { client, addCalls } = makeStub()
    await indexExperience(sampleDoc, { client })
    const doc = (addCalls[0] as Array<Record<string, unknown>>)[0]!
    expect(doc.difficulty).toBe('moderate')
    expect(doc.durationMinutes).toBe(240)
    // 240 minutes → half_day (181..360). Derived at index time.
    expect(doc.durationBand).toBe('half_day')
    expect(doc.maxGroupSize).toBe(12)
    expect(doc.seasonMonths).toEqual([3, 4, 5, 6, 9, 10, 11])
  })

  it('derives category + state from the activity/region registries (issue 04 follow-up)', async () => {
    const { client, addCalls } = makeStub()
    // sampleDoc: activitySlug 'rafting' (category water), regionSlug
    // 'rishikesh' (state Uttarakhand). Both DERIVED at index time from the
    // controlled-vocabulary registries — no call-site change needed.
    await indexExperience(sampleDoc, { client })
    const doc = (addCalls[0] as Array<Record<string, unknown>>)[0]!
    expect(doc.category).toBe('water')
    expect(doc.state).toBe('Uttarakhand')
  })

  it('derives a null category/state for an unknown activity/region slug', async () => {
    const { client, addCalls } = makeStub()
    await indexExperience(
      { ...sampleDoc, activitySlug: 'no-such-activity', regionSlug: 'no-such-region' },
      { client },
    )
    const doc = (addCalls[0] as Array<Record<string, unknown>>)[0]!
    expect(doc.category).toBeNull()
    expect(doc.state).toBeNull()
  })

  it('passes null structured fields through and derives a null durationBand', async () => {
    const { client, addCalls } = makeStub()
    await indexExperience(
      {
        ...sampleDoc,
        difficulty: null,
        durationMinutes: null,
        maxGroupSize: null,
        seasonMonths: [],
      },
      { client },
    )
    const doc = (addCalls[0] as Array<Record<string, unknown>>)[0]!
    expect(doc.difficulty).toBeNull()
    expect(doc.durationMinutes).toBeNull()
    expect(doc.durationBand).toBeNull()
    expect(doc.maxGroupSize).toBeNull()
    expect(doc.seasonMonths).toEqual([])
  })
})

describe('ensureExperienceIndexSettings', () => {
  beforeEach(() => {
    // The settings guard is process-level one-shot; reset between cases.
    _resetSettingsGuardForTests()
  })

  it('configures the filterable + sortable attributes the search page relies on', async () => {
    const { client, settingsCalls } = makeStub()
    await ensureExperienceIndexSettings({ client })
    expect(settingsCalls).toHaveLength(1)
    expect(settingsCalls[0]!.filterableAttributes).toEqual(
      EXPERIENCE_FILTERABLE_ATTRIBUTES,
    )
    expect(settingsCalls[0]!.sortableAttributes).toEqual(
      EXPERIENCE_SORTABLE_ATTRIBUTES,
    )
  })

  it('covers every facet the customer search filter/sort form can emit', async () => {
    // The search page filters by activitySlug, regionSlug, and a price range,
    // and sorts by price + recency. Each must be configured or Meilisearch
    // rejects the query with a 400 and the search page crashes (ADR-0013).
    expect(EXPERIENCE_FILTERABLE_ATTRIBUTES).toContain('activitySlug')
    expect(EXPERIENCE_FILTERABLE_ATTRIBUTES).toContain('regionSlug')
    expect(EXPERIENCE_FILTERABLE_ATTRIBUTES).toContain('pricePerPersonRupees')
    expect(EXPERIENCE_SORTABLE_ATTRIBUTES).toContain('pricePerPersonRupees')
    expect(EXPERIENCE_SORTABLE_ATTRIBUTES).toContain('publishedAtEpochMs')
  })

  it('declares the ADR-0017 structured facet attributes (issue 04)', async () => {
    // Each facet the /search UI can emit MUST be filterable/sortable or
    // Meilisearch 400s and the page crashes (ADR-0013).
    expect(EXPERIENCE_FILTERABLE_ATTRIBUTES).toContain('difficulty')
    expect(EXPERIENCE_FILTERABLE_ATTRIBUTES).toContain('durationBand')
    expect(EXPERIENCE_FILTERABLE_ATTRIBUTES).toContain('seasonMonths')
    expect(EXPERIENCE_FILTERABLE_ATTRIBUTES).toContain('maxGroupSize')
    expect(EXPERIENCE_SORTABLE_ATTRIBUTES).toContain('durationMinutes')
  })

  it('declares the category + state facet attributes (issue 04 follow-up)', async () => {
    // Category (activity rollup) and Destination=State are filterable facets;
    // an unconfigured attribute 400s the search page (ADR-0013).
    expect(EXPERIENCE_FILTERABLE_ATTRIBUTES).toContain('category')
    expect(EXPERIENCE_FILTERABLE_ATTRIBUTES).toContain('state')
  })

  it('enqueues updateSettings at most once per process across direct calls', async () => {
    const { client, settingsCalls } = makeStub()
    await ensureExperienceIndexSettings({ client })
    await ensureExperienceIndexSettings({ client })
    await ensureExperienceIndexSettings({ client })
    expect(settingsCalls).toHaveLength(1)
  })

  it('indexExperience enqueues updateSettings only ONCE across many re-indexes', async () => {
    // Guards the write path: a busy moderation queue re-indexing N Experiences
    // must not thrash a fresh updateSettings task per index (#30 review).
    const { client, settingsCalls, addCalls } = makeStub()
    await indexExperience(sampleDoc, { client })
    await indexExperience({ ...sampleDoc, id: 'a' }, { client })
    await indexExperience({ ...sampleDoc, id: 'b' }, { client })
    await indexExperience({ ...sampleDoc, id: 'c' }, { client })
    expect(settingsCalls).toHaveLength(1)
    expect(addCalls).toHaveLength(4)
  })

  it('retries updateSettings after a transient failure', async () => {
    // First updateSettings rejects; the guard must reset so the next call
    // re-enqueues rather than caching the failed promise forever.
    let attempts = 0
    const settingsCalls: number[] = []
    const client: MeiliLike = {
      index: () => ({
        addDocuments: vi.fn(),
        deleteDocument: vi.fn(),
        search: vi.fn(async () => ({ hits: [] })),
        updateSettings: async () => {
          attempts += 1
          settingsCalls.push(attempts)
          if (attempts === 1) throw new Error('transient')
          return { taskUid: 3 }
        },
      }),
    }
    await expect(ensureExperienceIndexSettings({ client })).rejects.toThrow(
      'transient',
    )
    await ensureExperienceIndexSettings({ client })
    expect(settingsCalls).toEqual([1, 2])
  })
})
