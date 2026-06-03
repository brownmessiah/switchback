/**
 * Derived duration-band bucket for the customer search facet (ADR-0017, issue
 * 04). The raw `durationMinutes` scalar is too granular to facet on directly,
 * so we index a coarse band the filter UI can offer as a handful of options.
 *
 * IMPORTANT: this module is intentionally dependency-free (no `lib/env`, no
 * Meilisearch client). The E2E global-setup helper (`tests/e2e/helpers/
 * meili-setup.ts`) imports it to map seeded rows, and that file runs before
 * `.env.local` is loaded — pulling in any env-validating module would crash
 * global-setup. Keep this file pure.
 *
 * Bands (minutes, inclusive upper bounds):
 *   null / non-positive → null      (bare Experience — drops out of a band filter)
 *   1 .. 180            → 'upto_3h'  (a short morning/evening activity)
 *   181 .. 360          → 'half_day'
 *   361 .. 1439         → 'full_day'
 *   >= 1440             → 'multi_day' (a full calendar day or more)
 */

/** Canonical band values, in ascending duration order. Double as facet
 * option values AND the i18n key suffixes (`SearchPage.filters.durationBands.*`). */
export const DURATION_BANDS = ['upto_3h', 'half_day', 'full_day', 'multi_day'] as const

export type DurationBand = (typeof DURATION_BANDS)[number]

export function durationBand(minutes: number | null): DurationBand | null {
  if (minutes === null || minutes <= 0) return null
  if (minutes <= 180) return 'upto_3h'
  if (minutes <= 360) return 'half_day'
  if (minutes < 1440) return 'full_day'
  return 'multi_day'
}
