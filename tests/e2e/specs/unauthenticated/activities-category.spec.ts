/**
 * E2E for the cross-region activity landing (`/activities/{slug}`) and the
 * category rollup (`/category/{slug}`). These complement the activity-in-city
 * collection (`/adventure/{slug}`).
 *
 * On main's seed, activity `rafting` (category `water`) has published
 * Experiences across regions, so both pages render populated.
 *
 * Uses the DevTools fixture for automatic console-error, uncaught-exception,
 * network-failure, and axe-core accessibility checks after each test.
 */

import { test, expect } from '../../fixtures/devtools'

test.describe('Activities landing (/activities/[slug])', () => {
  test('renders cross-region experiences, ItemList + BreadcrumbList JSON-LD, self-canonical', async ({
    page,
  }) => {
    const response = await page.goto('/activities/rafting')
    expect(response?.status()).toBe(200)

    // H1 names the activity.
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Rafting')

    // Breadcrumb nav present.
    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toBeVisible()

    // Self-canonical points at /activities/rafting (NOT /adventure/...).
    const canonical = page.locator('link[rel="canonical"]').first()
    const canonicalHref = await canonical.getAttribute('href')
    expect(canonicalHref).toMatch(/\/activities\/rafting$/)
    expect(canonicalHref).not.toContain('/adventure/')

    // JSON-LD blocks: ItemList + BreadcrumbList (+ FAQPage) must be present.
    const jsonLdScripts = page.locator('script[type="application/ld+json"]')
    const count = await jsonLdScripts.count()
    expect(count).toBeGreaterThanOrEqual(3)

    let foundItemList = false
    let foundBreadcrumb = false
    let foundFaq = false
    for (let i = 0; i < count; i++) {
      const content = await jsonLdScripts.nth(i).textContent()
      if (!content) continue
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (parsed['@type'] === 'ItemList') {
        foundItemList = true
        expect(parsed['@context']).toBe('https://schema.org')
        const items = parsed.itemListElement as Array<{ position: number }>
        expect(items.length).toBeGreaterThanOrEqual(1)
        expect(items[0].position).toBe(1)
      }
      if (parsed['@type'] === 'BreadcrumbList') {
        foundBreadcrumb = true
        const items = parsed.itemListElement as Array<{ position: number }>
        expect(items.length).toBeGreaterThanOrEqual(2)
      }
      if (parsed['@type'] === 'FAQPage') foundFaq = true
    }
    expect(foundItemList).toBe(true)
    expect(foundBreadcrumb).toBe(true)
    expect(foundFaq).toBe(true)

    // Experiences are shown (rafting is published across regions on the seed).
    const experienceLinks = page.locator('a[href*="/experience/"]')
    expect(await experienceLinks.count()).toBeGreaterThanOrEqual(1)

    await page.screenshot({
      path: 'tests/e2e/screenshots/activities-rafting.png',
      fullPage: true,
    })
  })

  test('404 for an activity slug not in the registry', async ({ page }) => {
    const response = await page.goto('/activities/not-an-activity')
    expect(response?.status()).toBe(404)
  })
})

test.describe('Category rollup (/category/[slug])', () => {
  test('renders rollup experiences + ItemList + BreadcrumbList JSON-LD, self-canonical', async ({
    page,
  }) => {
    const response = await page.goto('/category/water')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()

    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toBeVisible()

    // Self-canonical points at /category/water.
    const canonical = page.locator('link[rel="canonical"]').first()
    const canonicalHref = await canonical.getAttribute('href')
    expect(canonicalHref).toMatch(/\/category\/water$/)

    const jsonLdScripts = page.locator('script[type="application/ld+json"]')
    const count = await jsonLdScripts.count()
    expect(count).toBeGreaterThanOrEqual(2)

    let foundBreadcrumb = false
    let foundItemList = false
    let foundFaq = false
    for (let i = 0; i < count; i++) {
      const content = await jsonLdScripts.nth(i).textContent()
      if (!content) continue
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (parsed['@type'] === 'ItemList') foundItemList = true
      if (parsed['@type'] === 'BreadcrumbList') foundBreadcrumb = true
      if (parsed['@type'] === 'FAQPage') foundFaq = true
    }
    expect(foundBreadcrumb).toBe(true)
    expect(foundItemList).toBe(true)
    expect(foundFaq).toBe(true)

    await page.screenshot({
      path: 'tests/e2e/screenshots/category-water.png',
      fullPage: true,
    })
  })

  test('404 for a category not among the registry categories', async ({
    page,
  }) => {
    const response = await page.goto('/category/not-a-category')
    expect(response?.status()).toBe(404)
  })

  test('404 for the empty urban category (in the type, no activities)', async ({
    page,
  }) => {
    const response = await page.goto('/category/urban')
    expect(response?.status()).toBe(404)
  })
})
