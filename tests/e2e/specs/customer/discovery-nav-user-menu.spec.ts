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

import type { Page } from '@playwright/test'

import { test, expect } from '../../fixtures/devtools'

test.describe('User menu — Trip Groups (authenticated customer)', () => {
  // The avatar (UserMenu) trigger is rendered by AuthStatus AFTER the client
  // session resolves; the primary chrome also now carries a NotificationBell
  // (issue 03 redesign). Both the avatar and the bell are Base UI menus
  // (`aria-haspopup="menu"`), while the language selector is a listbox. A bare
  // `nav.getByRole('button').last()` raced the async session load (it could
  // resolve to the language selector before the avatar mounted) and opened the
  // wrong popup. Open the account menu by its accessible "menu" handle instead,
  // taking the LAST such trigger (bell is first, avatar is last), and wait for
  // it to mount first so the click can never land on a still-loading chrome.
  async function openMenu(page: Page) {
    const nav = page.getByRole('navigation', { name: 'Primary' })
    // The avatar trigger is the last `aria-haspopup="menu"` button in the nav
    // (the NotificationBell is the first). Wait for it, then open the menu.
    const trigger = nav
      .locator('button[aria-haspopup="menu"]')
      .last()
    await expect(trigger).toBeVisible()
    await trigger.click()
  }

  test('account menu surfaces "Trip Groups" → /community', async ({ page }) => {
    await page.goto('/')
    await openMenu(page)

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
    await openMenu(page)

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
