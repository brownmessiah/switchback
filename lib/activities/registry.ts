/**
 * Activity registry per ADR-0013.
 *
 * Controlled vocabulary of (activity_slug, display_name_per_locale)
 * pairs. Activity slugs are NOT vendor-chosen — they appear in the
 * canonical activity-city collection URL pattern and feed into the
 * pricing / commission / safety-stack registries elsewhere.
 *
 * Each activity also carries a `category` to roll up for SEO group
 * pages ("water sports", "aerial", "trekking" etc.) and a
 * `requiresSafetyStack` flag for the per-Booking safety-stack
 * activation per ADR-0015. Vendors cannot self-toggle this flag.
 */

export interface ActivityDisplay {
  en: string
  hi: string
}

export type ActivityCategory =
  | 'water'
  | 'aerial'
  | 'mountain'
  | 'wildlife'
  | 'urban'

export interface ActivityMeta {
  slug: string
  displayName: ActivityDisplay
  category: ActivityCategory
  /** Triggers the safety stack per ADR-0015 — trusted contact, SOS, check-in pings. */
  requiresSafetyStack: boolean
}

const ACTIVITIES: readonly ActivityMeta[] = [
  {
    slug: 'rafting',
    displayName: { en: 'Rafting', hi: 'राफ्टिंग' },
    category: 'water',
    requiresSafetyStack: true,
  },
  {
    slug: 'paragliding',
    displayName: { en: 'Paragliding', hi: 'पैराग्लाइडिंग' },
    category: 'aerial',
    requiresSafetyStack: true,
  },
  {
    slug: 'scuba-diving',
    displayName: { en: 'Scuba Diving', hi: 'स्कूबा डाइविंग' },
    category: 'water',
    requiresSafetyStack: true,
  },
  {
    slug: 'trekking',
    displayName: { en: 'Trekking', hi: 'ट्रेकिंग' },
    category: 'mountain',
    requiresSafetyStack: true,
  },
  {
    slug: 'bungee-jumping',
    displayName: { en: 'Bungee Jumping', hi: 'बंजी जंपिंग' },
    category: 'aerial',
    requiresSafetyStack: true,
  },
  {
    slug: 'skiing',
    displayName: { en: 'Skiing', hi: 'स्कीइंग' },
    category: 'mountain',
    requiresSafetyStack: true,
  },
  {
    slug: 'kayaking',
    displayName: { en: 'Kayaking', hi: 'कयाकिंग' },
    category: 'water',
    requiresSafetyStack: true,
  },
  {
    slug: 'rock-climbing',
    displayName: { en: 'Rock Climbing', hi: 'रॉक क्लाइम्बिंग' },
    category: 'mountain',
    requiresSafetyStack: true,
  },
  {
    slug: 'safari',
    displayName: { en: 'Wildlife Safari', hi: 'वन्यजीव सफारी' },
    category: 'wildlife',
    requiresSafetyStack: false,
  },
  {
    slug: 'camping',
    displayName: { en: 'Camping', hi: 'कैम्पिंग' },
    category: 'mountain',
    requiresSafetyStack: false,
  },
]

const ACTIVITIES_BY_SLUG = new Map(ACTIVITIES.map((a) => [a.slug, a]))

export function listActivities(): readonly ActivityMeta[] {
  return ACTIVITIES
}

export function getActivity(slug: string): ActivityMeta | undefined {
  return ACTIVITIES_BY_SLUG.get(slug)
}

export function isActivitySlug(value: unknown): value is string {
  return typeof value === 'string' && ACTIVITIES_BY_SLUG.has(value)
}
