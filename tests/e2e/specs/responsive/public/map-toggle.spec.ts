/**
 * Responsive verification — list/map toggle defaults to LIST on mobile
 * (issue 11, ADR-0018). Runs under responsive-phone-public (375) +
 * responsive-tablet-public (768), both coarse-pointer so the §8.2 44px touch
 * floor is live for the toggle controls.
 *
 * The map is OPT-IN on phone: the list renders first (the map does not block the
 * core browse flow), and the toggle controls meet the touch-target floor.
 *
 * DevTools fixture → axe (wcag2a+wcag2aa) gating per test.
 */

import { test, expect } from '../../../fixtures/devtools'

test.describe('mobile list/map toggle · list-default (issue 11)', () => {
  test('defaults to the list (map is opt-in) and the toggle is reachable', async ({
    page,
  }) => {
    await page.goto('/search')

    // List is the default view — the map container is NOT mounted on load, so
    // the core browse flow is never blocked by the map on a phone.
    await expect(page.getByTestId('experience-map')).toHaveCount(0)

    const toggle = page.getByTestId('results-view-toggle')
    await expect(toggle).toBeVisible()

    // Toggle controls meet the coarse-pointer 44px touch floor (.min-tap).
    const mapButton = toggle.getByRole('button', { name: 'Map' })
    const box = await mapButton.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })

  test('opting into the map mounts it without losing the active filter', async ({
    page,
  }) => {
    await page.goto('/search?region=rishikesh')

    const toggle = page.getByTestId('results-view-toggle')
    await Promise.all([
      page.waitForURL(/map=1/),
      toggle.getByRole('button', { name: 'Map' }).click(),
    ])

    // The map mounts and the region filter survives (same filtered set).
    await expect(page.getByTestId('experience-map')).toBeVisible()
    expect(new URL(page.url()).searchParams.get('region')).toBe('rishikesh')
  })
})
