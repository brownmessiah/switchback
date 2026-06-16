/**
 * Pure listing-price validator (issue #08). An Experience must carry at least
 * one usable per-person price: a positive BASE price (the 1-2 Group-size
 * bracket) OR at least one ACTIVE pricing variation with a positive price.
 *
 * A listing with no base price and only INACTIVE (or zero-priced) variations
 * is BLOCKED — booking-create / resolvePricing would otherwise have nothing to
 * resolve. Kept DB-free so the create + edit Zod schemas (`.refine`) and the
 * client form can all enforce the identical rule.
 *
 * `pricePerPerson` is numeric(12,2) carried as a STRING; `basePrice` may be a
 * number (coerced action input) or the raw string the form holds — both are
 * parsed numerically here.
 */

/** Minimal variation shape the price rule needs. */
export interface PriceVariationInput {
  pricePerPerson: string
  isActive: boolean
}

export interface HasAtLeastOnePriceArgs {
  /** The base / 1-2 bracket price. A number, or the raw form string. */
  basePrice: number | string
  variations: ReadonlyArray<PriceVariationInput>
}

/** True when a value parses to a finite, strictly-positive number. */
function isPositiveAmount(value: number | string): boolean {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0
}

/**
 * The clear, user-facing message the schema / form surfaces when the rule
 * fails. Single source so every enforcement site reads identically.
 */
export const NO_PRICE_MESSAGE =
  'Add a base price or at least one active pricing variation.'

export function hasAtLeastOnePrice({
  basePrice,
  variations,
}: HasAtLeastOnePriceArgs): boolean {
  if (isPositiveAmount(basePrice)) return true
  return variations.some((v) => v.isActive && isPositiveAmount(v.pricePerPerson))
}
