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
 * Add or update an Experience in the search index. Idempotent at the
 * Meilisearch layer — addDocuments with an existing primary key is an
 * upsert. Call from Server Actions on Experience publish (via Next.js
 * `after()`) so the index lags the DB by at most one tick.
 */
export async function indexExperience(
  doc: ExperienceSearchDoc,
  opts: IndexerOpts = {},
): Promise<void> {
  const client = opts.client ?? getMeiliClient()
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
