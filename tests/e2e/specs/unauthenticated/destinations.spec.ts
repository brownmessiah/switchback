import { test, expect } from '../../fixtures/devtools'

/**
 * Destinations landing family (Issue 04).
 *
 * Relies on the global-setup seed (regions rishikesh/manali/bir-billing/goa
 * have published Experiences), so no self-seeding is required.
 */

test.describe('Destinations', () => {
  test('index lists regions with breadcrumb + BreadcrumbList JSON-LD', async ({
    page,
  }) => {
    const response = await page.goto('/destinations')
    expect(response?.status()).toBe(200)

    // H1 present
    await expect(page.locator('h1')).toBeVisible()

    // Breadcrumb nav present
    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toBeVisible()

    // Region links to detail pages present (at least one)
    const regionLinks = page.locator('a[href*="/destinations/"]')
    expect(await regionLinks.count()).toBeGreaterThanOrEqual(1)
    // The seeded goa landing must be linked
    await expect(
      page.locator('a[href="/destinations/goa"]').first(),
    ).toBeVisible()

    // BreadcrumbList JSON-LD
    const jsonLdScripts = page.locator('script[type="application/ld+json"]')
    const count = await jsonLdScripts.count()
    expect(count).toBeGreaterThanOrEqual(1)
    let foundBreadcrumb = false
    for (let i = 0; i < count; i++) {
      const content = await jsonLdScripts.nth(i).textContent()
      if (!content) continue
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (parsed['@type'] === 'BreadcrumbList') {
        foundBreadcrumb = true
        expect(parsed['@context']).toBe('https://schema.org')
        const items = parsed.itemListElement as Array<{ position: number }>
        expect(items.length).toBeGreaterThanOrEqual(2)
        expect(items[0].position).toBe(1)
      }
    }
    expect(foundBreadcrumb).toBe(true)
  })

  test('region landing renders hero, experiences, ItemList + BreadcrumbList JSON-LD', async ({
    page,
  }) => {
    const response = await page.goto('/destinations/goa')
    expect(response?.status()).toBe(200)

    // H1 names the region
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Goa')

    // Breadcrumb nav present
    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toBeVisible()

    // Experience cards visible (goa is seeded with published experiences)
    const experienceLinks = page.locator('a[href*="/experience/"]')
    expect(await experienceLinks.count()).toBeGreaterThanOrEqual(1)

    // JSON-LD: ItemList + BreadcrumbList (+ FAQPage)
    const jsonLdScripts = page.locator('script[type="application/ld+json"]')
    const count = await jsonLdScripts.count()
    expect(count).toBeGreaterThanOrEqual(2)

    let foundItemList = false
    let foundBreadcrumb = false
    let touristDestinationCount = 0
    for (let i = 0; i < count; i++) {
      const content = await jsonLdScripts.nth(i).textContent()
      if (!content) continue
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (parsed['@type'] === 'ItemList') {
        foundItemList = true
        expect(parsed['@context']).toBe('https://schema.org')
        const items = parsed.itemListElement as Array<{ position: number }>
        expect(items.length).toBeGreaterThanOrEqual(1)
      }
      if (parsed['@type'] === 'BreadcrumbList') {
        foundBreadcrumb = true
        const items = parsed.itemListElement as Array<{ position: number }>
        expect(items.length).toBeGreaterThanOrEqual(3)
      }
      // TouristDestination (ADR-0013 / issue 21): exactly one node, with the
      // Indian state as containedInPlace and a real centroid geo block (goa
      // has a known centroid in lib/maps/region-coords.ts — D0).
      if (parsed['@type'] === 'TouristDestination') {
        touristDestinationCount += 1
        expect(parsed['@context']).toBe('https://schema.org')
        expect(parsed.name).toContain('Goa')
        const place = parsed.containedInPlace as { '@type': string; name: string }
        expect(place['@type']).toBe('AdministrativeArea')
        expect(place.name).toBe('Goa')
        const geo = parsed.geo as { '@type': string; latitude: number }
        expect(geo['@type']).toBe('GeoCoordinates')
        expect(typeof geo.latitude).toBe('number')
      }
    }
    expect(foundItemList).toBe(true)
    expect(foundBreadcrumb).toBe(true)
    expect(touristDestinationCount).toBe(1)
  })

  test('404 for an invalid region slug', async ({ page }) => {
    const response = await page.goto('/destinations/not-a-region')
    expect(response?.status()).toBe(404)
  })
})
