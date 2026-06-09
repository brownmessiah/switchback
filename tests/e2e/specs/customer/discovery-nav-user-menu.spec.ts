/**
 * E2E — Trip Groups surfaced in the user menu (issue 03, DECISION D2).
 *
 * Authenticated customer (customer storage state). The old vague "Community"
 * primary tab is gone; the (real) Trip Groups product (ADR-0009) now lives in
 * the account menu and still routes to /community. Asserts the menu entry, that
 * it navigates to a resolving /community page, and that no "Community" tab
 * remains in the primary bar.
 *
 * DevTools fixture → axe (wcag2a+wcag2aa) + console-error gating per test.
 */

import { test, expect } from '../../fixtures/devtools'

test.describe('User menu — Trip Groups (authenticated customer)', () => {
  test('account menu surfaces "Trip Groups" → /community', async ({ page }) => {
    await page.goto('/')

    // The avatar trigger is the only menu button in the primary chrome once
    // authenticated (AuthStatus renders the UserMenu).
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await nav.getByRole('button').last().click()

    const tripGroups = page.getByRole('menuitem', { name: 'Trip Groups' })
    await expect(tripGroups).toBeVisible()
    await expect(tripGroups.getByRole('link')).toHaveAttribute(
      'href',
      '/community',
    )
  })

  test('Trip Groups entry navigates to a resolving /community page', async ({
    page,
  }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await nav.getByRole('button').last().click()

    await Promise.all([
      page.waitForURL(/\/community\b/),
      page.getByRole('menuitem', { name: 'Trip Groups' }).click(),
    ])
    expect(new URL(page.url()).pathname).toMatch(/^\/community/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('no "Community" tab remains in the primary bar', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav.getByRole('link', { name: 'Community' })).toHaveCount(0)
  })
})
