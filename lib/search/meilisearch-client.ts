import { Meilisearch } from 'meilisearch'

import { env } from '@/lib/env'

/**
 * Meilisearch client for ADR-0013 SEO faceted search + the experience
 * collection page's "more like this" surface.
 *
 * Returns a stub client in dev when MEILISEARCH_HOST is missing so the
 * indexer + search routes don't crash without Meilisearch provisioned.
 * The stub honours the surface used by the indexer (addDocuments,
 * deleteDocument, search) so feature code can run end-to-end against
 * PGlite + the stub in unit tests.
 */

export interface MeiliIndexSettings {
  filterableAttributes?: string[]
  sortableAttributes?: string[]
}

export interface MeiliIndex {
  addDocuments(docs: unknown[]): Promise<unknown>
  deleteDocument(id: string): Promise<unknown>
  search(query: string, opts?: Record<string, unknown>): Promise<{ hits: unknown[] }>
  updateSettings(settings: MeiliIndexSettings): Promise<unknown>
}

export interface MeiliLike {
  index(name: string): MeiliIndex
}

let cached: MeiliLike | null = null

function makeStub(): MeiliLike {
  return {
    index: () => ({
      async addDocuments() {
        return { taskUid: null }
      },
      async deleteDocument() {
        return { taskUid: null }
      },
      async search() {
        return { hits: [] }
      },
      async updateSettings() {
        return { taskUid: null }
      },
    }),
  }
}

export function getMeiliClient(): MeiliLike {
  if (cached) return cached

  if (env.MEILISEARCH_HOST && env.MEILISEARCH_KEY) {
    cached = new Meilisearch({
      host: env.MEILISEARCH_HOST,
      apiKey: env.MEILISEARCH_KEY,
    }) as unknown as MeiliLike
    return cached
  }

  cached = makeStub()
  return cached
}

/** Test-only — clear the cache so the next getMeiliClient() re-resolves. */
export function _resetMeiliClientForTests(): void {
  cached = null
}
