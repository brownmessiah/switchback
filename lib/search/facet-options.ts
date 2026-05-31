/**
 * Facet option sets for the customer search filter rail (ADR-0013).
 *
 * DERIVED from the controlled-vocabulary registries — `listActivities()` and
 * `listRegions()` — so every facet slug is GUARANTEED to be a real registry
 * slug. A facet whose slug is not in the registry would submit an
 * `activitySlug`/`regionSlug` that can never match an indexed Experience (a
 * dead, non-functional facet: 0 results + noindex), which the issue forbids.
 * Deriving from the single source of truth keeps the rail in lock-step with
 * the vocabulary; `facet-options.test.ts` guards against any drift.
 *
 * Each option carries the registry `slug` (the value the GET form submits,
 * matching the searchParam names the page parses) and an `i18nKey` resolved
 * against the `SearchPage.activities` / `SearchPage.regions` namespaces so
 * every label is localised across the 13 supported locales — no hardcoded
 * English in the JSX.
 */

import { listActivities } from '@/lib/activities/registry'
import { listRegions } from '@/lib/regions/registry'

export interface FacetOption {
  /** Registry slug submitted as the searchParam value (e.g. `activity=rafting`). */
  readonly slug: string
  /** Translation key suffix under the relevant SearchPage sub-namespace. */
  readonly i18nKey: string
}

/**
 * Derive a safe i18n key suffix from a (possibly hyphenated) registry slug:
 * `bungee-jumping` → `bungeeJumping`, `leh-ladakh` → `lehLadakh`. Keeps the
 * message keys free of hyphens (which `next-intl` treats specially in key
 * paths) while staying a pure function of the registry slug.
 */
function slugToI18nKey(slug: string): string {
  return slug.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/**
 * Activity facet options — one per activities-registry entry. `i18nKey`
 * resolves against `SearchPage.activities`.
 */
export const ACTIVITY_OPTIONS: readonly FacetOption[] = listActivities().map(
  (a) => ({ slug: a.slug, i18nKey: slugToI18nKey(a.slug) }),
)

/**
 * Region facet options — one per regions-registry entry. `i18nKey` resolves
 * against `SearchPage.regions`. The Experience index already supports
 * `regionSlug` filtering and the page already parses `region`; this exposes
 * the matching control sourced exactly like activities.
 */
export const REGION_OPTIONS: readonly FacetOption[] = listRegions().map((r) => ({
  slug: r.slug,
  i18nKey: slugToI18nKey(r.slug),
}))
