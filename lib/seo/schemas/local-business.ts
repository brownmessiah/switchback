/**
 * Vendor-entity JSON-LD per ADR-0013, composed into Vendor profile pages
 * (`/vendor/{slug}`) alongside BreadcrumbList.
 *
 * The schema TYPE is gated by the Vendor's KYC tier (ADR-0007):
 *   - Business-verified (tier 3, `kycTier === 'business'`) → `LocalBusiness`.
 *   - Lower tiers (`identity`, `phone`) → `Organization`.
 *
 * A Vendor is NEVER an "operator" in schema — it is a LocalBusiness or
 * Organization. `aggregateRating` is included ONLY when real published reviews
 * exist (D0): a zero / undefined review count omits the block entirely; we
 * never fabricate a ratingValue or reviewCount.
 */

export type VendorKycTier = 'phone' | 'identity' | 'business'

export interface VendorEntityArgs {
  name: string
  url: string
  kycTier: VendorKycTier
  /** Average rating 0..5 across the Vendor's published reviews. */
  ratingValue?: number
  /** Count of real published reviews. Zero / undefined → no aggregateRating. */
  ratingCount?: number
}

interface AggregateRatingBlock {
  '@type': 'AggregateRating'
  ratingValue: number
  ratingCount: number
}

export interface VendorEntityJsonLd {
  '@context': 'https://schema.org'
  '@type': 'LocalBusiness' | 'Organization'
  name: string
  url: string
  aggregateRating?: AggregateRatingBlock
}

export function vendorEntity(args: VendorEntityArgs): VendorEntityJsonLd {
  if (!args.name.trim()) throw new Error('vendorEntity name must be non-empty')
  if (!args.url.trim()) throw new Error('vendorEntity url must be non-empty')

  const result: VendorEntityJsonLd = {
    '@context': 'https://schema.org',
    '@type': args.kycTier === 'business' ? 'LocalBusiness' : 'Organization',
    name: args.name,
    url: args.url,
  }

  if (
    typeof args.ratingValue === 'number' &&
    typeof args.ratingCount === 'number' &&
    args.ratingCount > 0
  ) {
    result.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: args.ratingValue,
      ratingCount: args.ratingCount,
    }
  }

  return result
}
