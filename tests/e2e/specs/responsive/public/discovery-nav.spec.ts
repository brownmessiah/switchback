/**
 * Responsive verification — the minimal mobile menu (owner screenshots,
 * 2026-06-11; supersedes the issue-03 discovery drawer). Runs under
 * responsive-phone-public (375) + responsive-tablet-public (768), both
 * coarse-pointer so the §8.2 44px floor is live. The `< sm` `<details>` menu
 * mirrors the minimal desktop bar: "List your experience" + Sign in + the
 * theme/locale utilities — NO discovery links.
 *
 * DevTools fixture → axe (wcag2a+wcag2aa) gating per test.
 */

import { test, expect } from '../../../fixtures/devtools'

const REMOVED_DISCOVERY_LABELS = [
  'Explore',
  'Destinations',
  'Activities',
  'Safety',
  'Blog',
  'Community',
]

test.describe('mobile menu · minimal header (< sm)', () => {
  test('opens the menu and carries only the supply CTA + Sign in', async ({
    page,
  }) => {
    const width = page.viewportSize()?.width ?? 0
    // The `<details>` menu is `sm:hidden`; at 768 (tablet) the desktop bar is
    // already shown, so the menu only exists on the phone project.
    test.skip(width >= 640, 'menu is < sm only; desktop bar covers >= sm')

    await page.goto('/')
    await page.getByRole('button', { name: 'Open menu' }).click()

    const nav = page.getByRole('navigation', { name: 'Mobile primary' })
    await expect(
      nav.getByRole('link', { name: 'List your experience' }),
    ).toHaveAttribute('href', '/vendor-partner')
    await expect(nav.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in',
    )
    for (const label of REMOVED_DISCOVERY_LABELS) {
      await expect(
        nav.getByRole('link', { name: label, exact: true }),
      ).toHaveCount(0)
    }
  })

  test('every menu link meets the 44px tap-target floor (ADR-0018 §8.2)', async ({
    page,
  }) => {
    const width = page.viewportSize()?.width ?? 0
    test.skip(width >= 640, 'menu is < sm only; desktop bar covers >= sm')

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
