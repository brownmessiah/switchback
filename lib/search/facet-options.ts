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

import {
  type ActivityCategory,
  listActivities,
} from '@/lib/activities/registry'
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
export function slugToI18nKey(slug: string): string {
  return slug.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/**
 * Human-readable fallback for a slug with no i18n entry (an unknown or stale
 * facet value arriving via the URL): `scuba` → `Scuba`, `spiti-valley` →
 * `Spiti valley`. Display-only — never a substitute for translating known
 * registry slugs.
 */
export function humanizeSlug(slug: string): string {
  const words = slug.split('-').filter(Boolean).join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
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

/**
 * Category facet options (issue 04 follow-up) — the activity-category rollup, a
 * higher-level grouping above the Activity facet. The five canonical
 * `ActivityCategory` values are the form-submitted slugs (e.g. `category=water`)
 * and ALSO the i18n key suffixes under `SearchPage.filters.categoryOptions`.
 * Listed explicitly (not derived from `listActivities()`) so the full category
 * vocabulary is offered even when no current activity maps to a given category
 * (e.g. `urban`) — they line up with the `category` index attribute derived in
 * the indexer.
 */
const CATEGORY_SLUGS: readonly ActivityCategory[] = [
  'water',
  'aerial',
  'mountain',
  'wildlife',
  'urban',
]

export const CATEGORY_OPTIONS: readonly FacetOption[] = CATEGORY_SLUGS.map(
  (c) => ({ slug: c, i18nKey: c }),
)

/**
 * Destination=State facet options (issue 04 follow-up). The distinct Indian
 * states across the regions registry — Switchback is India-only, so there is no
 * Country dropdown. The state name is BOTH the form-submitted value
 * (`state=Goa`, matching the derived `state` index attribute) and the display
 * label: state names are proper nouns kept as registry literals rather than
 * translated 13× (the issue explicitly allows this). Sorted for stable order.
 */
export interface StateOption {
  /** Indian state name — submitted as `state=<name>` and shown as the label. */
  readonly name: string
}

export const STATE_OPTIONS: readonly StateOption[] = [
  ...new Set(listRegions().map((r) => r.state)),
]
  .sort((a, b) => a.localeCompare(b))
  .map((name) => ({ name }))
