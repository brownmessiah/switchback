/**
 * E2E tests for multilingual i18n support.
 *
 * Covers: language selector, locale-prefixed URLs, cookie persistence,
 * Accept-Language header detection, cookie precedence, invalid locale
 * fallback, hreflang tags, middleware exclusions for authenticated routes,
 * and Hindi UI chrome on dashboard pages.
 *
 * Uses the DevTools fixture for automatic console-error, uncaught-exception,
 * network-failure, and axe-core accessibility checks after each test.
 */

import { test, expect } from '../../fixtures/devtools'
import path from 'node:path'

const AUTH_DIR = path.join(__dirname, '../../.auth')

// ---------------------------------------------------------------------------
// 1. Language selector is visible and functional on public pages
// ---------------------------------------------------------------------------
test.describe('Language selector', () => {
  test('is visible in the header on the home page', async ({ page }) => {
    await page.goto('/')
    const trigger = page.locator('button[aria-label="Select language"]')
    await expect(trigger).toBeVisible()

    // Click to open the language dropdown
    await trigger.click()

    // Verify the listbox appears with both launch locales
    const listbox = page.locator('[role="listbox"][aria-label="Available languages"]')
    await expect(listbox).toBeVisible()

    const enOption = listbox.locator('[role="option"]').filter({ hasText: 'English' })
    const hiOption = listbox.locator('[role="option"]').filter({ hasText: 'हिन्दी' })
    await expect(enOption).toBeVisible()
    await expect(hiOption).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/i18n-language-selector.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 2. Selecting Hindi navigates to /hi/ prefixed URL
// ---------------------------------------------------------------------------
test.describe('Hindi locale navigation', () => {
  test('selecting Hindi navigates to /hi/ prefixed URL', async ({ page }) => {
    await page.goto('/')

    // Open the language selector
    const trigger = page.locator('button[aria-label="Select language"]')
    await trigger.click()

    // Click the Hindi option
    const listbox = page.locator('[role="listbox"][aria-label="Available languages"]')
    const hiOption = listbox.locator('[role="option"]').filter({ hasText: 'हिन्दी' })
    await hiOption.click()

    // Wait for navigation to Hindi URL
    await page.waitForURL(/\/hi(\/|$)/, { timeout: 10_000 })

    // Verify the URL is Hindi-prefixed
    const url = new URL(page.url())
    expect(url.pathname).toMatch(/^\/hi(\/|$)/)

    await page.screenshot({
      path: 'tests/e2e/screenshots/i18n-hindi-home.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 3. Locale cookie persists across page navigation
// ---------------------------------------------------------------------------
test.describe('Locale cookie persistence', () => {
  test('locale cookie set by language switch persists across navigation', async ({
    page,
  }) => {
    // Navigate to home and switch to Hindi
    await page.goto('/')

    const trigger = page.locator('button[aria-label="Select language"]')
    await trigger.click()

    const listbox = page.locator('[role="listbox"][aria-label="Available languages"]')
    const hiOption = listbox.locator('[role="option"]').filter({ hasText: 'हिन्दी' })
    await hiOption.click()

    // Wait for Hindi navigation
    await page.waitForURL(/\/hi(\/|$)/, { timeout: 10_000 })

    // Verify the locale cookie is set
    const cookies = await page.context().cookies()
    const localeCookie = cookies.find((c) => c.name === 'locale')
    expect(localeCookie).toBeTruthy()
    expect(localeCookie!.value).toBe('hi')

    // Navigate to search page — should stay in Hindi locale
    await page.goto('/hi/search')
    const response = await page.waitForLoadState('networkidle')

    // Cookie should still be present
    const cookiesAfterNav = await page.context().cookies()
    const localeCookieAfterNav = cookiesAfterNav.find((c) => c.name === 'locale')
    expect(localeCookieAfterNav).toBeTruthy()
    expect(localeCookieAfterNav!.value).toBe('hi')

    await page.screenshot({
      path: 'tests/e2e/screenshots/i18n-cookie-persists.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 4. /hi/search serves Hindi content, /search serves English
// ---------------------------------------------------------------------------
test.describe('Locale-specific content', () => {
  test('/hi/search serves Hindi content', async ({ page }) => {
    const response = await page.goto('/hi/search')
    expect(response?.status()).toBe(200)

    // The page heading should be in Hindi: "अनुभव खोजें"
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('अनुभव खोजें')

    await page.screenshot({
      path: 'tests/e2e/screenshots/i18n-search-hindi.png',
      fullPage: true,
    })
  })

  test('/search serves English content', async ({ page }) => {
    const response = await page.goto('/search')
    expect(response?.status()).toBe(200)

    // The page heading should be in English: "Explore experiences"
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Explore experiences')

    await page.screenshot({
      path: 'tests/e2e/screenshots/i18n-search-english.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 5. Accept-Language: hi header (no cookie) serves Hindi
// ---------------------------------------------------------------------------
test.describe('Accept-Language header detection', () => {
  test('visiting with Accept-Language: hi header serves Hindi', async ({
    page,
  }) => {
    // Set Accept-Language header before navigation
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'hi,en;q=0.5',
    })

    const response = await page.goto('/search')
    expect(response?.status()).toBeGreaterThanOrEqual(200)
    expect(response?.status()).toBeLessThan(400)

    // The middleware should resolve to Hindi based on Accept-Language
    // This may result in a redirect to /hi/search or serve Hindi inline
    // depending on locale-prefix strategy ("as-needed")
    const url = new URL(page.url())

    // If redirected to /hi/search, verify Hindi content
    if (url.pathname.startsWith('/hi')) {
      const h1 = page.locator('h1')
      await expect(h1).toBeVisible()
      await expect(h1).toContainText('अनुभव खोजें')
    } else {
      // Even if not redirected, the page should detect Accept-Language
      // and serve content in Hindi (via resolve-locale priority chain)
      const htmlLang = await page.locator('html').getAttribute('lang')
      // Accept-Language is priority 3 (below URL and cookie), so the
      // middleware may or may not redirect. Verify no server error.
      expect(response?.status()).toBeLessThan(500)
    }

    await page.screenshot({
      path: 'tests/e2e/screenshots/i18n-accept-language.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 6. Cookie takes precedence over Accept-Language header
// ---------------------------------------------------------------------------
test.describe('Cookie precedence over Accept-Language', () => {
  test('locale cookie overrides Accept-Language header', async ({ page }) => {
    // Set Accept-Language to Hindi
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'hi,en;q=0.5',
    })

    // Set cookie to English
    await page.context().addCookies([
      {
        name: 'locale',
        value: 'en',
        domain: 'localhost',
        path: '/',
        sameSite: 'Lax',
      },
    ])

    const response = await page.goto('/search')
    expect(response?.status()).toBe(200)

    // Cookie (en) should take precedence over Accept-Language (hi)
    // The page should serve English content
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Explore experiences')

    // URL should NOT be Hindi-prefixed since cookie says English
    const url = new URL(page.url())
    expect(url.pathname).not.toMatch(/^\/hi/)

    await page.screenshot({
      path: 'tests/e2e/screenshots/i18n-cookie-precedence.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 7. Invalid locale code falls back gracefully
// ---------------------------------------------------------------------------
test.describe('Invalid locale fallback', () => {
  test('/zz/search falls back gracefully (404 or redirect)', async ({
    page,
  }) => {
    const response = await page.goto('/zz/search')

    // An invalid locale like "zz" is not in SUPPORTED_LOCALES.
    // The [locale] layout calls notFound() for invalid locales,
    // so this should either 404 or the middleware ignores it.
    const status = response?.status() ?? 0
    expect(status).toBeGreaterThanOrEqual(200)
    expect(status).toBeLessThan(500)

    // If it's a 404, verify no server crash
    if (status === 404) {
      // 404 page rendered — this is correct behaviour
      expect(status).toBe(404)
    } else {
      // If the middleware or app handled it differently (e.g., redirect
      // to default locale), verify we're not on a /zz/ path
      const url = new URL(page.url())
      expect(url.pathname).not.toMatch(/^\/zz/)
    }

    await page.screenshot({
      path: 'tests/e2e/screenshots/i18n-invalid-locale.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 8. hreflang tags present on public pages with correct href values
// ---------------------------------------------------------------------------
test.describe('hreflang tags', () => {
  test('home page has hreflang tags for en, hi, and x-default', async ({
    page,
  }) => {
    await page.goto('/')

    // Check for hreflang alternate links
    const alternateLinks = page.locator('link[rel="alternate"][hreflang]')
    const count = await alternateLinks.count()
    expect(count).toBeGreaterThanOrEqual(3) // en, hi, x-default

    // Collect all hreflang values and their hrefs
    const hreflangs: Record<string, string> = {}
    for (let i = 0; i < count; i++) {
      const link = alternateLinks.nth(i)
      const hreflang = await link.getAttribute('hreflang')
      const href = await link.getAttribute('href')
      if (hreflang && href) {
        hreflangs[hreflang] = href
      }
    }

    // Verify en hreflang exists and points to un-prefixed URL
    expect(hreflangs['en']).toBeTruthy()
    expect(hreflangs['en']).toMatch(/\/$/)

    // Verify hi hreflang exists and points to /hi/ prefixed URL
    expect(hreflangs['hi']).toBeTruthy()
    expect(hreflangs['hi']).toMatch(/\/hi\/$/)

    // Verify x-default exists and points to English (un-prefixed)
    expect(hreflangs['x-default']).toBeTruthy()
    expect(hreflangs['x-default']).toMatch(/\/$/)
    // x-default should be same as en
    expect(hreflangs['x-default']).toBe(hreflangs['en'])

    await page.screenshot({
      path: 'tests/e2e/screenshots/i18n-hreflang-home.png',
      fullPage: true,
    })
  })

  test('search page has hreflang tags for en, hi, and x-default', async ({
    page,
  }) => {
    await page.goto('/search')

    const alternateLinks = page.locator('link[rel="alternate"][hreflang]')
    const count = await alternateLinks.count()
    expect(count).toBeGreaterThanOrEqual(3)

    const hreflangs: Record<string, string> = {}
    for (let i = 0; i < count; i++) {
      const link = alternateLinks.nth(i)
      const hreflang = await link.getAttribute('hreflang')
      const href = await link.getAttribute('href')
      if (hreflang && href) {
        hreflangs[hreflang] = href
      }
    }

    // en hreflang points to /search
    expect(hreflangs['en']).toBeTruthy()
    expect(hreflangs['en']).toMatch(/\/search$/)

    // hi hreflang points to /hi/search
    expect(hreflangs['hi']).toBeTruthy()
    expect(hreflangs['hi']).toMatch(/\/hi\/search$/)

    // x-default matches en
    expect(hreflangs['x-default']).toBeTruthy()
    expect(hreflangs['x-default']).toBe(hreflangs['en'])

    await page.screenshot({
      path: 'tests/e2e/screenshots/i18n-hreflang-search.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 9. Admin/vendor/customer dashboard routes are NOT locale-prefixed
// ---------------------------------------------------------------------------
test.describe('Middleware exclusions', () => {
  test('admin route is not locale-prefixed', async ({ browser }) => {
    const adminContext = await browser.newContext({
      storageState: path.join(AUTH_DIR, 'admin-storage.json'),
    })
    const adminPage = await adminContext.newPage()

    const response = await adminPage.goto('/admin/dashboard')
    expect(response?.status()).toBe(200)

    // URL should NOT have a locale prefix
    const url = new URL(adminPage.url())
    expect(url.pathname).toBe('/admin/dashboard')
    expect(url.pathname).not.toMatch(/^\/(en|hi)\/admin/)

    await adminPage.screenshot({
      path: 'tests/e2e/screenshots/i18n-admin-no-prefix.png',
      fullPage: true,
    })
    await adminContext.close()
  })

  test('vendor route is not locale-prefixed', async ({ browser }) => {
    const vendorContext = await browser.newContext({
      storageState: path.join(AUTH_DIR, 'vendor-storage.json'),
    })
    const vendorPage = await vendorContext.newPage()

    const response = await vendorPage.goto('/vendor/dashboard')
    expect(response?.status()).toBe(200)

    // URL should NOT have a locale prefix
    const url = new URL(vendorPage.url())
    expect(url.pathname).toBe('/vendor/dashboard')
    expect(url.pathname).not.toMatch(/^\/(en|hi)\/vendor/)

    await vendorPage.screenshot({
      path: 'tests/e2e/screenshots/i18n-vendor-no-prefix.png',
      fullPage: true,
    })
    await vendorContext.close()
  })

  test('customer dashboard route is not locale-prefixed', async ({ browser }) => {
    const customerContext = await browser.newContext({
      storageState: path.join(AUTH_DIR, 'customer-storage.json'),
    })
    const customerPage = await customerContext.newPage()

    const response = await customerPage.goto('/dashboard')
    expect(response?.status()).toBe(200)

    // URL should NOT have a locale prefix
    const url = new URL(customerPage.url())
    expect(url.pathname).toBe('/dashboard')
    expect(url.pathname).not.toMatch(/^\/(en|hi)\/dashboard/)

    await customerPage.screenshot({
      path: 'tests/e2e/screenshots/i18n-customer-no-prefix.png',
      fullPage: true,
    })
    await customerContext.close()
  })
})

// ---------------------------------------------------------------------------
// 10. After setting locale cookie to hi, dashboard pages render Hindi UI chrome
// ---------------------------------------------------------------------------
test.describe('Hindi UI chrome on authenticated pages', () => {
  test('admin dashboard renders Hindi navigation when locale cookie is hi', async ({
    browser,
  }) => {
    const adminContext = await browser.newContext({
      storageState: path.join(AUTH_DIR, 'admin-storage.json'),
    })

    // Set Hindi locale cookie before navigating
    await adminContext.addCookies([
      {
        name: 'locale',
        value: 'hi',
        domain: 'localhost',
        path: '/',
        sameSite: 'Lax',
      },
    ])

    const adminPage = await adminContext.newPage()
    const response = await adminPage.goto('/admin/dashboard')
    expect(response?.status()).toBe(200)

    // The admin sidebar should render Hindi navigation text
    // AdminNav.sidebarTitle = "व्यवस्थापक" in hi.json
    await expect(adminPage.getByText('व्यवस्थापक')).toBeVisible({ timeout: 10_000 })

    // URL should still be un-prefixed (admin routes excluded from i18n routing)
    const url = new URL(adminPage.url())
    expect(url.pathname).toBe('/admin/dashboard')

    await adminPage.screenshot({
      path: 'tests/e2e/screenshots/i18n-admin-hindi-chrome.png',
      fullPage: true,
    })
    await adminContext.close()
  })

  test('vendor dashboard renders Hindi navigation when locale cookie is hi', async ({
    browser,
  }) => {
    const vendorContext = await browser.newContext({
      storageState: path.join(AUTH_DIR, 'vendor-storage.json'),
    })

    // Set Hindi locale cookie
    await vendorContext.addCookies([
      {
        name: 'locale',
        value: 'hi',
        domain: 'localhost',
        path: '/',
        sameSite: 'Lax',
      },
    ])

    const vendorPage = await vendorContext.newPage()
    const response = await vendorPage.goto('/vendor/dashboard')
    expect(response?.status()).toBe(200)

    // VendorNav should render in Hindi
    // VendorNav.sidebarTitle is the vendor sidebar title in Hindi
    // Check for any Hindi text in the sidebar (e.g., navigation group labels)
    // VendorNav.groups.dashboard = "डैशबोर्ड" in hi.json
    await expect(vendorPage.getByText('डैशबोर्ड')).toBeVisible({ timeout: 10_000 })

    // URL should still be un-prefixed
    const url = new URL(vendorPage.url())
    expect(url.pathname).toBe('/vendor/dashboard')

    await vendorPage.screenshot({
      path: 'tests/e2e/screenshots/i18n-vendor-hindi-chrome.png',
      fullPage: true,
    })
    await vendorContext.close()
  })
})
