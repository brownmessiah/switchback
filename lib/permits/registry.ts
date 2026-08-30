/**
 * Permit registry per ADR-0011 (Required permits).
 *
 * `experiences.required_permits[]` holds controlled permit slugs chosen by
 * the Vendor from this catalogue. The registry is the single source that
 * resolves a slug into the metadata the Booking Permits panel surfaces:
 * official name, issuing authority, official application URL, processing
 * time, indicative cost, validity, and a short description.
 *
 * Per ADR-0011 Switchback does NOT broker permits in v1 — the panel is purely
 * informational, paired with a mandatory acknowledgement at checkout
 * (enforced by `booking-create.ts` via `acknowledgedPermits`). Adding a
 * permit is a code change in v1, mirroring the regions registry (ADR-0013):
 * the controlled vocabulary keeps the data trustworthy and prevents
 * Vendors from inventing permit slugs that would render as bare strings to
 * a Customer.
 */

export interface PermitMeta {
  /** Stable lower_snake_case slug stored in experiences.required_permits[]. */
  slug: string
  /** Official permit name as the issuing authority uses it. */
  name: string
  /** The government body that issues the permit. */
  authority: string
  /** Official application / information URL. */
  officialUrl: string
  /** Indicative processing / turnaround time, human-readable. */
  processingTime: string
  /** Indicative cost, human-readable (varies by nationality/duration). */
  indicativeCost: string
  /** How long the permit stays valid once issued. */
  validity: string
  /** One-line description of what the permit covers + who needs it. */
  description: string
}

const PERMITS: readonly PermitMeta[] = [
  {
    slug: 'ilp_sikkim',
    name: 'Sikkim Inner Line Permit (ILP)',
    authority: 'Government of Sikkim — Tourism & Civil Aviation Department',
    officialUrl: 'https://sikkimtourism.org/entry-formalities-for-sikkim/',
    processingTime: 'Same day at entry checkposts; 1-2 days online',
    indicativeCost: 'Free for Indian nationals; nominal fee for foreign nationals',
    validity: '30 days, extendable',
    description:
      'Required to enter Sikkim and its protected areas (Tsomgo Lake, Nathula, North Sikkim). Indian nationals carry photo ID; foreign nationals apply via Sikkim Tourism offices or Indian missions.',
  },
  {
    slug: 'ilp_arunachal_pradesh',
    name: 'Arunachal Pradesh Inner Line Permit (eILP)',
    authority: 'Government of Arunachal Pradesh — Department of Political (ILP)',
    officialUrl: 'https://www.eilp.arunachal.gov.in/',
    processingTime: '1-3 working days online',
    indicativeCost: 'Approx. Rs.100 per Indian national; foreign nationals need PAP/RAP instead',
    validity: '30 days from date of entry',
    description:
      'Mandatory for Indian citizens entering Arunachal Pradesh. Apply through the state eILP portal. Foreign nationals require a Protected/Restricted Area Permit (PAP/RAP) instead.',
  },
  {
    slug: 'forest_entry',
    name: 'Forest Entry Permit',
    authority: 'State Forest Department (jurisdiction of the trek/route)',
    officialUrl: 'https://forest.gov.in/',
    processingTime: '1-7 days depending on the range office',
    indicativeCost: 'Rs.150-500 per person per day (varies by forest division)',
    validity: 'Duration of the booked itinerary',
    description:
      'Required to enter reserved/protected forest areas for treks and camping. Issued by the divisional/range forest office with jurisdiction over the route.',
  },
  {
    slug: 'wildlife_corbett',
    name: 'Jim Corbett National Park Entry Permit',
    authority: 'Uttarakhand Forest Department — Corbett Tiger Reserve',
    officialUrl: 'https://www.corbettonline.uk.gov.in/',
    processingTime: 'Online booking up to 45 days in advance; instant on payment',
    indicativeCost: 'Rs.200-450 per Indian national per zone; higher for foreign nationals',
    validity: 'Single dated entry for the booked safari zone/slot',
    description:
      'Zone-wise entry permit for safaris inside Corbett Tiger Reserve. Permits are zone- and date-specific and capped per slot; book early in peak season.',
  },
  {
    slug: 'forest_department',
    name: 'Forest Department Activity Permit',
    authority: 'State Forest Department (activity jurisdiction)',
    officialUrl: 'https://forest.gov.in/',
    processingTime: '1-7 days depending on the range office',
    indicativeCost: 'Varies by activity and forest division',
    validity: 'Duration of the booked activity',
    description:
      'General activity clearance issued by the State Forest Department for adventure activities conducted within forest jurisdiction.',
  },
]

const PERMITS_BY_SLUG = new Map(PERMITS.map((p) => [p.slug, p]))

/** Full catalogue, in declaration order. */
export function listPermits(): readonly PermitMeta[] {
  return PERMITS
}

/** Resolve a single permit slug to its metadata, or undefined if unknown. */
export function getPermit(slug: string): PermitMeta | undefined {
  return PERMITS_BY_SLUG.get(slug)
}

/** Type guard: is `value` a known permit slug? */
export function isPermitSlug(value: unknown): value is string {
  return typeof value === 'string' && PERMITS_BY_SLUG.has(value)
}

export interface ResolvedPermits {
  /** Metadata for each known slug, in the order the Experience listed them. */
  resolved: PermitMeta[]
  /** Slugs that have no catalogue entry — surfaced, never silently dropped. */
  unknown: string[]
}

/**
 * Resolve an Experience's `required_permits[]` into the Permits panel
 * payload. Known slugs map to full metadata (preserving input order);
 * unknown slugs are reported separately so the UI / ops can flag a stale
 * catalogue rather than render a bare slug.
 */
export function resolvePermits(slugs: readonly string[]): ResolvedPermits {
  const resolved: PermitMeta[] = []
  const unknown: string[] = []
  for (const slug of slugs) {
    const meta = PERMITS_BY_SLUG.get(slug)
    if (meta) {
      resolved.push(meta)
    } else {
      unknown.push(slug)
    }
  }
  return { resolved, unknown }
}
