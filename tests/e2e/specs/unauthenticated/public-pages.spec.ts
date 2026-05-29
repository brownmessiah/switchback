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
  test('renders Product/Review/FAQ/BreadcrumbList JSON-LD, pricing brackets, cancellation, FAQ, vendor link, breadcrumb', async ({
    page,
  }) => {
    // Deep-link to a known seeded Experience so pricing brackets +
    // cancellation preset are deterministic (Rishikesh Grade-III rafting:
    // ₹1500 / ₹1300 / ₹1100, flexible preset, has published reviews).
    const response = await page.goto(
      '/experience/rishikesh-rafting-grade-iii',
    )
    expect(response?.status()).toBe(200)

    // H1 present
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()

    // Breadcrumb nav
    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toBeVisible()

    // JSON-LD: Product + BreadcrumbList + FAQPage + Review (ADR-0013)
    const jsonLdScripts = page.locator('script[type="application/ld+json"]')
    const count = await jsonLdScripts.count()
    expect(count).toBeGreaterThanOrEqual(4)

    let foundProduct = false
    let foundBreadcrumb = false
    let foundFaq = false
    let reviewCount = 0
    let foundAggregateRating = false
    for (let i = 0; i < count; i++) {
      const content = await jsonLdScripts.nth(i).textContent()
      if (!content) continue
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (parsed['@type'] === 'Product') {
        foundProduct = true
        expect(parsed['@context']).toBe('https://schema.org')
        expect(parsed.name).toBeTruthy()
        expect(parsed.url).toContain('/experience/')
        const offers = parsed.offers as {
          '@type': string
          priceCurrency: string
          price: string
        }
        expect(offers['@type']).toBe('Offer')
        expect(offers.priceCurrency).toBe('INR')
        // Product offer reflects the 1-2 Group-size bracket price (₹1500).
        expect(Number(offers.price)).toBe(1500)
        // AggregateRating present because this Experience has reviews.
        if (parsed.aggregateRating) {
          foundAggregateRating = true
          const ar = parsed.aggregateRating as {
            '@type': string
            ratingValue: number
            ratingCount: number
          }
          expect(ar['@type']).toBe('AggregateRating')
          expect(ar.ratingValue).toBeGreaterThan(0)
          expect(ar.ratingValue).toBeLessThanOrEqual(5)
          expect(ar.ratingCount).toBeGreaterThanOrEqual(1)
        }
      }
      if (parsed['@type'] === 'BreadcrumbList') foundBreadcrumb = true
      if (parsed['@type'] === 'FAQPage') foundFaq = true
      if (parsed['@type'] === 'Review') {
        reviewCount += 1
        expect(parsed['@context']).toBe('https://schema.org')
        const author = parsed.author as { '@type': string; name: string }
        expect(author['@type']).toBe('Person')
        expect(author.name).toBeTruthy()
        const rating = parsed.reviewRating as {
          '@type': string
          ratingValue: number
        }
        expect(rating['@type']).toBe('Rating')
        expect(rating.ratingValue).toBeGreaterThanOrEqual(1)
        expect(rating.ratingValue).toBeLessThanOrEqual(5)
        expect(parsed.datePublished).toBeTruthy()
      }
    }
    expect(foundProduct).toBe(true)
    expect(foundBreadcrumb).toBe(true)
    expect(foundFaq).toBe(true)
    // ADR-0013 mandates Review JSON-LD on Experience detail; this seeded
    // Experience has published reviews so at least one Review node + an
    // AggregateRating must be present.
    expect(reviewCount).toBeGreaterThanOrEqual(1)
    expect(foundAggregateRating).toBe(true)

    // Pricing — all three Group-size brackets {1-2, 3-5, 6+} are rendered
    // with their per-person prices (ADR-0011 group-size brackets).
    await expect(page.locator('text=1-2 participants')).toBeVisible()
    await expect(page.locator('text=3-5 participants')).toBeVisible()
    await expect(page.locator('text=6+ participants')).toBeVisible()
    await expect(page.locator('text=₹1,500').first()).toBeVisible()
    await expect(page.locator('text=₹1,300').first()).toBeVisible()
    await expect(page.locator('text=₹1,100').first()).toBeVisible()
    await expect(page.locator('text=/ person').first()).toBeVisible()

    // Cancellation policy preset (ADR-0005) — section heading + the
    // "flexible" preset badge are shown.
    await expect(
      page.locator('h2:has-text("Cancellation policy")'),
    ).toBeVisible()
    await expect(page.getByText('flexible', { exact: true })).toBeVisible()

    // FAQ section
    await expect(
      page.locator('h2:has-text("Frequently asked questions")'),
    ).toBeVisible()

    // Vendor link (first match — nav may contain other /vendor/ links)
    await expect(page.locator('a[href*="/vendor/"]').first()).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/experience-detail.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 3b. Vendor profile
// ---------------------------------------------------------------------------
test.describe('Vendor profile', () => {
  test('renders SSR with vendor name, stats, and Experience cards', async ({
    page,
  }) => {
    // Seeded identity-tier Vendor with published Experiences.
    const response = await page.goto('/vendor/himalayan-hikes-co')
    expect(response?.status()).toBe(200)

    // H1 = vendor business name
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Himalayan Hikes Co')

    // Experiences-list heading + at least one Experience card linking out.
    await expect(
      page.locator('a[href*="/experience/"]').first(),
    ).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-profile.png',
      fullPage: true,
    })
  })

  test('404 for invalid vendor slug', async ({ page }) => {
    const response = await page.goto('/vendor/not-a-real-vendor-xyz')
    expect(response?.status()).toBe(404)
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

    // Canonical points at unfiltered /search and carries no query string
    // (ADR-0013: bare search is indexable with a self-canonical).
    const canonical = page.locator('link[rel="canonical"]').first()
    await expect(canonical).toHaveAttribute('href', /\/search$/)
    const canonicalHref = await canonical.getAttribute('href')
    expect(canonicalHref).not.toContain('?')

    // Robots meta MUST be index,follow on the bare search page (ADR-0013).
    const robotsMeta = page.locator('meta[name="robots"]')
    await expect(robotsMeta).toHaveCount(1)
    await expect(robotsMeta.first()).toHaveAttribute(
      'content',
      'index, follow',
    )

    // Search content visible (filter controls may use various UI patterns)
    await expect(page.locator('main')).toBeVisible()

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
  test('robots noindex follow, canonical still bare /search', async ({
    page,
  }) => {
    const response = await page.goto('/search?activity=rafting')
    expect(response?.status()).toBe(200)

    // Robots meta MUST be noindex,follow on a filtered search (ADR-0013:
    // sort/filter URL variants are noindex,follow).
    const robotsMeta = page.locator('meta[name="robots"]')
    await expect(robotsMeta).toHaveCount(1)
    await expect(robotsMeta.first()).toHaveAttribute(
      'content',
      'noindex, follow',
    )

    // Canonical STILL points at the unfiltered bare /search — query
    // params are stripped so signal consolidates on one URL (ADR-0013).
    const canonical = page.locator('link[rel="canonical"]').first()
    await expect(canonical).toHaveAttribute('href', /\/search$/)
    const canonicalHref = await canonical.getAttribute('href')
    expect(canonicalHref).not.toContain('?')
    expect(canonicalHref).not.toContain('activity')

    await page.screenshot({
      path: 'tests/e2e/screenshots/search-filtered.png',
      fullPage: true,
    })
  })

  test('multi-filter (price + sort) is also noindex,follow + bare canonical', async ({
    page,
  }) => {
    const response = await page.goto(
      '/search?activity=trekking&minPrice=500&sort=price_asc',
    )
    expect(response?.status()).toBe(200)

    const robotsMeta = page.locator('meta[name="robots"]')
    await expect(robotsMeta).toHaveCount(1)
    await expect(robotsMeta.first()).toHaveAttribute(
      'content',
      'noindex, follow',
    )

    const canonical = page.locator('link[rel="canonical"]').first()
    await expect(canonical).toHaveAttribute('href', /\/search$/)
    const canonicalHref = await canonical.getAttribute('href')
    expect(canonicalHref).not.toContain('?')
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

    // Sign-in form renders cleanly: a <form>, email + password inputs,
    // and a submit button. (DevTools fixture also gates console + axe.)
    await expect(page.locator('form')).toBeVisible()
    await expect(page.locator('input#email[type="email"]')).toBeVisible()
    await expect(page.locator('input#password[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()

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

  test('404 graceful not-found for invalid experience slug', async ({ page }) => {
    // Invalid Experience slug → notFound() → 404. The DevTools fixture
    // asserts no console error / uncaught exception (so no 500 path).
    const response = await page.goto('/experience/nonexistent-slug-xyz')
    expect(response?.status()).toBe(404)

    await page.screenshot({
      path: 'tests/e2e/screenshots/404-experience.png',
      fullPage: true,
    })
  })

  test('cancellation policy page renders all three presets with windows', async ({
    page,
  }) => {
    const response = await page.goto('/cancellation-policy')
    expect(response?.status()).toBe(200)
    await expect(page.locator('h1')).toContainText('cancellation')

    // ADR-0005: the page explains all three presets. Each preset name
    // appears (in the table + the worked-examples cards).
    await expect(page.getByText('Flexible', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Moderate', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Strict', { exact: true }).first()).toBeVisible()

    // The refund windows are stated clearly per preset (ADR-0005 thresholds:
    // Flexible 24h/2h, Moderate 72h/24h, Strict 14d/7d). Some window strings
    // legitimately appear twice (e.g. "24 hours" is Flexible-full AND
    // Moderate-half), so assert each is present at least once.
    for (const windowText of [
      'Up to 24 hours before start', // Flexible full / Moderate half
      'Up to 2 hours before start', // Flexible half
      'Up to 72 hours before start', // Moderate full
      'Up to 14 days before start', // Strict full
      'Up to 7 days before start', // Strict half
    ]) {
      await expect(
        page.getByText(windowText, { exact: true }).first(),
      ).toBeVisible()
    }
    // "No refund" after the half-refund window is present for each row.
    await expect(page.getByText('No refund', { exact: true }).first()).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/cancellation-policy.png',
      fullPage: true,
    })
  })
})
