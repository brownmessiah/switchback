'use client'

import type { ReactElement } from 'react'

import dynamic from 'next/dynamic'

export interface SinglePinMapLoaderProps {
  /** Latitude of the region centroid (approximate-area pin). */
  readonly lat: number
  /** Longitude of the region centroid. */
  readonly lng: number
  /** Already-translated accessible name for the map region. */
  readonly ariaLabel: string
}

/**
 * Client-only loader for the single-pin Leaflet map (Issue 15, decision D0).
 *
 * Leaflet touches `window` at import time, so the map MUST be loaded with
 * `ssr: false`. Per the Next 16 lazy-loading guide, `ssr: false` is only valid
 * inside a Client Component — hence this `'use client'` wrapper around
 * `next/dynamic`. The loading fallback reserves the map's height so the PDP
 * meeting-point section does not shift layout.
 */
const SinglePinMap = dynamic(
  () => import('./single-pin-map').then((mod) => mod.SinglePinMap),
  {
    ssr: false,
    loading: () => (
      <div
        data-testid="meeting-point-map-loading"
        aria-hidden="true"
        className="h-56 w-full animate-pulse rounded-[var(--radius-card)] bg-muted"
      />
    ),
  },
)

export function SinglePinMapLoader(
  props: SinglePinMapLoaderProps,
): ReactElement {
  return <SinglePinMap {...props} />
}
