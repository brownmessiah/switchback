import type { SearchExperiencesParams } from './search-experiences'

/**
 * Active-filter chips (issue 10).
 *
 * `deriveActiveFilterChips` is a PURE function: given the parsed search params,
 * it returns one removable chip descriptor per APPLIED result-narrowing filter.
 * The UI renders each chip and, on dismiss, navigates with `removeParams`
 * deleted from the query string (removing ONLY that filter). Keeping the
 * derivation pure makes it unit-testable without i18n / the router and keeps
 * the chip list in lock-step with the facet form.
 *
 * Label resolution lives in the UI: a chip carries the raw `value` / numeric
 * fields and a `kind`, so the component resolves the localised option label
 * (activity/region names, month, difficulty, etc.) against the same registries
 * the facet form uses — no English leaks into this module.
 *
 * `q` (the search query) and `sort` (an ordering, not a filter) are NOT chips.
 * Price min+max collapse to a SINGLE chip whose dismiss clears both bounds.
 *
 * There is deliberately NO "Instant confirmation" chip — every paid Booking
 * confirms instantly (ADR-0003), so it is universally true and stays a trust
 * BADGE only (issue 05), never a filter.
 */

/** The filter dimension a chip represents (drives the UI label + formatting). */
export type ActiveFilterKind =
  | 'category'
  | 'state'
  | 'region'
  | 'activity'
  | 'difficulty'
  | 'durationBand'
  | 'season'
  | 'groupSize'
  | 'price'
  | 'rating'
  | 'safety'
  | 'cancellation'
  | 'date'

export interface ActiveFilterChip {
  /** Stable identity for React keys (the param name, or `price` for the range). */
  key: string
  /** Filter dimension — the UI keys its label + formatting off this. */
  kind: ActiveFilterKind
  /** Raw string value for slug/enum-valued chips (activity/region/state/etc.). */
  value?: string
  /** Numeric threshold for the rating chip (`ratingAvg >= N`). */
  ratingValue?: number
  /** Lower price bound (rupees), when set. */
  priceMin?: number
  /** Upper price bound (rupees), when set. */
  priceMax?: number
  /** Season month (1-12), for the season chip. */
  seasonMonth?: number
  /** "Fits a group of N" lower bound, for the group-size chip. */
  groupSize?: number
  /** URL searchParam name(s) to delete on dismiss (removes ONLY this filter). */
  removeParams: string[]
}

/**
 * Derive the ordered list of removable active-filter chips for the current
 * search. Order mirrors the facet form's information hierarchy so the chip row
 * reads predictably. Only APPLIED filters yield a chip; `safetyVerified: false`
 * (the unchecked control) is an unset filter and yields nothing.
 */
export function deriveActiveFilterChips(
  params: SearchExperiencesParams,
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = []

  // Bookable-on-date (home-redesign issue 10 / ADR-0020). Leads the row —
  // without a chip the date silently sticks across every later refinement
  // (FacetForm/SearchBox merge-preserve the live query) with no way to see
  // or clear it.
  if (params.date) {
    chips.push({
      key: 'date',
      kind: 'date',
      value: params.date,
      removeParams: ['date'],
    })
  }

  if (params.category) {
    chips.push({
      key: 'category',
      kind: 'category',
      value: params.category,
      removeParams: ['category'],
    })
  }
  if (params.state) {
    chips.push({
      key: 'state',
      kind: 'state',
      value: params.state,
      removeParams: ['state'],
    })
  }
  if (params.region) {
    chips.push({
      key: 'region',
      kind: 'region',
      value: params.region,
      removeParams: ['region'],
    })
  }
  if (params.activity) {
    chips.push({
      key: 'activity',
      kind: 'activity',
      value: params.activity,
      removeParams: ['activity'],
    })
  }
  if (params.difficulty) {
    chips.push({
      key: 'difficulty',
      kind: 'difficulty',
      value: params.difficulty,
      removeParams: ['difficulty'],
    })
  }
  if (params.durationBand) {
    chips.push({
      key: 'durationBand',
      kind: 'durationBand',
      value: params.durationBand,
      removeParams: ['durationBand'],
    })
  }
  if (params.seasonMonth !== undefined) {
    chips.push({
      key: 'season',
      kind: 'season',
      seasonMonth: params.seasonMonth,
      // URL param is `season`; parsed field is `seasonMonth`.
      removeParams: ['season'],
    })
  }
  if (params.maxGroupSize !== undefined) {
    chips.push({
      key: 'groupSize',
      kind: 'groupSize',
      groupSize: params.maxGroupSize,
      // URL param is `groupSize`; parsed field is `maxGroupSize`.
      removeParams: ['groupSize'],
    })
  }
  // Price min + max collapse to a single chip; dismiss clears BOTH bounds.
  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    chips.push({
      key: 'price',
      kind: 'price',
      priceMin: params.minPrice,
      priceMax: params.maxPrice,
      removeParams: ['minPrice', 'maxPrice'],
    })
  }
  // Issue 10 trust-oriented filters.
  if (params.minRating !== undefined) {
    chips.push({
      key: 'minRating',
      kind: 'rating',
      ratingValue: params.minRating,
      removeParams: ['minRating'],
    })
  }
  if (params.safetyVerified) {
    chips.push({
      key: 'safetyVerified',
      kind: 'safety',
      removeParams: ['safetyVerified'],
    })
  }
  if (params.cancellation) {
    chips.push({
      key: 'cancellation',
      kind: 'cancellation',
      value: params.cancellation,
      removeParams: ['cancellation'],
    })
  }

  return chips
}
