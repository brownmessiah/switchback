/**
 * TouristTrip JSON-LD generator per ADR-0013.
 *
 * Composed onto the Experience detail page (PDP) ALONGSIDE the Product node
 * (lib/seo/schemas/product.ts) to give search engines a Trip-shaped view of a
 * structured Experience: its ordered itinerary steps and total duration. Only
 * emitted when there's something structured to say (itinerary and/or duration);
 * the page skips the node entirely otherwise.
 *
 * Duration is encoded as an ISO-8601 duration. The mapping is intentionally
 * simple and total over the minute domain:
 *   - whole-day counts (minutes % 1440 === 0) → `P{n}D`  (e.g. 1440 → "P1D")
 *   - everything else → `PT{h}H{m}M`, emitting only the non-zero units
 *     (e.g. 180 → "PT3H", 90 → "PT1H30M", 45 → "PT45M")
 * Inputs are positive minute counts (durationMinutesSchema enforces ≥ 15), so
 * the `PT0M` degenerate case never arises.
 */

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 1440

export interface TouristTripStep {
  name: string
  description?: string | null
}

export interface TouristTripArgs {
  name: string
  description?: string | null
  /** Ordered itinerary steps; rendered as a 1-based ItemList in array order. */
  itinerary?: TouristTripStep[]
  /** Total duration in minutes; encoded as ISO-8601. Null/undefined → omitted. */
  durationMinutes?: number | null
}

interface TouristAttractionBlock {
  '@type': 'TouristAttraction'
  name: string
  description?: string
}

interface ItineraryItemBlock {
  '@type': 'ListItem'
  position: number
  item: TouristAttractionBlock
}

interface ItineraryListBlock {
  '@type': 'ItemList'
  itemListElement: ItineraryItemBlock[]
}

export interface TouristTripJsonLd {
  '@context': 'https://schema.org'
  '@type': 'TouristTrip'
  name: string
  description?: string
  itinerary?: ItineraryListBlock
  duration?: string
}

/**
 * Encode a positive minute count as an ISO-8601 duration. Whole days collapse
 * to `P{n}D`; otherwise hours + minutes render as `PT{h}H{m}M` (non-zero units
 * only).
 */
function toIso8601Duration(minutes: number): string {
  if (minutes % MINUTES_PER_DAY === 0) {
    return `P${minutes / MINUTES_PER_DAY}D`
  }

  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  const mins = minutes % MINUTES_PER_HOUR

  let result = 'PT'
  if (hours > 0) result += `${hours}H`
  if (mins > 0) result += `${mins}M`
  return result
}

export function touristTrip(args: TouristTripArgs): TouristTripJsonLd {
  if (!args.name.trim()) throw new Error('touristTrip name must be non-empty')

  const result: TouristTripJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: args.name,
  }

  if (args.description) {
    result.description = args.description
  }

  if (args.itinerary && args.itinerary.length > 0) {
    result.itinerary = {
      '@type': 'ItemList',
      itemListElement: args.itinerary.map((step, index) => {
        const item: TouristAttractionBlock = {
          '@type': 'TouristAttraction',
          name: step.name,
        }
        if (step.description) item.description = step.description
        return {
          '@type': 'ListItem',
          position: index + 1,
          item,
        }
      }),
    }
  }

  if (typeof args.durationMinutes === 'number') {
    result.duration = toIso8601Duration(args.durationMinutes)
  }

  return result
}
