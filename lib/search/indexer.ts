import { durationBand } from './duration-band'
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
  // ADR-0017 structured facets (issue 04). `durationBand` is the derived
  // coarse bucket (see ./duration-band); `seasonMonths` is a number[] —
  // Meilisearch treats `seasonMonths = 6` as array membership. A null
  // difficulty / durationBand / maxGroupSize document simply won't match a
  // filter on that attribute (bare Experiences drop out — correct).
  'difficulty',
  'durationBand',
  'seasonMonths',
  'maxGroupSize',
]

/**
 * Attributes the search `sort` dropdown can order by (price low→high /
 * high→low, newest). Like filters, an unconfigured sortable attribute is a
 * 400 from Meilisearch.
 */
export const EXPERIENCE_SORTABLE_ATTRIBUTES: readonly string[] = [
  'pricePerPersonRupees',
  'publishedAtEpochMs',
  // ADR-0017 — sort by activity length (shortest/longest first), issue 04.
  'durationMinutes',
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
  // ADR-0017 structured facets (issue 04). Additive — all nullable / empty
  // for a bare Experience that hasn't filled the structured fields.
  difficulty: string | null
  durationMinutes: number | null
  maxGroupSize: number | null
  seasonMonths: number[]
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
  // ADR-0017 structured facets (issue 04).
  difficulty: string | null
  durationMinutes: number | null
  durationBand: string | null
  maxGroupSize: number | null
  seasonMonths: number[]
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
    // ADR-0017 — pass the scalars through and derive the band at index time
    // so the facet UI offers a handful of buckets rather than raw minutes.
    difficulty: doc.difficulty,
    durationMinutes: doc.durationMinutes,
    durationBand: durationBand(doc.durationMinutes),
    maxGroupSize: doc.maxGroupSize,
    seasonMonths: doc.seasonMonths,
  }
}

/**
 * Raw settings write — enqueues a Meilisearch `updateSettings` task that
 * declares the filterable + sortable attributes the search page relies on.
 * NOT a no-op on re-apply: each call enqueues a fresh task, so callers must
 * go through the one-shot `ensureExperienceIndexSettings` guard below rather
 * than invoking this directly.
 */
async function applyExperienceIndexSettings(client: MeiliLike): Promise<void> {
  await client.index(EXPERIENCE_INDEX).updateSettings({
    filterableAttributes: [...EXPERIENCE_FILTERABLE_ATTRIBUTES],
    sortableAttributes: [...EXPERIENCE_SORTABLE_ATTRIBUTES],
  })
}

/**
 * One-shot guard so the index's filter/sort settings are configured at most
 * once per server process — shared by BOTH the search READ path
 * (`searchExperiences`) and the index WRITE path (`indexExperience`). A
 * freshly provisioned (or pre-existing but unconfigured) Meilisearch index
 * has EMPTY filterable + sortable attributes, which makes every
 * filtered/sorted query 400 and crash the search page (ADR-0013); we
 * self-heal once. Without this, a busy moderation queue would thrash a
 * `updateSettings` task on every re-index.
 */
let settingsEnsured: Promise<void> | null = null

/**
 * Configure the Experiences index's filterable + sortable attributes so the
 * customer search page's filter/sort form never 400s (ADR-0013). Process-level
 * one-shot: the first call enqueues the settings task and caches the promise;
 * subsequent calls await the cached promise without re-enqueuing. A transient
 * failure resets the guard so the next call retries. Safe to call before the
 * first search or alongside an index.
 */
export async function ensureExperienceIndexSettings(
  opts: IndexerOpts = {},
): Promise<void> {
  const client = opts.client ?? getMeiliClient()
  if (!settingsEnsured) {
    settingsEnsured = applyExperienceIndexSettings(client).catch((err) => {
      // Reset so a transient failure can retry on the next call.
      settingsEnsured = null
      throw err
    })
  }
  await settingsEnsured
}

/** Test-only — clear the one-shot settings guard between cases. */
export function _resetSettingsGuardForTests(): void {
  settingsEnsured = null
}

/**
 * Add or update an Experience in the search index. Idempotent at the
 * Meilisearch layer — addDocuments with an existing primary key is an
 * upsert. Call from Server Actions on Experience publish (via Next.js
 * `after()`) so the index lags the DB by at most one tick.
 *
 * Ensures the index's filter/sort settings on first write so a freshly
 * provisioned Meilisearch (empty settings) does not break the search page.
 * The settings call is one-shot per process (shared with the search read
 * path), so a busy moderation queue re-indexing many Experiences enqueues at
 * most one `updateSettings` task.
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
