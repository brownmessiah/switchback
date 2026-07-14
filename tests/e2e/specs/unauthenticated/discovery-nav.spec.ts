/**
 * E2E — customer-centric header (home-redesign issue 06 / D3).
 *
 * Customer-centric since home-redesign issue 06 (D3): the header carries the
 * wordmark, Wishlist, the theme/locale utilities + static "₹ INR" badge (D5)
 * and the auth control — the vendor CTA moved to the footer's "For Vendors"
 * column. The five discovery surfaces stay reachable through the footer's
 * link columns; the hero search is the discovery entry.
 *
 * DevTools fixture → axe (wcag2a+wcag2aa) + console-error gating per test.
 */

import { test, expect } from '../../fixtures/devtools'

const REMOVED_DISCOVERY_LABELS = [
  'Explore',
  'Destinations',
  'Activities',
  'Safety',
  'Blog',
  'Community',
  'Experiences',
]

test.describe('Primary nav — minimal header (desktop)', () => {
  test('carries no discovery links in the primary bar', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })

    for (const label of REMOVED_DISCOVERY_LABELS) {
      await expect(
        nav.getByRole('link', { name: label, exact: true }),
      ).toHaveCount(0)
    }
  })

  // Home-redesign issue 06 (D3): the header is customer-centric — the vendor
  // CTA moved out (footer "For Vendors" column keeps the supply-side entry),
  // Wishlist joins, and a static "₹ INR" badge sits beside the FUNCTIONAL
  // language selector (D5).
  test('customer-centric header: Wishlist + ₹ INR badge, no vendor CTA (issue 06)', async ({
    page,
  }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(
      nav.getByRole('link', { name: 'List your experience' }),
    ).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Wishlist' })).toHaveAttribute(
      'href',
      '/wishlist',
    )
    await expect(nav.getByText('₹ INR')).toBeVisible()
  })

  test('logged-out Wishlist click lands on /sign-in (auth-gated route)', async ({
    page,
  }) => {
    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Wishlist' })
      .click()
    await page.waitForURL(/\/sign-in/)
    expect(new URL(page.url()).pathname).toBe('/sign-in')
  })

  test('discovery stays reachable via the footer link columns', async ({
    page,
  }) => {
    await page.goto('/')
    const footerNav = page.getByRole('navigation', {
      name: 'Footer navigation',
    })
    await expect(
      footerNav.getByRole('link', { name: 'Safety & trust' }),
    ).toHaveAttribute('href', '/safety')
    await expect(
      footerNav.getByRole('link', { name: 'Blog' }),
    ).toHaveAttribute('href', '/blog')
  })

  test('the /community route still resolves (product relabelled, not removed)', async ({
    page,
  }) => {
    const response = await page.goto('/community')
    expect(response?.status()).toBe(200)
  })
})
