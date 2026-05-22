import { describe, expect, it, vi } from 'vitest'

import {
  type ExperienceSearchDoc,
  deindexExperience,
  indexExperience,
} from './indexer'
import type { MeiliLike } from './meilisearch-client'

function makeStub(): {
  client: MeiliLike
  addCalls: unknown[][]
  deleteCalls: string[]
} {
  const addCalls: unknown[][] = []
  const deleteCalls: string[] = []
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
    }),
  }
  return { client, addCalls, deleteCalls }
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
}

describe('search indexer', () => {
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
})
