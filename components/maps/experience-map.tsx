'use client'

import { useMemo, type ReactElement } from 'react'

import Link from 'next/link'
import L from 'leaflet'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'

import { buildMapsDeepLink } from '@/lib/maps/deep-link'
import type { MapPin } from '@/lib/maps/pins'

import 'leaflet/dist/leaflet.css'

import type { ExperienceMapLoaderProps } from './experience-map-loader'

/** India-wide fallback centre (geographic centroid) for an empty/odd pin set. */
const INDIA_CENTER: [number, number] = [22.9734, 78.6569]
const DEFAULT_ZOOM = 5

/**
 * Leaflet + OpenStreetMap experience map (Issue 11, decision D4).
 *
 * Client-only (loaded via `experience-map-loader` with `ssr: false`). Renders a
 * price pin per Experience at its REGION centroid (coordinate honesty, D0 — this
 * is a city-level discovery map, NOT a precise meeting-point pin). Clicking a pin
 * opens a mini card with the title, starting price, activity, a "View
 * Experience" CTA to `/experience/{slug}`, and an "Open in Maps" deep link.
 *
 * No API key / billing — OpenStreetMap tiles are free.
 */
export function ExperienceMap({
  pins,
  viewExperienceLabel,
  openInMapsLabel,
  fromPriceLabel,
  cityLevelNote,
}: ExperienceMapLoaderProps): ReactElement {
  // A price `divIcon` per pin — shows the starting price directly on the map so
  // the value is legible without a click (avoids Leaflet's default-marker image
  // path issue too). Memoised so panning/zoom doesn't rebuild every icon.
  const priceIcon = useMemo(
    () =>
      (price: number): L.DivIcon =>
        L.divIcon({
          className: 'experience-price-pin',
          html: `<span class="experience-price-pin__label">₹${price.toLocaleString('en-IN')}</span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
    [],
  )

  // Centre on the first pin when present so the map opens somewhere useful;
  // otherwise show the whole country.
  const center: [number, number] =
    pins.length > 0 ? [pins[0].lat, pins[0].lng] : INDIA_CENTER
  const zoom = pins.length > 0 ? 7 : DEFAULT_ZOOM

  return (
    <div
      data-testid="experience-map"
      data-pin-count={pins.length}
      className="overflow-hidden rounded-[var(--radius-card)] border border-border"
    >
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom={false}
        className="h-[28rem] w-full"
        // The map's interactive surface is supplementary to the list; the list
        // remains the primary, fully accessible result browser.
        aria-label={viewExperienceLabel}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map((pin) => (
          <PinMarker
            key={pin.slug}
            pin={pin}
            icon={priceIcon(pin.price)}
            viewExperienceLabel={viewExperienceLabel}
            openInMapsLabel={openInMapsLabel}
            fromPriceLabel={fromPriceLabel}
          />
        ))}
      </MapContainer>
      {cityLevelNote ? (
        <p
          data-testid="map-city-level-note"
          className="border-t border-border bg-surface-1 px-4 py-2 text-xs text-muted-foreground"
        >
          {cityLevelNote}
        </p>
      ) : null}
    </div>
  )
}

interface PinMarkerProps {
  readonly pin: MapPin
  readonly icon: L.DivIcon
  readonly viewExperienceLabel: string
  readonly openInMapsLabel: string
  readonly fromPriceLabel: string
}

/** A single price pin + its mini experience-card popup. */
function PinMarker({
  pin,
  icon,
  viewExperienceLabel,
  openInMapsLabel,
  fromPriceLabel,
}: PinMarkerProps): ReactElement {
  const mapsHref = buildMapsDeepLink({ lat: pin.lat, lng: pin.lng })
  return (
    <Marker position={[pin.lat, pin.lng]} icon={icon}>
      <Popup>
        <div
          data-testid="map-mini-card"
          data-slug={pin.slug}
          className="min-w-[12rem] space-y-1.5"
        >
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            {pin.activity}
          </p>
          <p className="text-sm font-semibold leading-snug text-foreground">
            {pin.title}
          </p>
          <p className="text-sm font-bold tabular-nums text-foreground">
            {fromPriceLabel}
            {pin.price.toLocaleString('en-IN')}
          </p>
          <div className="flex flex-col gap-1 pt-1">
            <Link
              href={`/experience/${pin.slug}`}
              data-testid="map-mini-card-cta"
              className="min-tap inline-flex items-center justify-center rounded-[var(--radius-control)] bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {viewExperienceLabel}
            </Link>
            {mapsHref ? (
              <a
                href={mapsHref}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="map-mini-card-open-maps"
                className="inline-flex items-center justify-center text-xs font-medium text-primary-strong hover:underline"
              >
                {openInMapsLabel}
              </a>
            ) : null}
          </div>
        </div>
      </Popup>
    </Marker>
  )
}
