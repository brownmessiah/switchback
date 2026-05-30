import { getMeiliClient, type MeiliLike } from './meilisearch-client'

/**
 * Search index document shape for Experiences per ADR-0013.
 *
 * The schema is a flat record optimised for Meilisearch's filterable +
 * sortable fields: activitySlug, regionSlug, vendorSlug, price for
 * facets; publishedAtEpochMs for recency ordering; isCombo for the
 * Combo-specific surface. Fields the search UI never reads (commission
 * snapshot, audit) are deliberately omitted.
 */

const EXPERIENCE_INDEX = 'experiences'

/**
 * Attributes the customer search filter form (`buildMeiliFilter`) and the
 * faceted collection surface filter on. Meilisearch REJECTS a `filter`
 * referencing an unconfigured attribute with a 400 — so every facet the
 * search UI can emit MUST be declared here, or the search page crashes the
 * moment a Customer applies an activity / region / price filter (ADR-0013).
 */
export const EXPERIENCE_FILTERABLE_ATTRIBUTES: readonly string[] = [
  'activitySlug',
  'regionSlug',
  'pricePerPersonRupees',
  'vendorSlug',
  'isCombo',
]

/**
 * Attributes the search `sort` dropdown can order by (price low→high /
 * high→low, newest). Like filters, an unconfigured sortable attribute is a
 * 400 from Meilisearch.
 */
export const EXPERIENCE_SORTABLE_ATTRIBUTES: readonly string[] = [
  'pricePerPersonRupees',
  'publishedAtEpochMs',
]

export interface ExperienceSearchDoc {
  id: string
  slug: string
  title: string
  shortDescription: string | null
  activitySlug: string
  regionSlug: string
  vendorSlug: string
  pricePerPersonRupees: number
  isCombo: boolean
  publishedAt: Date
}

export interface IndexerOpts {
  client?: MeiliLike
}

interface MeiliPayload {
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
}

function toMeiliDoc(doc: ExperienceSearchDoc): MeiliPayload {
  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    shortDescription: doc.shortDescription,
    activitySlug: doc.activitySlug,
    regionSlug: doc.regionSlug,
    vendorSlug: doc.vendorSlug,
    pricePerPersonRupees: doc.pricePerPersonRupees,
    isCombo: doc.isCombo,
    publishedAtEpochMs: doc.publishedAt.getTime(),
  }
}

/**
 * Configure the Experiences index's filterable + sortable attributes so the
 * customer search page's filter/sort form never 400s (ADR-0013). Idempotent:
 * Meilisearch's updateSettings is a full replace, so re-applying the same set
 * is a no-op task. Safe to call before the first search or alongside an index.
 */
export async function ensureExperienceIndexSettings(
  opts: IndexerOpts = {},
): Promise<void> {
  const client = opts.client ?? getMeiliClient()
  await client.index(EXPERIENCE_INDEX).updateSettings({
    filterableAttributes: [...EXPERIENCE_FILTERABLE_ATTRIBUTES],
    sortableAttributes: [...EXPERIENCE_SORTABLE_ATTRIBUTES],
  })
}

/**
 * Add or update an Experience in the search index. Idempotent at the
 * Meilisearch layer — addDocuments with an existing primary key is an
 * upsert. Call from Server Actions on Experience publish (via Next.js
 * `after()`) so the index lags the DB by at most one tick.
 *
 * Ensures the index's filter/sort settings on first write so a freshly
 * provisioned Meilisearch (empty settings) does not break the search page.
 */
export async function indexExperience(
  doc: ExperienceSearchDoc,
  opts: IndexerOpts = {},
): Promise<void> {
  const client = opts.client ?? getMeiliClient()
  await ensureExperienceIndexSettings({ client })
  await client.index(EXPERIENCE_INDEX).addDocuments([toMeiliDoc(doc)])
}

/**
 * Remove an Experience from the search index. Called on
 * unpublish / archive / hard-delete from the admin tool.
 */
export async function deindexExperience(
  experienceId: string,
  opts: IndexerOpts = {},
): Promise<void> {
  const client = opts.client ?? getMeiliClient()
  await client.index(EXPERIENCE_INDEX).deleteDocument(experienceId)
}
