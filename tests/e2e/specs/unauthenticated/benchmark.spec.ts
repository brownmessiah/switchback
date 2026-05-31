/**
 * Core Web Vitals benchmark — MARKETING / customer-facing public pages.
 *
 * NON-BLOCKING (Issue #111): this spec captures TTFB / FCP / LCP / CLS +
 * navigation timing and LOGS them (console + annotations). It adds NO CWV
 * pass/fail thresholds — the only assertions are lenient "the page rendered"
 * checks so the full suite stays green. Dev-mode numbers (unminified, dev
 * server) are a RELATIVE baseline only, not production-representative.
 *
 * Recorded baseline: .scratch/mvp-validation-redesign/cwv-baseline.md
 *
 * Vitals capture is the shared helper in tests/e2e/helpers/web-vitals.ts,
 * reused by the customer benchmark spec.
 */

import { test } from '../../fixtures/devtools'
import {
  collectWebVitals,
  pushVitalsAnnotations,
  reportVitals,
} from '../../helpers/web-vitals'

/**
 * Marketing routes can return a transient 500 on first hit while the dev route
 * is still compiling. A single warm retry lets the now-built route serve
 * normally; a genuinely broken route still fails the caller's render check.
 */
async function gotoWarm(
  page: import('@playwright/test').Page,
  path: string,
): Promise<void> {
  const response = await page.goto(path, { waitUntil: 'load' })
  if (response?.status() === 500) {
    await page.waitForTimeout(1500)
    await page.goto(path, { waitUntil: 'load' })
  }
}

test.describe('Core Web Vitals benchmark (non-blocking)', () => {
  test.describe.configure({ mode: 'serial' })

  test('home page', async ({ page }, testInfo) => {
    await page.goto('/', { waitUntil: 'load' })
    const vitals = await collectWebVitals(page)
    reportVitals('Home (/)', vitals)

    // Lenient render check — the home heading is present.
    await test.expect(page.locator('h1').first()).toBeVisible()

    pushVitalsAnnotations(testInfo, vitals)
  })

  test('activity-city collection', async ({ page }, testInfo) => {
    await page.goto('/adventure/rafting-in-rishikesh', { waitUntil: 'load' })
    const vitals = await collectWebVitals(page)
    reportVitals('Collection (/adventure/rafting-in-rishikesh)', vitals)

    await test.expect(page.locator('h1').first()).toBeVisible()

    pushVitalsAnnotations(testInfo, vitals)
  })

  test('experience detail', async ({ page }, testInfo) => {
    await page.goto('/adventure/rafting-in-rishikesh', { waitUntil: 'load' })
    const experienceLink = page.locator('a[href*="/experience/"]').first()
    const href = await experienceLink.getAttribute('href')
    if (!href) {
      test.skip(true, 'No experience links found in collection')
      return
    }

    await page.goto(href, { waitUntil: 'load' })
    const vitals = await collectWebVitals(page)
    reportVitals(`Detail (${href})`, vitals)

    await test.expect(page.locator('h1').first()).toBeVisible()

    pushVitalsAnnotations(testInfo, vitals)
  })

  test('search page', async ({ page }, testInfo) => {
    await page.goto('/search', { waitUntil: 'load' })
    const vitals = await collectWebVitals(page)
    reportVitals('Search (/search)', vitals)

    await test.expect(page.locator('h1').first()).toBeVisible()

    pushVitalsAnnotations(testInfo, vitals)
  })

  // ── Additional top marketing pages (Issue #111) ──────────────────────────
  test('cancellation-policy page', async ({ page }, testInfo) => {
    await gotoWarm(page, '/cancellation-policy')
    const vitals = await collectWebVitals(page)
    reportVitals('Cancellation policy (/cancellation-policy)', vitals)

    await test.expect(page.locator('h1').first()).toBeVisible()

    pushVitalsAnnotations(testInfo, vitals)
  })

  test('sign-in page', async ({ page }, testInfo) => {
    await gotoWarm(page, '/sign-in')
    const vitals = await collectWebVitals(page)
    reportVitals('Sign in (/sign-in)', vitals)

    await test.expect(page.locator('h1').first()).toBeVisible()

    pushVitalsAnnotations(testInfo, vitals)
  })
})
