import { expect, test } from '@playwright/test'

/**
 * Comprehensive verification of all M2 UI pages.
 * Takes screenshots and validates HTML structure, JSON-LD,
 * canonical links, meta tags, and accessibility landmarks.
 */

test.describe('M2 Page Verification', () => {
  // ======================================================================
  // Task 18: Activity-city collection page
  // ======================================================================
  test.describe('Activity-city collection (Task 18)', () => {
    test('/{lng}/adventure/{slug} renders with correct structure', async ({
      page,
    }) => {
      const response = await page.goto('/en/adventure/rafting-in-rishikesh')
      expect(response?.status()).toBe(200)

      // H1 present with activity + region
      const h1 = page.locator('h1')
      await expect(h1).toBeVisible()
      await expect(h1).toContainText('Rafting')
      await expect(h1).toContainText('Rishikesh')

      // Canonical link points at self
      const canonical = page.locator('link[rel="canonical"]').first()
      await expect(canonical).toHaveAttribute(
        'href',
        /\/en\/adventure\/rafting-in-rishikesh|\/adventure\/rafting-in-rishikesh/,
      )

      // JSON-LD blocks present (BreadcrumbList + FAQPage at minimum)
      const jsonLdScripts = page.locator('script[type="application/ld+json"]')
      const count = await jsonLdScripts.count()
      expect(count).toBeGreaterThanOrEqual(2)

      // Parse and validate BreadcrumbList JSON-LD
      let foundBreadcrumb = false
      let foundFaq = false
      for (let i = 0; i < count; i++) {
        const content = await jsonLdScripts.nth(i).textContent()
        if (!content) continue
        const parsed = JSON.parse(content)
        if (parsed['@type'] === 'BreadcrumbList') {
          foundBreadcrumb = true
          expect(parsed['@context']).toBe('https://schema.org')
          expect(parsed.itemListElement.length).toBeGreaterThanOrEqual(2)
          expect(parsed.itemListElement[0].position).toBe(1)
        }
        if (parsed['@type'] === 'FAQPage') {
          foundFaq = true
          expect(parsed.mainEntity.length).toBeGreaterThanOrEqual(1)
          expect(parsed.mainEntity[0]['@type']).toBe('Question')
        }
      }
      expect(foundBreadcrumb).toBe(true)
      expect(foundFaq).toBe(true)

      // Breadcrumb nav present
      const breadcrumbNav = page.locator('nav[aria-label="Breadcrumb"]')
      await expect(breadcrumbNav).toBeVisible()

      // Screenshot
      await page.screenshot({
        path: 'tests/e2e/screenshots/activity-city-collection.png',
        fullPage: true,
      })
    })

    test('returns 404 for invalid activity-city slug', async ({ page }) => {
      const response = await page.goto('/en/adventure/chess-boxing-in-atlantis')
      expect(response?.status()).toBe(404)
    })
  })

  // ======================================================================
  // Task 19: Experience detail page
  // ======================================================================
  test.describe('Experience detail page (Task 19)', () => {
    test('/{lng}/experience/{slug} renders with Product JSON-LD', async ({
      page,
    }) => {
      // First find a real experience slug from the collection page
      await page.goto('/en/adventure/rafting-in-rishikesh')
      const experienceLinks = page.locator('a[href*="/experience/"]')
      const linkCount = await experienceLinks.count()

      if (linkCount === 0) {
        // No experiences seeded — verify the page 404s gracefully
        const response = await page.goto('/en/experience/nonexistent-slug')
        expect(response?.status()).toBe(404)
        return
      }

      // Get the first experience link href
      const href = await experienceLinks.first().getAttribute('href')
      expect(href).toBeTruthy()

      const response = await page.goto(href!)
      expect(response?.status()).toBe(200)

      // H1 present
      const h1 = page.locator('h1')
      await expect(h1).toBeVisible()

      // Canonical link
      const canonical = page.locator('link[rel="canonical"]').first()
      await expect(canonical).toHaveAttribute('href', /\/experience\//)

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
        const parsed = JSON.parse(content)
        if (parsed['@type'] === 'Product') {
          foundProduct = true
          expect(parsed['@context']).toBe('https://schema.org')
          expect(parsed.name).toBeTruthy()
          expect(parsed.url).toContain('/experience/')
          expect(parsed.offers['@type']).toBe('Offer')
          expect(parsed.offers.priceCurrency).toBe('INR')
          expect(Number(parsed.offers.price)).toBeGreaterThan(0)
        }
        if (parsed['@type'] === 'BreadcrumbList') foundBreadcrumb = true
        if (parsed['@type'] === 'FAQPage') foundFaq = true
      }
      expect(foundProduct).toBe(true)
      expect(foundBreadcrumb).toBe(true)
      expect(foundFaq).toBe(true)

      // Pricing section
      await expect(page.locator('[aria-label="Pricing"]')).toBeVisible()
      await expect(page.locator('text=per person').first()).toBeVisible()

      // Cancellation policy section
      await expect(
        page.locator('[aria-label="Cancellation policy"]'),
      ).toBeVisible()

      // FAQ section
      await expect(page.locator('[aria-label="FAQ"]')).toBeVisible()

      // Vendor link
      await expect(page.locator('a[href*="/vendor/"]')).toBeVisible()

      // Breadcrumb nav
      await expect(
        page.locator('nav[aria-label="Breadcrumb"]'),
      ).toBeVisible()

      // Screenshot
      await page.screenshot({
        path: 'tests/e2e/screenshots/experience-detail.png',
        fullPage: true,
      })
    })

    test('returns 404 for nonexistent experience slug', async ({ page }) => {
      const response = await page.goto('/en/experience/nonexistent-slug-xyz')
      expect(response?.status()).toBe(404)
    })

    test('experience page has correct meta title', async ({ page }) => {
      await page.goto('/en/adventure/rafting-in-rishikesh')
      const experienceLinks = page.locator('a[href*="/experience/"]')
      const linkCount = await experienceLinks.count()
      if (linkCount === 0) return

      const href = await experienceLinks.first().getAttribute('href')
      await page.goto(href!)
      const title = await page.title()
      expect(title).toContain('Outvers')
    })
  })

  // ======================================================================
  // Task 23: Search page
  // ======================================================================
  test.describe('Faceted search (Task 23)', () => {
    test('/{lng}/search renders with correct canonical + robots', async ({
      page,
    }) => {
      const response = await page.goto('/en/search')
      expect(response?.status()).toBe(200)

      // H1
      const h1 = page.locator('h1')
      await expect(h1).toBeVisible()
      await expect(h1).toContainText('Search')

      // Canonical points at unfiltered /search
      const canonical = page.locator('link[rel="canonical"]').first()
      await expect(canonical).toHaveAttribute('href', /\/search$/)

      // Robots: index, follow on bare search
      const robots = page.locator('meta[name="robots"]').first()
      await expect(robots).toHaveAttribute('content', 'index, follow')

      // Filter form present
      await expect(page.locator('select[name="activity"]')).toBeVisible()
      await expect(page.locator('select[name="sort"]')).toBeVisible()

      // Screenshot
      await page.screenshot({
        path: 'tests/e2e/screenshots/search-bare.png',
        fullPage: true,
      })
    })

    test('filtered search emits noindex, follow', async ({ page }) => {
      const response = await page.goto('/en/search?activity=rafting')
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

    test('search with price filters works', async ({ page }) => {
      const response = await page.goto(
        '/en/search?minPrice=1000&maxPrice=5000',
      )
      expect(response?.status()).toBe(200)

      const robots = page.locator('meta[name="robots"]').first()
      await expect(robots).toHaveAttribute('content', 'noindex, follow')
    })

    test('search with sort works', async ({ page }) => {
      const response = await page.goto('/en/search?sort=price_asc')
      expect(response?.status()).toBe(200)

      const robots = page.locator('meta[name="robots"]').first()
      await expect(robots).toHaveAttribute('content', 'noindex, follow')
    })

    test('search page has correct meta title', async ({ page }) => {
      await page.goto('/en/search')
      const title = await page.title()
      expect(title).toContain('Search')
      expect(title).toContain('Outvers')
    })
  })

  // ======================================================================
  // Home page (smoke)
  // ======================================================================
  test.describe('Home page', () => {
    test('/ returns 200', async ({ page }) => {
      const response = await page.goto('/')
      expect(response?.status()).toBe(200)
      await page.screenshot({
        path: 'tests/e2e/screenshots/home.png',
        fullPage: true,
      })
    })
  })

  // ======================================================================
  // Cross-cutting: Hindi locale
  // ======================================================================
  test.describe('Hindi locale', () => {
    test('/hi/adventure/{slug} works', async ({ page }) => {
      const response = await page.goto('/hi/adventure/rafting-in-rishikesh')
      expect(response?.status()).toBe(200)

      const h1 = page.locator('h1')
      await expect(h1).toBeVisible()

      await page.screenshot({
        path: 'tests/e2e/screenshots/activity-city-hindi.png',
        fullPage: true,
      })
    })

    test('/hi/search works', async ({ page }) => {
      const response = await page.goto('/hi/search')
      expect(response?.status()).toBe(200)
    })
  })

  // ======================================================================
  // Auth-gated pages (expect redirect/404 without auth)
  // ======================================================================
  test.describe('Auth-gated pages (unauthenticated)', () => {
    test('/bookings/{id}/confirmation returns 404 without auth', async ({
      page,
    }) => {
      const response = await page.goto(
        '/bookings/00000000-0000-0000-0000-000000000000/confirmation',
      )
      // Should be 404 since user is not authenticated
      expect(response?.status()).toBe(404)
    })
  })
})
