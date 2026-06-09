/**
 * TouristDestination JSON-LD per ADR-0013. Composed into city landing pages
 * (`/destinations/{slug}`) alongside ItemList, FAQPage, and BreadcrumbList.
 *
 * `geo` comes from the region's REAL city centroid (issue 11,
 * `lib/maps/region-coords.ts`) — a verifiable public coordinate, never a
 * fabricated per-Experience pin. When a region has no known centroid the geo
 * block is OMITTED rather than invented (D0). `containedInPlace` is the Indian
 * state from the region registry.
 */

export interface DestinationGeo {
  readonly lat: number
  readonly lng: number
}

export interface TouristDestinationArgs {
  name: string
  description: string
  url: string
  /** Indian state from the region registry → containedInPlace. */
  state: string
  /** Real city centroid; omit (undefined) when none is known (D0). */
  geo?: DestinationGeo
}

interface GeoCoordinatesBlock {
  '@type': 'GeoCoordinates'
  latitude: number
  longitude: number
}

interface AdministrativeAreaBlock {
  '@type': 'AdministrativeArea'
  name: string
}

export interface TouristDestinationJsonLd {
  '@context': 'https://schema.org'
  '@type': 'TouristDestination'
  name: string
  description: string
  url: string
  containedInPlace: AdministrativeAreaBlock
  geo?: GeoCoordinatesBlock
}

export function touristDestination(
  args: TouristDestinationArgs,
): TouristDestinationJsonLd {
  if (!args.name.trim()) throw new Error('touristDestination name must be non-empty')
  if (!args.url.trim()) throw new Error('touristDestination url must be non-empty')

  const result: TouristDestinationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TouristDestination',
    name: args.name,
    description: args.description,
    url: args.url,
    containedInPlace: {
      '@type': 'AdministrativeArea',
      name: args.state,
    },
  }

  if (args.geo) {
    result.geo = {
      '@type': 'GeoCoordinates',
      latitude: args.geo.lat,
      longitude: args.geo.lng,
    }
  }

  return result
}
