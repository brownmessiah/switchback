'use client'

import type { ReactElement } from 'react'

import L from 'leaflet'
import { MapContainer, Marker, TileLayer } from 'react-leaflet'

import 'leaflet/dist/leaflet.css'

import type { SinglePinMapLoaderProps } from './single-pin-map-loader'

/**
 * Single-pin Leaflet + OpenStreetMap map (Issue 15, decision D0).
 *
 * Client-only (loaded via `single-pin-map-loader` with `ssr: false`, because
 * Leaflet touches `window` at import time). Renders ONE pin at the REGION
 * centroid for a PDP meeting point — an APPROXIMATE city-level area, NOT a
 * precise meeting-point coordinate. The honest disclaimer + free-text address
 * live in the PDP section around this map.
 *
 * No API key / billing — OpenStreetMap tiles are free.
 */
export function SinglePinMap({
  lat,
  lng,
  ariaLabel,
}: SinglePinMapLoaderProps): ReactElement {
  // A simple dot pin (divIcon) avoids Leaflet's default-marker image-path issue
  // and signals "approximate area" rather than a precise address marker.
  const icon = L.divIcon({
    className: 'meeting-point-pin',
    html: '<span class="meeting-point-pin__dot" aria-hidden="true"></span>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })

  return (
    <div
      data-testid="meeting-point-map"
      className="overflow-hidden rounded-[var(--radius-card)] border border-border"
    >
      <MapContainer
        center={[lat, lng]}
        zoom={11}
        scrollWheelZoom={false}
        className="h-56 w-full"
        aria-label={ariaLabel}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[lat, lng]} icon={icon} />
      </MapContainer>
    </div>
  )
}
