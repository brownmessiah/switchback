/**
 * Responsive verification — ADMIN back-office below lg (ADR-0018 §8.6 /
 * DESIGN.md §8). Runs under responsive-phone-admin (375) + responsive-tablet-admin
 * (768), coarse-pointer, with a fresh admin session injected. Axe-gated via the
 * devtools fixture at the mobile/tablet viewport.
 *
 * Tier contract (§8.3 / §8.5): the back-office sidebar is a Sheet-based hamburger
 * DRAWER below md and a persistent RAIL at md+; the ~24 A3 tables collapse to
 * stacked label:value Cards below md (the ResponsiveTable reversal) and return to
 * a real table at md+; and the dense money queues never page-h-scroll.
 */
import { test, expect } from '../../../fixtures/devtools'
import type { Page } from '@playwright/test'

function pageHorizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

function isMd(page: Page): Promise<boolean> {
  return page.evaluate(() => window.matchMedia('(min-width: 768px)').matches)
}

test.describe('responsive · admin back-office', () => {
  test('sidebar: hamburger Sheet drawer below md, persistent rail at md+', async ({ page }) => {
    await page.goto('/admin/dashboard', { waitUntil: 'networkidle' })
    if (await isMd(page)) {
      // tablet+: the persistent rail is shown; the mobile top-bar is gone.
      await expect(page.locator('[data-slot="portal-nav-rail"]')).toBeVisible()
      await expect(page.locator('[data-slot="portal-nav-topbar"]')).toBeHidden()
    } else {
      // phone: the top-bar hamburger opens a Sheet drawer (Base UI primitive —
      // focus-trap / Escape / restore inherited, per §8.5).
      const topbar = page.locator('[data-slot="portal-nav-topbar"]')
      await expect(topbar).toBeVisible()
      await topbar.getByRole('button').first().click()
      const drawer = page.getByRole('dialog')
      await expect(drawer).toBeVisible()
      await expect(drawer.getByRole('link').first()).toBeVisible()
    }
  })

  test('admin users: no page h-scroll; table card-collapses below md, returns at md+', async ({
    page,
  }) => {
    await page.goto('/admin/users', { waitUntil: 'networkidle' })
    expect(
      await pageHorizontalOverflow(page),
      'horizontal overflow on /admin/users',
    ).toBeLessThanOrEqual(2)
    const table = page.locator('[data-slot="responsive-table"] table[data-slot="table"]')
    if (await isMd(page)) {
      await expect(table).toBeVisible() // tablet tier: the real A3 table returns
    } else {
      await expect(table).toBeHidden() // phone tier: stacked label:value cards
    }
  })

  test('admin money queues do not page-h-scroll on phone/tablet', async ({ page }) => {
    for (const url of ['/admin/refunds', '/admin/payouts', '/admin/bookings']) {
      await page.goto(url, { waitUntil: 'networkidle' })
      expect(
        await pageHorizontalOverflow(page),
        `horizontal overflow on ${url}`,
      ).toBeLessThanOrEqual(2)
    }
  })
})
