/**
 * Organization JSON-LD per ADR-0013.
 *
 * Describes Outvers itself (the marketplace platform — Organization = Outvers,
 * never a Vendor). Emitted on the home page alongside the WebSite node, and on
 * lower-tier Vendor profiles via the `vendorEntity` generator.
 *
 * Data honesty (D0): `logo`, `contactPoint`, and `sameAs` are all OPTIONAL and
 * only appear when a real asset/email/social URL exists. We never fabricate a
 * logo path or invent social-profile URLs — the site footer's social links are
 * still placeholders, so `sameAs` is omitted until real accounts exist.
 */

export interface OrganizationArgs {
  url: string
  /** Optional real logo asset URL. Omitted when no brand logo is published. */
  logo?: string
  /** Optional customer-support email (e.g. support@outvers.com). */
  contactEmail?: string
  /** Optional real social-profile URLs. Empty / undefined → omitted (D0). */
  sameAs?: string[]
  description?: string
}

interface ContactPointBlock {
  '@type': 'ContactPoint'
  contactType: 'customer support'
  email: string
}

export interface OrganizationJsonLd {
  '@context': 'https://schema.org'
  '@type': 'Organization'
  name: 'Outvers'
  url: string
  logo?: string
  description?: string
  contactPoint?: ContactPointBlock
  sameAs?: string[]
}

export function organization(args: OrganizationArgs): OrganizationJsonLd {
  if (!args.url.trim()) throw new Error('organization url must be non-empty')

  const result: OrganizationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Outvers',
    url: args.url,
  }

  if (args.logo) {
    result.logo = args.logo
  }
  if (args.description) {
    result.description = args.description
  }
  if (args.contactEmail) {
    result.contactPoint = {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: args.contactEmail,
    }
  }
  if (args.sameAs && args.sameAs.length > 0) {
    result.sameAs = args.sameAs
  }

  return result
}
