'use client'

import type { ReactElement } from 'react'

import dynamic from 'next/dynamic'

import type { MapPin } from '@/lib/maps/pins'

export interface ExperienceMapLoaderProps {
  readonly pins: readonly MapPin[]
  /** Already-translated mini-card CTA ("View Experience"). */
  readonly viewExperienceLabel: string
  /** Already-translated "Open in Maps" deep-link label. */
  readonly openInMapsLabel: string
  /** Already-translated "from ₹" price prefix for the pin label. */
  readonly fromPriceLabel: string
  /** Already-translated honest disclaimer (pins are city-level, not exact). */
  readonly cityLevelNote?: string
}

/**
 * Client-only loader for the Leaflet map (Issue 11, decision D4).
 *
 * Leaflet touches `window` at import time, so the actual map MUST be loaded with
 * `ssr: false`. Per the Next 16 lazy-loading guide, `ssr: false` is only valid
 * inside a Client Component — hence this `'use client'` wrapper around
 * `next/dynamic`. The loading fallback reserves the map's height so the toggle
 * does not shift layout.
 */
const ExperienceMap = dynamic(
  () => import('./experience-map').then((mod) => mod.ExperienceMap),
  {
    ssr: false,
    loading: () => (
      <div
        data-testid="experience-map-loading"
        aria-hidden="true"
        className="h-[28rem] w-full animate-pulse rounded-[var(--radius-card)] bg-muted"
      />
    ),
  },
)

export function ExperienceMapLoader(props: ExperienceMapLoaderProps): ReactElement {
  return <ExperienceMap {...props} />
}
