'use client'

import type { ReactElement, ReactNode } from 'react'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { List, MapPin } from 'lucide-react'

import type { MapPin as ExperiencePin } from '@/lib/maps/pins'
import { cn } from '@/lib/utils'

import { ExperienceMapLoader } from './experience-map-loader'

export interface ResultsViewLabels {
  /** Accessible label for the List control. */
  readonly list: string
  /** Accessible label for the Map control. */
  readonly map: string
  /** Accessible group label ("List / Map"). */
  readonly groupLabel: string
  /** Mini-card CTA — "View Experience". Forwarded to the map. */
  readonly viewExperience?: string
  /** "Open in Maps" deep-link label. Forwarded to the map. */
  readonly openInMaps?: string
  /** "from ₹{price}" pin price label is built by the map; the prefix word. */
  readonly fromPrice?: string
  /** Honest disclaimer: pins are at the city centre, not the exact meeting point. */
  readonly cityLevelNote?: string
}

interface ResultsViewProps {
  /** Pins derived server-side from the SAME filtered hits (`lib/maps`). */
  readonly pins: readonly ExperiencePin[]
  /** Whether the map view is active (parsed from `?map=1` on the server). */
  readonly mapActive: boolean
  readonly labels: ResultsViewLabels
  /** The server-rendered list/grid results, shown in the list view. */
  readonly children: ReactNode
}

/**
 * List/map results toggle (Issue 11, decision D4).
 *
 * Switches the results region between the server-rendered list/grid (the
 * default — keeps mobile list-default, ADR-0018) and a client-only Leaflet map.
 * The active view is URL state (`?map=1`) so it is shareable and SSR-decided;
 * toggling back to list drops ONLY the `map` param, preserving every active
 * filter (so the map and list show the SAME filtered result set).
 *
 * The map is loaded via a client-only dynamic import (`ssr: false`) because
 * Leaflet needs `window`. The pin / mini-card LOGIC lives in `lib/maps` and is
 * unit-tested; this component is thin glue.
 */
export function ResultsView({
  pins,
  mapActive,
  labels,
  children,
}: ResultsViewProps): ReactElement {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setMap(active: boolean): void {
    const sp = new URLSearchParams(searchParams.toString())
    if (active) sp.set('map', '1')
    else sp.delete('map')
    const qs = sp.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const buttonClass = (active: boolean): string =>
    cn(
      'min-tap flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      active
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <div
          role="group"
          aria-label={labels.groupLabel}
          data-testid="results-view-toggle"
          className="flex items-center gap-1 rounded-[var(--radius-control)] border border-border p-1"
        >
          <button
            type="button"
            aria-label={labels.list}
            aria-pressed={!mapActive}
            onClick={() => setMap(false)}
            className={buttonClass(!mapActive)}
          >
            <List className="size-4" aria-hidden="true" />
            <span>{labels.list}</span>
          </button>
          <button
            type="button"
            aria-label={labels.map}
            aria-pressed={mapActive}
            onClick={() => setMap(true)}
            className={buttonClass(mapActive)}
          >
            <MapPin className="size-4" aria-hidden="true" />
            <span>{labels.map}</span>
          </button>
        </div>
      </div>

      {mapActive ? (
        <ExperienceMapLoader
          pins={pins}
          viewExperienceLabel={labels.viewExperience ?? 'View Experience'}
          openInMapsLabel={labels.openInMaps ?? 'Open in Maps'}
          fromPriceLabel={labels.fromPrice ?? 'from ₹'}
          cityLevelNote={labels.cityLevelNote}
        />
      ) : (
        children
      )}
    </div>
  )
}
