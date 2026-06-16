/**
 * E2E — list/map toggle + Leaflet map on /search and /destinations/{city}
 * (issue 11, DECISION D4).
 *
 * Exercises the toggle switching list↔map, the map container mounting with
 * price pins derived from the SAME filtered hits, a pin click opening the mini
 * experience card, and its "View Experience" CTA linking to /experience/{slug}.
 *
 * Coordinate honesty (D0): pins sit at the region city-centroid; this is a
 * city-level discovery map, surfaced by the honest disclaimer note. We do NOT
 * assert per-pin precision.
 *
 * Leaflet renders to a real DOM in Chromium (unlike jsdom). OpenStreetMap tile
 * requests are external 200s — the DevTools fixture only fails on 4xx/5xx, so
 * tiles do not trip the gate. axe (wcag2a+wcag2aa) runs after each test.
 */

import { test, expect } from '../../fixtures/devtools'

test.describe('List/map toggle + Leaflet map (issue 11)', () => {
  test('toggles list↔map on /search and the map mounts with pins (URL state)', async ({
    page,
  }) => {
    await page.goto('/search')

    const toggle = page.getByTestId('results-view-toggle')
    await expect(toggle).toBeVisible()

    // List is the default — no map container yet.
    await expect(page.getByTestId('experience-map')).toHaveCount(0)

    // Switch to the map view — URL gains ?map=1 and the map container mounts.
    await Promise.all([
      page.waitForURL(/map=1/),
      toggle.getByRole('button', { name: 'Map' }).click(),
    ])
    const map = page.getByTestId('experience-map')
    await expect(map).toBeVisible()
    // The Leaflet tile pane renders (the map actually initialised).
    await expect(map.locator('.leaflet-container')).toBeVisible()

    // Switch back to the list — the map param is dropped.
    await Promise.all([
      page.waitForURL((url) => !url.search.includes('map=1')),
      toggle.getByRole('button', { name: 'List' }).click(),
    ])
    await expect(page.getByTestId('experience-map')).toHaveCount(0)
  })

  test('the map respects the active filter (pins reflect the filtered set)', async ({
    page,
  }) => {
    // A filtered, map-active search — the map is derived from the SAME hits as
    // the filtered list (region=rishikesh is seeded with published Experiences).
    await page.goto('/search?region=rishikesh&map=1')

    const map = page.getByTestId('experience-map')
    await expect(map).toBeVisible()
    // At least one price pin is rendered (the seeded rishikesh inventory). The
    // Leaflet marker (`.experience-price-pin`) is a 0×0 divIcon, so assert on
    // its visible label child (components/maps/experience-map.tsx).
    await expect(
      map.locator('.experience-price-pin__label').first(),
    ).toBeVisible()

    // Honest, city-level disclaimer is present (coordinate honesty, D0).
    await expect(page.getByTestId('map-city-level-note')).toBeVisible()
  })

  test('clicking a pin opens the mini card → View Experience → /experience/{slug}', async ({
    page,
  }) => {
    await page.goto('/search?region=rishikesh&map=1')

    const map = page.getByTestId('experience-map')
    await expect(map).toBeVisible()

    // Click the first price pin to open its popup mini-card. The marker is a
    // 0×0 divIcon, so click its visible label child — the click bubbles to the
    // Leaflet marker and opens the popup.
    await map.locator('.experience-price-pin__label').first().click()

    const miniCard = page.getByTestId('map-mini-card')
    await expect(miniCard).toBeVisible()

    const cta = page.getByTestId('map-mini-card-cta')
    await expect(cta).toBeVisible()
    await expect(cta).toHaveAttribute('href', /^\/experience\//)

    // Following the CTA lands on a canonical Experience detail page.
    await Promise.all([page.waitForURL(/\/experience\//), cta.click()])
    await expect(page.locator('h1')).toBeVisible()
  })

  test('the destination page also exposes the list/map toggle', async ({
    page,
  }) => {
    // goa is seeded with published Experiences, so the toggle + map render.
    await page.goto('/destinations/goa')
    const toggle = page.getByTestId('results-view-toggle')
    await expect(toggle).toBeVisible()

    await Promise.all([
      page.waitForURL(/map=1/),
      toggle.getByRole('button', { name: 'Map' }).click(),
    ])
    const map = page.getByTestId('experience-map')
    await expect(map).toBeVisible()
    await expect(map.locator('.leaflet-container')).toBeVisible()
  })
})
