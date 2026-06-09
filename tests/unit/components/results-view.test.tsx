import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue 11 — list/map results toggle.
 *
 * The toggle switches the results region between the (server-rendered) list and
 * a Leaflet map. The map view is URL state (`?map=1`) so it is shareable and the
 * DEFAULT (no param) is the list — which keeps mobile list-default (ADR-0018).
 *
 * The Leaflet map itself is loaded client-only via a dynamic import; in jsdom we
 * mock the map module so the test asserts the TOGGLE behaviour and that the map
 * container mounts (the pin/mini-card LOGIC lives in `lib/maps`, fully tested).
 *
 * Translation keys are returned verbatim by the mock; `next/navigation` is
 * mocked so we can assert the exact URL the toggle pushes.
 */

const mockPush = vi.fn()
let mockSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/search',
  useSearchParams: () => mockSearchParams,
}))

vi.mock('next-intl', () => ({
  useTranslations:
    (ns: string) =>
    (key: string) =>
      ns ? `${ns}.${key}` : key,
}))

// Stub the heavy Leaflet map so jsdom never touches `window`/canvas. The real
// component is exercised in E2E; here we only need a mountable placeholder.
vi.mock('@/components/maps/experience-map-loader', () => ({
  ExperienceMapLoader: ({ pins }: { pins: Array<{ slug: string }> }) => (
    <div data-testid="experience-map" data-pin-count={pins.length} />
  ),
}))

import { ResultsView } from '@/components/maps/results-view'

const PINS = [
  {
    slug: 'ganges-rafting',
    title: 'Ganges Rafting',
    regionSlug: 'rishikesh',
    lat: 30.0869,
    lng: 78.2676,
    price: 1499,
    activity: 'Rafting',
  },
]

function renderView(map: boolean) {
  return render(
    <ResultsView pins={PINS} mapActive={map} labels={labels}>
      <div data-testid="list-region">List results</div>
    </ResultsView>,
  )
}

const labels = {
  list: 'List',
  map: 'Map',
  groupLabel: 'List / Map',
}

afterEach(() => {
  cleanup()
  mockPush.mockClear()
  mockSearchParams = new URLSearchParams()
})

describe('ResultsView list/map toggle', () => {
  it('shows the list children by default (list view) and not the map', () => {
    renderView(false)
    expect(screen.getByTestId('list-region')).toBeInTheDocument()
    expect(screen.queryByTestId('experience-map')).not.toBeInTheDocument()
  })

  it('renders both toggle controls', () => {
    renderView(false)
    const group = screen.getByTestId('results-view-toggle')
    expect(within(group).getByRole('button', { name: 'List' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Map' })).toBeInTheDocument()
  })

  it('pushes ?map=1 when the Map control is clicked', () => {
    renderView(false)
    fireEvent.click(screen.getByRole('button', { name: 'Map' }))
    expect(mockPush).toHaveBeenCalledWith('/search?map=1', { scroll: false })
  })

  it('shows the map (with the filtered pins) and hides the list when map is active', () => {
    renderView(true)
    const map = screen.getByTestId('experience-map')
    expect(map).toBeInTheDocument()
    expect(map).toHaveAttribute('data-pin-count', '1')
    expect(screen.queryByTestId('list-region')).not.toBeInTheDocument()
  })

  it('drops the map param (back to list) when List is clicked from the map view', () => {
    mockSearchParams = new URLSearchParams('map=1&region=rishikesh')
    render(
      <ResultsView pins={PINS} mapActive labels={labels}>
        <div data-testid="list-region">List results</div>
      </ResultsView>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    // Only the map param is dropped; the active filter (region) is preserved.
    expect(mockPush).toHaveBeenCalledWith('/search?region=rishikesh', { scroll: false })
  })

  it('marks the active control with aria-pressed', () => {
    renderView(true)
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})
