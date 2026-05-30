/**
 * Listing completeness scorer (pure).
 *
 * Computes a real "% of required fields filled" for a Vendor's Experience,
 * powering the completeness ring on the listings index (#75, DESIGN.md §4 A3,
 * direction A "Guided Builder"). Every field counted here is an actual column
 * on the `experiences` table (db/schema/experiences.ts) or its linked
 * `media_assets` rows — no fabricated signals.
 *
 * The required-field set is the minimum a Vendor must supply for a
 * decision-complete public listing, matching what the vendor editor writes:
 *   - title                 (the headline)
 *   - shortDescription      (card/teaser copy)
 *   - longDescription       (the PDP body)
 *   - the three Group-size bracket prices (ADR-0011: 1-2 / 3-5 / 6+)
 *   - activitySlug, regionSlug (ADR-0013 taxonomy)
 *   - imageCount            (≥1 media asset — a listing with no photo is thin)
 *
 * Optional capabilities (permits, safety stack, combo) are deliberately NOT
 * required: a listing that legitimately needs no permit must still be able to
 * reach 100%, so penalising their absence would be fabrication.
 */

/** The ordered set of fields that count toward completeness. */
export const LISTING_COMPLETENESS_FIELDS = [
  'title',
  'shortDescription',
  'longDescription',
  'pricePerPerson_1_2',
  'pricePerPerson_3_5',
  'pricePerPerson_6_plus',
  'activitySlug',
  'regionSlug',
  'imageCount',
] as const

export type ListingCompletenessField = (typeof LISTING_COMPLETENESS_FIELDS)[number]

/**
 * The subset of an Experience read needed to score completeness. Numeric
 * columns arrive from Drizzle as `string` (numeric precision) or `null`.
 */
export interface ListingCompletenessInput {
  title: string | null
  shortDescription: string | null
  longDescription: string | null
  pricePerPerson_1_2: string | number | null
  pricePerPerson_3_5: string | number | null
  pricePerPerson_6_plus: string | number | null
  activitySlug: string | null
  regionSlug: string | null
  imageCount: number
}

export interface ListingCompleteness {
  /** Number of required fields that are filled. */
  filled: number
  /** Total number of required fields (= LISTING_COMPLETENESS_FIELDS.length). */
  total: number
  /** Rounded percentage in [0, 100]. */
  percent: number
  /** The required fields that are NOT filled. */
  missing: ListingCompletenessField[]
}

/** A non-empty, non-whitespace string counts as filled. */
function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/** A price bracket counts as filled only when it parses to a positive amount. */
function hasPositivePrice(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0
}

/**
 * Score one Experience's completeness from its actual fields. Pure — no I/O,
 * no mutation; safe to unit-test and to call per row in a Server Component.
 */
export function computeListingCompleteness(
  input: ListingCompletenessInput,
): ListingCompleteness {
  const checks: Record<ListingCompletenessField, boolean> = {
    title: hasText(input.title),
    shortDescription: hasText(input.shortDescription),
    longDescription: hasText(input.longDescription),
    pricePerPerson_1_2: hasPositivePrice(input.pricePerPerson_1_2),
    pricePerPerson_3_5: hasPositivePrice(input.pricePerPerson_3_5),
    pricePerPerson_6_plus: hasPositivePrice(input.pricePerPerson_6_plus),
    activitySlug: hasText(input.activitySlug),
    regionSlug: hasText(input.regionSlug),
    imageCount: input.imageCount > 0,
  }

  const missing = LISTING_COMPLETENESS_FIELDS.filter((field) => !checks[field])
  const total = LISTING_COMPLETENESS_FIELDS.length
  const filled = total - missing.length
  const percent = Math.round((filled / total) * 100)

  return { filled, total, percent, missing }
}
