/**
 * Fresh Meilisearch index setup for E2E tests.
 *
 * The Postgres E2E database is dropped + recreated + reseeded every run
 * (see db-setup.ts), but the Meilisearch `experiences` index is a SEPARATE
 * shared service that is populated incrementally by app flows (admin
 * approve → index, cross-surface beacons, etc.) and PERSISTS across runs.
 * Without an explicit reset, stale documents from a prior run — whose
 * experiences no longer exist in the freshly-reseeded DB — keep matching
 * search/facet queries (e.g. a leftover `goa`-region cross-surface beacon
 * polluting `?region=goa`). Reindexing alone can't remove them: their IDs
 * aren't in the new DB to de-index.
 *
 * `resetSearchIndex()` makes the index a deterministic mirror of the fresh
 * catalog each run: flush ALL documents, (re)apply the filter/sort settings
 * the search UI relies on (ADR-0013), then index exactly the seeded
 * published Experiences. No-op when Meilisearch is not configured (search
 * then runs against the in-process stub, which has nothing to reset).
 */

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { Meilisearch } from 'meilisearch'
import postgres from 'postgres'

import { experiences, vendorProfiles } from '@/db/schema'
// The activity/region registries and duration-band.ts are intentionally
// dependency-free (no lib/env), so they are safe to import here even though
// global-setup runs before .env.local loads.
import { getActivity } from '@/lib/activities/registry'
import { getRegion } from '@/lib/regions/registry'
import { durationBand } from '@/lib/search/duration-band'

import { e2eDbUrl } from './config'

const EXPERIENCE_INDEX = 'experiences'

// Mirrors lib/search/indexer.ts EXPERIENCE_{FILTERABLE,SORTABLE}_ATTRIBUTES
// (ADR-0013). Inlined rather than imported because that module pulls in
// lib/env, which validates the environment at module load — and global-setup
// loads .env.local at runtime, after its imports resolve. Kept in sync by the
// search-index settings test; if the indexer lists change, update here too.
const EXPERIENCE_FILTERABLE_ATTRIBUTES = [
  'activitySlug',
  'regionSlug',
  'pricePerPersonRupees',
  'vendorSlug',
  'isCombo',
  // ADR-0017 structured facets (issue 04).
  'difficulty',
  'durationBand',
  'seasonMonths',
  'maxGroupSize',
  // Category (activity rollup) + Destination=State facets (issue 04 follow-up).
  'category',
  'state',
]
const EXPERIENCE_SORTABLE_ATTRIBUTES = [
  'pricePerPersonRupees',
  'publishedAtEpochMs',
  'durationMinutes',
]

interface MeiliExperienceDoc {
  id: string
  slug: string
  title: string
  shortDescription: string | null
  activitySlug: string
  regionSlug: string
  vendorSlug: string
  pricePerPersonRupees: number
  isCombo: boolean
  publishedAtEpochMs: number
  // ADR-0017 structured facets (issue 04). Mirrors lib/search/indexer.ts
  // MeiliPayload so E2E search-facet specs have something to filter.
  difficulty: string | null
  durationMinutes: number | null
  durationBand: string | null
  maxGroupSize: number | null
  seasonMonths: number[]
  // Category (activity rollup) + Destination=State (issue 04 follow-up),
  // derived from activitySlug/regionSlug via the registries.
  category: string | null
  state: string | null
}

export async function resetSearchIndex(): Promise<void> {
  const host = process.env.MEILISEARCH_HOST
  const apiKey = process.env.MEILISEARCH_KEY
  if (!host || !apiKey) {
    console.log('[E2E] Meilisearch not configured — skipping search index reset.')
    return
  }

  const client = new Meilisearch({ host, apiKey })

  // 1. Ensure the index exists (tolerate "already exists"), then flush every
  //    document — including stale prior-run docs absent from the fresh DB.
  try {
    const created = await client.createIndex(EXPERIENCE_INDEX, { primaryKey: 'id' })
    await client.tasks.waitForTask(created.taskUid)
  } catch {
    // Index already exists — fine.
  }
  const flush = await client.index(EXPERIENCE_INDEX).deleteAllDocuments()
  await client.tasks.waitForTask(flush.taskUid)

  // 2. (Re)apply the filterable + sortable attributes the customer search
  //    filter/sort form relies on; an unconfigured attribute 400s the page.
  const settings = await client.index(EXPERIENCE_INDEX).updateSettings({
    filterableAttributes: [...EXPERIENCE_FILTERABLE_ATTRIBUTES],
    sortableAttributes: [...EXPERIENCE_SORTABLE_ATTRIBUTES],
  })
  await client.tasks.waitForTask(settings.taskUid)

  // 3. Reindex exactly the seeded PUBLISHED experiences from the e2e DB.
  //    Connect explicitly to the e2e database (global-setup's own
  //    process.env.DATABASE_URL points at the dev DB, not outvers_e2e).
  const sql = postgres(e2eDbUrl(), { max: 1 })
  try {
    const db = drizzle(sql)
    const rows = await db
      .select({
        id: experiences.id,
        slug: experiences.slug,
        title: experiences.title,
        shortDescription: experiences.shortDescription,
        activitySlug: experiences.activitySlug,
        regionSlug: experiences.regionSlug,
        isCombo: experiences.isCombo,
        price: experiences.pricePerPerson_1_2,
        createdAt: experiences.createdAt,
        vendorSlug: vendorProfiles.slug,
        // ADR-0017 structured facets (issue 04).
        difficulty: experiences.difficulty,
        durationMinutes: experiences.durationMinutes,
        maxGroupSize: experiences.maxGroupSize,
        seasonMonths: experiences.seasonMonths,
      })
      .from(experiences)
      .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
      .where(eq(experiences.status, 'published'))

    if (rows.length > 0) {
      const docs: MeiliExperienceDoc[] = rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        shortDescription: r.shortDescription,
        activitySlug: r.activitySlug,
        regionSlug: r.regionSlug,
        vendorSlug: r.vendorSlug,
        pricePerPersonRupees: Math.round(Number(r.price)),
        isCombo: r.isCombo,
        publishedAtEpochMs: (r.createdAt ?? new Date()).getTime(),
        difficulty: r.difficulty,
        durationMinutes: r.durationMinutes,
        durationBand: durationBand(r.durationMinutes),
        maxGroupSize: r.maxGroupSize,
        seasonMonths: r.seasonMonths ?? [],
        category: getActivity(r.activitySlug)?.category ?? null,
        state: getRegion(r.regionSlug)?.state ?? null,
      }))
      const add = await client
        .index(EXPERIENCE_INDEX)
        .addDocuments(docs, { primaryKey: 'id' })
      await client.tasks.waitForTask(add.taskUid)
    }

    console.log(
      `[E2E] Search index reset — ${rows.length} published experience(s) indexed.`,
    )
  } finally {
    await sql.end()
  }
}
