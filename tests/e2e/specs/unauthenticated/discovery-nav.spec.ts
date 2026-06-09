/**
 * E2E — discovery-forward primary nav (issue 03, DECISION D2).
 *
 * Desktop (default Desktop Chrome viewport). Asserts the five discovery items
 * with their hrefs, the right-side "List your experience" CTA → /vendor-partner,
 * and that the old vague "Community" tab is GONE from the primary bar (the
 * /community route itself still resolves — covered separately).
 *
 * DevTools fixture → axe (wcag2a+wcag2aa) + console-error gating per test.
 */

import { test, expect } from '../../fixtures/devtools'

test.describe('Primary nav — discovery-forward (desktop)', () => {
  test('shows the five discovery items with correct hrefs; Explore → /search', async ({
    page,
  }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })

    await expect(nav.getByRole('link', { name: 'Explore' })).toHaveAttribute(
      'href',
      '/search',
    )
    await expect(
      nav.getByRole('link', { name: 'Destinations' }),
    ).toHaveAttribute('href', '/destinations')
    await expect(
      nav.getByRole('link', { name: 'Activities' }),
    ).toHaveAttribute('href', '/search')
    await expect(nav.getByRole('link', { name: 'Safety' })).toHaveAttribute(
      'href',
      '/safety',
    )
    await expect(nav.getByRole('link', { name: 'Blog' })).toHaveAttribute(
      'href',
      '/blog',
    )
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

  test('has NO "Community" item in the primary bar', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav.getByRole('link', { name: 'Community' })).toHaveCount(0)
  })

  test('Explore navigates to the search grid', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await Promise.all([
      page.waitForURL(/\/search\b/),
      nav.getByRole('link', { name: 'Explore' }).click(),
    ])
    expect(new URL(page.url()).pathname).toMatch(/\/search$/)
  })

  test('the /community route still resolves (product relabelled, not removed)', async ({
    page,
  }) => {
    const response = await page.goto('/community')
    expect(response?.status()).toBe(200)
  })
})
