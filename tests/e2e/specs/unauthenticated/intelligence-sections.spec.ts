import { test, expect } from '../../fixtures/devtools'

import { FIXTURE_EXPERIENCE_SLUGS } from '@/lib/experiences/fixture-slugs'

/**
 * Data-derived intelligence sections (issue 22, DATA half only).
 *
 * Relies on the global-setup seed:
 *   - `bir-billing` (Himachal Pradesh) has published Experiences, AND `manali`
 *     (also Himachal Pradesh) has published Experiences → bir-billing's
 *     "Nearby destinations" surfaces manali (nearby = same-state, no distance).
 *   - `leh-ladakh` is a registered region with NO published inventory → its
 *     derived sections must be HIDDEN (empty-safe).
 *
 * The prose half (best-time, weather, FAQ generation) is issue #23 and is NOT
 * asserted here.
 */

test.describe('Destination intelligence sections', () => {
  test('a destination WITH inventory shows price range + top activities + nearby', async ({
    page,
  }) => {
    const response = await page.goto('/destinations/bir-billing')
    expect(response?.status()).toBe(200)

    // Price range (derived from published price brackets) — "From ₹X to ₹Y".
    const priceRange = page.locator('[data-testid="intelligence-price-range"]')
    await expect(priceRange).toBeVisible()
    await expect(priceRange).toContainText(/From ₹[\d,]+ to ₹[\d,]+/)

    // Top activities — links into /activities/{slug}, at least one.
    const topActivities = page.locator('[data-testid="intelligence-top-activities"]')
    await expect(topActivities).toBeVisible()
    expect(await topActivities.locator('a[href^="/activities/"]').count()).toBeGreaterThanOrEqual(1)

    // Nearby destinations — same-state region (manali) with inventory, linked
    // to /destinations/manali. No fabricated distance text.
    const nearby = page.locator('[data-testid="intelligence-nearby"]')
    await expect(nearby).toBeVisible()
    await expect(nearby.locator('a[href="/destinations/manali"]')).toBeVisible()

    // No fixture Experience leaks into the featured section.
    for (const slug of FIXTURE_EXPERIENCE_SLUGS) {
      await expect(page.locator(`a[href*="/experience/${slug}"]`)).toHaveCount(0)
    }
  })

  test('a destination WITHOUT inventory hides the empty derived sections', async ({
    page,
  }) => {
    const response = await page.goto('/destinations/leh-ladakh')
    expect(response?.status()).toBe(200)

    // The page itself renders (registry region), but every derived section
    // is hidden because there is no published inventory.
    await expect(page.locator('[data-testid="intelligence-price-range"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="intelligence-top-activities"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="intelligence-nearby"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="intelligence-difficulty"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="intelligence-featured"]')).toHaveCount(0)
  })
})

test.describe('Activity intelligence sections', () => {
  test('an activity WITH inventory shows price range + top destinations', async ({
    page,
  }) => {
    // `paragliding` is published in bir-billing (and elsewhere) in the seed.
    const response = await page.goto('/activities/paragliding')
    expect(response?.status()).toBe(200)

    const priceRange = page.locator('[data-testid="intelligence-price-range"]')
    await expect(priceRange).toBeVisible()
    await expect(priceRange).toContainText(/From ₹[\d,]+ to ₹[\d,]+/)

    const topDest = page.locator('[data-testid="intelligence-top-destinations"]')
    await expect(topDest).toBeVisible()
    expect(await topDest.locator('a[href^="/destinations/"]').count()).toBeGreaterThanOrEqual(1)

    // No fixture leak in the activity's featured section either.
    for (const slug of FIXTURE_EXPERIENCE_SLUGS) {
      await expect(page.locator(`a[href*="/experience/${slug}"]`)).toHaveCount(0)
    }
  })
})
