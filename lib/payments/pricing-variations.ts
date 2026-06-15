/**
 * Pure helpers for named pricing variations (ADR-0011 revision 2026-06-16,
 * issue #07). No DB access here — the resolver in `pricing-resolver.ts` does
 * the money-path lookup + snapshot; this module only derives the "From ₹X"
 * entry price used by listing cards (issue #08 consumes it).
 *
 * `price_per_person` is numeric(12,2) carried as a STRING throughout — never a
 * JS float — so the returned value is the exact column string (no round-trip).
 */

/** The minimal shape needed to derive the entry price. */
export interface VariationPriceRow {
  pricePerPerson: string
  isActive: boolean
}

/**
 * The lowest `price_per_person` among ACTIVE variations, returned as the exact
 * column string. Inactive variations are ignored. When there are no active
 * variations, the `fallback` is returned unchanged (base / lowest bracket).
 *
 * Comparison is NUMERIC (parseFloat), not lexicographic, so '900.00' sorts
 * below '1000.00'. The returned value is the original string of the winning
 * row (not a re-formatted number), preserving precision.
 */
export function fromPriceRupees<F extends number | string>(
  variations: ReadonlyArray<VariationPriceRow>,
  fallback: F,
): F | string {
  let lowest: VariationPriceRow | undefined
  for (const v of variations) {
    if (!v.isActive) continue
    if (lowest === undefined || Number(v.pricePerPerson) < Number(lowest.pricePerPerson)) {
      lowest = v
    }
  }
  return lowest === undefined ? fallback : lowest.pricePerPerson
}
