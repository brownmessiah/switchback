/**
 * Pre-launch home page (launch-readiness 04).
 *
 * Runs against the `prelaunch` webServer (localhost:3100) backed by a
 * SECOND, isolated database (`outvers_e2e_prelaunch` — schema + editorial
 * blog corpus, ZERO publicly-visible Experiences), provisioned in
 * `tests/e2e/global-setup.ts` via `resetPrelaunchDatabase()`. With zero
 * publicly-visible Experiences, `getMarketplaceState()` resolves
 * 'pre-launch' and `app/[locale]/(marketing)/page.tsx` renders
 * `<PreLaunchHome>` instead of the live marketplace composition.
 *
 * Uses the shared DevTools fixture (console errors, uncaught exceptions,
 * 4xx/5xx responses, axe wcag2a+wcag2aa) — see ../../fixtures/devtools.ts.
 * The `prelaunch-phone` / `prelaunch-tablet` projects re-run this exact file
 * at 390x844 / 820x1180 (playwright.config.ts), so every assertion here —
 * including the axe pass in the fixture's afterEach — also runs at both
 * viewports.
 */

import { test, expect } from '../../fixtures/devtools'

test.describe('Pre-launch home', () => {
  test('loads 200 and renders exactly one <h1>, the pre-launch title', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toHaveCount(1)
    await expect(h1).toBeVisible()
    await expect(h1).not.toBeEmpty()
  })

  test('Vendor recruitment is present and prominent', async ({ page }) => {
    await page.goto('/')

    // Scoped to <main>: the site footer also carries a /vendor-partner
    // link, and the assertion here is about the PAGE's recruitment CTAs,
    // not the persistent chrome.
    const main = page.locator('main')

    // Primary CTA: a visible link straight into vendor onboarding.
    await expect(main.locator('a[href="/vendor/onboarding"]')).toBeVisible()

    // Secondary CTA sits alongside it.
    await expect(main.locator('a[href="/vendor-partner"]')).toBeVisible()
  })

  test('the launching-soon band is present', async ({ page }) => {
    await page.goto('/')

    const comingSoonHeading = page.locator('#prelaunch-coming-soon-heading')
    await expect(comingSoonHeading).toBeVisible()
  })

  test('blog posts render and a link to /blog is visible', async ({ page }) => {
    await page.goto('/')

    const blogCards = page.locator('a[href^="/blog/"]')
    await expect(blogCards.first()).toBeVisible()

    const viewAllBlogLink = page.locator('a[href="/blog"]')
    await expect(viewAllBlogLink.first()).toBeVisible()
  })

  test('the dead marketplace surfaces are gone: no region search links, no hero search', async ({
    page,
  }) => {
    await page.goto('/')

    // No destination tile ever links into a guaranteed zero-result search.
    await expect(page.locator('a[href^="/search?region="]')).toHaveCount(0)

    // No hero search landmark/input at all (role="search" + the
    // data-testid HomeHeroSearch renders — components/home/hero-search.tsx).
    await expect(page.getByRole('search')).toHaveCount(0)
    await expect(page.locator('[data-testid="home-hero-search"]')).toHaveCount(0)
  })

  test('a blog post remains reachable and resolves 200', async ({ page }) => {
    await page.goto('/')

    const firstPost = page.locator('a[href^="/blog/"]').first()
    const href = await firstPost.getAttribute('href')
    expect(href).toMatch(/^\/blog\/[a-z0-9-]+$/)

    const response = await page.goto(href!)
    expect(response?.status()).toBe(200)

    // Lands on the article itself — its own single <h1> is the post title.
    const articleH1 = page.locator('h1')
    await expect(articleH1).toHaveCount(1)
  })
})
