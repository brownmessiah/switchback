/**
 * E2E — PDP meeting-point map + Open-in-Maps (issue 15).
 *
 * Replaces the text-only meeting point with an APPROXIMATE-area Leaflet pin at
 * the REGION centroid (coordinate honesty, D0 — NOT a precise meeting-point
 * pin) plus an "Open in Maps" deep link that SEARCHES the real named place.
 *
 * Asserted on the seeded Bir-Billing camping Experience: region `bir-billing`
 * HAS a known centroid, and the listing has a free-text meeting point — so the
 * map pin, the honest "approximate area" note, the free text, and the
 * Open-in-Maps deep link all render. The DevTools fixture runs an axe-core
 * accessibility check after each test (axe clean is an acceptance criterion).
 */

import { test, expect } from '../../fixtures/devtools'

const PDP = '/experience/bir-billing-camping-mountain-stay'

test.describe('PDP meeting-point map (issue 15)', () => {
  test('renders the approximate-area pin + honest note alongside the free-text meeting point', async ({
    page,
  }) => {
    const response = await page.goto(PDP)
    expect(response?.status()).toBe(200)

    const section = page.locator('#meetingPoint')
    await expect(section).toBeVisible()

    // Approximate-area Leaflet pin at the region centroid (client-rendered).
    await expect(section.locator('[data-testid="meeting-point-map"]')).toBeVisible()

    // Honest disclaimer — pin is an approximate area, exact point after booking.
    const note = section.locator('[data-testid="meeting-point-approximate-note"]')
    await expect(note).toBeVisible()
    await expect(note).toContainText(/approximate area/i)

    // The original free-text meeting point is preserved (matches the E2E seed
    // db/seed.ts: 'Bir landing field, ~1,400 m, Bir, Himachal Pradesh').
    await expect(section).toContainText('Bir landing field')
  })

  test('the "Open in Maps" link builds a valid Google Maps search deep link for the real place', async ({
    page,
  }) => {
    await page.goto(PDP)

    const link = page.locator('[data-testid="meeting-point-open-maps"]')
    await expect(link).toBeVisible()
    // Opens the native maps app in a new, safely-rel'd tab.
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)

    const href = await link.getAttribute('href')
    expect(href).not.toBeNull()
    const url = new URL(href!)
    // A plain navigable Google Maps universal URL — no API key / billing.
    expect(url.hostname).toBe('www.google.com')
    expect(url.pathname).toBe('/maps/search/')
    expect(url.searchParams.get('api')).toBe('1')
    // The deep link SEARCHES the real named place, not a bare centroid
    // (seed meeting point + localized region name "Bir Billing").
    expect(url.searchParams.get('query')).toContain('Bir landing field')
  })
})
