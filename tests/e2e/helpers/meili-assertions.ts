/**
 * Read-only Meilisearch query helpers for E2E assertions (Issue #17).
 *
 * The vendor listing edit flow re-indexes a published Experience into
 * Meilisearch (ADR-0013). These helpers fetch the indexed document by its
 * primary key (the Experience id) directly from the live Meilisearch
 * instance the webServer's prod indexer writes to, so the spec can prove
 * the re-index fired with the edited facet fields.
 *
 * Resolves the host/key from the same env the app uses. If Meilisearch is
 * not configured, the getters return null and the spec degrades to a
 * DB-only assertion (matching db-setup's tolerant Meili health check).
 */

export interface MeiliExperienceDoc {
  id: string
  slug: string
  title: string
  activitySlug: string
  regionSlug: string
  vendorSlug: string
  pricePerPersonRupees: number
  isCombo: boolean
  publishedAtEpochMs: number
}

const EXPERIENCE_INDEX = 'experiences'

function meiliConfig(): { host: string; key: string } | null {
  const host = process.env.MEILISEARCH_HOST
  const key = process.env.MEILISEARCH_KEY
  if (!host || !key) return null
  return { host: host.replace(/\/$/, ''), key }
}

/**
 * Fetch a single indexed Experience document by id, retrying briefly to
 * absorb Meilisearch's asynchronous task processing (addDocuments returns a
 * taskUid before the document is queryable). Returns null if the document
 * never appears within the budget or Meilisearch is not configured.
 */
export async function getIndexedExperience(
  experienceId: string,
  opts: { timeoutMs?: number } = {},
): Promise<MeiliExperienceDoc | null> {
  const cfg = meiliConfig()
  if (!cfg) return null

  const deadline = Date.now() + (opts.timeoutMs ?? 8000)
  const url = `${cfg.host}/indexes/${EXPERIENCE_INDEX}/documents/${experienceId}`

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${cfg.key}` },
        signal: AbortSignal.timeout(2000),
      })
      if (res.ok) {
        return (await res.json()) as MeiliExperienceDoc
      }
      // 404 = not indexed yet; keep polling.
    } catch {
      // Network hiccup — retry until the deadline.
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}
