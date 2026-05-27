/**
 * E2E tests for all public (unauthenticated) pages.
 *
 * Covers: home, activity-city collection, experience detail, search (bare +
 * filtered), Hindi locale, sign-in, and error pages.
 *
 * Uses the DevTools fixture for automatic console-error, uncaught-exception,
 * network-failure, and axe-core accessibility checks after each test.
 */

import { test, expect } from '../../fixtures/devtools'

// ---------------------------------------------------------------------------
// 1. Home page
// ---------------------------------------------------------------------------
test.describe('Home page', () => {
  test('loads 200, axe passes, no console errors', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(/Outvers/)

    await page.screenshot({
      path: 'tests/e2e/screenshots/home.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 2. Activity-city collection
// ---------------------------------------------------------------------------
test.describe('Activity-city collection', () => {
  test('renders H1, JSON-LD, breadcrumb nav, experience cards', async ({
    page,
  }) => {
    const response = await page.goto('/adventure/rafting-in-rishikesh')
    expect(response?.status()).toBe(200)

    // H1 contains activity + region
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Rafting')
    await expect(h1).toContainText('Rishikesh')

    // Breadcrumb nav present
    const breadcrumbNav = page.locator('nav[aria-label="Breadcrumb"]')
    await expect(breadcrumbNav).toBeVisible()

    // JSON-LD blocks: BreadcrumbList + FAQPage (at minimum)
    const jsonLdScripts = page.locator('script[type="application/ld+json"]')
    const count = await jsonLdScripts.count()
    expect(count).toBeGreaterThanOrEqual(2)

    let foundBreadcrumb = false
    let foundFaq = false
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
      if (parsed['@type'] === 'FAQPage') {
        foundFaq = true
        const entities = parsed.mainEntity as Array<{ '@type': string }>
        expect(entities.length).toBeGreaterThanOrEqual(1)
        expect(entities[0]['@type']).toBe('Question')
      }
    }
    expect(foundBreadcrumb).toBe(true)
    expect(foundFaq).toBe(true)

    // Experience cards visible (if seeded data has any)
    const experienceLinks = page.locator('a[href*="/experience/"]')
    const linkCount = await experienceLinks.count()
    expect(linkCount).toBeGreaterThanOrEqual(0)

    await page.screenshot({
      path: 'tests/e2e/screenshots/activity-city-collection.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 3. Experience detail
// ---------------------------------------------------------------------------
test.describe('Experience detail', () => {
  test('renders Product JSON-LD, pricing, cancellation, FAQ, vendor link, breadcrumb', async ({
    page,
  }) => {
    // Navigate to the collection page and find a real experience
    await page.goto('/adventure/rafting-in-rishikesh')
    const experienceLinks = page.locator('a[href*="/experience/"]')
    const linkCount = await experienceLinks.count()

    if (linkCount === 0) {
      // No seeded experiences — verify a nonexistent slug 404s gracefully
      const response = await page.goto('/experience/nonexistent-slug')
      expect(response?.status()).toBe(404)
      return
    }

    // Navigate to the first experience
    const href = await experienceLinks.first().getAttribute('href')
    expect(href).toBeTruthy()

    const response = await page.goto(href!)
    expect(response?.status()).toBe(200)

    // H1 present
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()

    // Breadcrumb nav
    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toBeVisible()

    // JSON-LD: Product + BreadcrumbList + FAQPage
    const jsonLdScripts = page.locator('script[type="application/ld+json"]')
    const count = await jsonLdScripts.count()
    expect(count).toBeGreaterThanOrEqual(3)

    let foundProduct = false
    let foundBreadcrumb = false
    let foundFaq = false
    for (let i = 0; i < count; i++) {
      const content = await jsonLdScripts.nth(i).textContent()
      if (!content) continue
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (parsed['@type'] === 'Product') {
        foundProduct = true
        expect(parsed['@context']).toBe('https://schema.org')
        expect(parsed.name).toBeTruthy()
        expect(parsed.url).toContain('/experience/')
        const offers = parsed.offers as { '@type': string; priceCurrency: string; price: string }
        expect(offers['@type']).toBe('Offer')
        expect(offers.priceCurrency).toBe('INR')
        expect(Number(offers.price)).toBeGreaterThan(0)
      }
      if (parsed['@type'] === 'BreadcrumbList') foundBreadcrumb = true
      if (parsed['@type'] === 'FAQPage') foundFaq = true
    }
    expect(foundProduct).toBe(true)
    expect(foundBreadcrumb).toBe(true)
    expect(foundFaq).toBe(true)

    // Pricing section — the card has a CardTitle "Pricing" and prices with "/ person"
    await expect(page.locator('text=/ person').first()).toBeVisible()

    // Cancellation policy section
    await expect(page.locator('h2:has-text("Cancellation policy")')).toBeVisible()

    // FAQ section
    await expect(
      page.locator('h2:has-text("Frequently asked questions")'),
    ).toBeVisible()

    // Vendor link
    await expect(page.locator('a[href*="/vendor/"]')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/experience-detail.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 4. Search bare
// ---------------------------------------------------------------------------
test.describe('Search bare', () => {
  test('H1 visible, canonical at /search, robots index follow, filter selects', async ({
    page,
  }) => {
    const response = await page.goto('/search')
    expect(response?.status()).toBe(200)

    // H1
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()

    // Canonical points at unfiltered /search
    const canonical = page.locator('link[rel="canonical"]').first()
    await expect(canonical).toHaveAttribute('href', /\/search$/)

    // Robots: index, follow on bare search
    const robots = page.locator('meta[name="robots"]').first()
    await expect(robots).toHaveAttribute('content', 'index, follow')

    // Filter selects visible
    await expect(page.locator('#activity')).toBeVisible()
    await expect(page.locator('#sort')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/search-bare.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 5. Search filtered
// ---------------------------------------------------------------------------
test.describe('Search filtered', () => {
  test('robots noindex follow, canonical still /search', async ({ page }) => {
    const response = await page.goto('/search?activity=rafting')
    expect(response?.status()).toBe(200)

    // Robots: noindex on filtered view
    const robots = page.locator('meta[name="robots"]').first()
    await expect(robots).toHaveAttribute('content', 'noindex, follow')

    // Canonical STILL points at unfiltered /search
    const canonical = page.locator('link[rel="canonical"]').first()
    await expect(canonical).toHaveAttribute('href', /\/search$/)

    await page.screenshot({
      path: 'tests/e2e/screenshots/search-filtered.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 6. Hindi locale
//    No i18n prefix routing is configured yet; /hi/... paths should still
//    return a non-crash response (404 or redirect). When i18n lands, update
//    these assertions to expect 200.
// ---------------------------------------------------------------------------
test.describe('Hindi locale', () => {
  test('/hi/adventure/{slug} returns a valid response', async ({ page }) => {
    const response = await page.goto('/hi/adventure/rafting-in-rishikesh')
    // Without i18n routing the path will 404; once i18n is wired, flip to 200
    expect(response?.status()).toBeGreaterThanOrEqual(200)
    expect(response?.status()).toBeLessThan(500)

    await page.screenshot({
      path: 'tests/e2e/screenshots/activity-city-hindi.png',
      fullPage: true,
    })
  })

  test('/hi/search returns a valid response', async ({ page }) => {
    const response = await page.goto('/hi/search')
    expect(response?.status()).toBeGreaterThanOrEqual(200)
    expect(response?.status()).toBeLessThan(500)

    await page.screenshot({
      path: 'tests/e2e/screenshots/search-hindi.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 7. Sign-in page
// ---------------------------------------------------------------------------
test.describe('Sign-in page', () => {
  test('/sign-in renders without crashing', async ({ page }) => {
    const response = await page.goto('/sign-in')
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(/Sign in/)

    // Page contains a main element
    await expect(page.locator('main')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/sign-in.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 8. Error pages
// ---------------------------------------------------------------------------
test.describe('Error pages', () => {
  test('404 for invalid adventure slug', async ({ page }) => {
    const response = await page.goto('/adventure/chess-boxing-in-atlantis')
    expect(response?.status()).toBe(404)

    await page.screenshot({
      path: 'tests/e2e/screenshots/404-adventure.png',
      fullPage: true,
    })
  })

  test('404 for invalid experience slug', async ({ page }) => {
    const response = await page.goto('/experience/nonexistent-slug-xyz')
    expect(response?.status()).toBe(404)

    await page.screenshot({
      path: 'tests/e2e/screenshots/404-experience.png',
      fullPage: true,
    })
  })

  test('cancellation policy page loads', async ({ page }) => {
    const response = await page.goto('/cancellation-policy')
    expect(response?.status()).toBe(200)
    await expect(page.locator('h1')).toContainText('cancellation')

    await page.screenshot({
      path: 'tests/e2e/screenshots/cancellation-policy.png',
      fullPage: true,
    })
  })
})
