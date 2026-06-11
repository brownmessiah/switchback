/**
 * E2E — minimal Headout-style header (owner screenshots, 2026-06-11).
 *
 * Supersedes the issue-03 discovery-forward bar: the header carries ONLY the
 * wordmark, the supply-side "List your experience" CTA, the theme/locale
 * utilities and the auth control. The five discovery surfaces stay reachable
 * through the footer's link columns; the hero search is the discovery entry.
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

  test('shows the "List your experience" CTA → /vendor-partner (issue 06)', async ({
    page,
  }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(
      nav.getByRole('link', { name: 'List your experience' }),
    ).toHaveAttribute('href', '/vendor-partner')
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
