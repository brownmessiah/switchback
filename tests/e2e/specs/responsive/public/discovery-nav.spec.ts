/**
 * Responsive verification — the discovery-forward mobile drawer (issue 03,
 * DECISION D2). Runs under responsive-phone-public (375) +
 * responsive-tablet-public (768), both coarse-pointer so the §8.2 44px floor is
 * live. The `< sm` drawer (the header `<details>` menu) mirrors the desktop
 * primary bar: five discovery items + the "List your experience" CTA + Sign in,
 * and NO "Community" tab.
 *
 * DevTools fixture → axe (wcag2a+wcag2aa) gating per test.
 */

import { test, expect } from '../../../fixtures/devtools'

test.describe('mobile drawer · discovery nav (< sm)', () => {
  test('opens the drawer and mirrors the five discovery items + CTAs', async ({
    page,
  }) => {
    const width = page.viewportSize()?.width ?? 0
    // The `<details>` drawer is `sm:hidden`; at 768 (tablet) the desktop bar is
    // already shown, so the drawer only exists on the phone project.
    test.skip(width >= 640, 'drawer is < sm only; desktop bar covers >= sm')

    await page.goto('/')
    await page.getByRole('button', { name: 'Open menu' }).click()

    const nav = page.getByRole('navigation', { name: 'Mobile primary' })
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
    await expect(
      nav.getByRole('link', { name: 'List your experience' }),
    ).toHaveAttribute('href', '/vendor-partner')
    await expect(nav.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in',
    )
  })

  test('the drawer has NO "Community" item', async ({ page }) => {
    const width = page.viewportSize()?.width ?? 0
    test.skip(width >= 640, 'drawer is < sm only; desktop bar covers >= sm')

    await page.goto('/')
    await page.getByRole('button', { name: 'Open menu' }).click()
    const nav = page.getByRole('navigation', { name: 'Mobile primary' })
    await expect(nav.getByRole('link', { name: 'Community' })).toHaveCount(0)
  })

  test('every drawer link meets the 44px tap-target floor (ADR-0018 §8.2)', async ({
    page,
  }) => {
    const width = page.viewportSize()?.width ?? 0
    test.skip(width >= 640, 'drawer is < sm only; desktop bar covers >= sm')

    await page.goto('/')
    await page.getByRole('button', { name: 'Open menu' }).click()
    const nav = page.getByRole('navigation', { name: 'Mobile primary' })
    const links = nav.getByRole('link')
    const count = await links.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const box = await links.nth(i).boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    }
  })
})
