import { test, expect } from '../../fixtures/devtools'

import { FIXTURE_EXPERIENCE_SLUGS } from '@/lib/experiences/fixture-slugs'

/**
 * Data-derived intelligence sections (issue 22, DATA half only).
 *
 * Relies on the global-setup seed (`db/seed.ts` → `seedCatalog`):
 *   - `bir-billing` (Himachal Pradesh) has 3 published catalog Experiences
 *     (db/seed-extras.ts:205-207), AND `manali` (also Himachal Pradesh) has 3
 *     published catalog Experiences (db/seed-extras.ts:198-200) → bir-billing's
 *     "Nearby destinations" surfaces manali (nearby = same-state, no distance —
 *     lib/content/intelligence.ts:280-314).
 *   - `leh-ladakh` is the SOLE registered region in the state "Ladakh"
 *     (lib/regions/registry.ts:51-55 — no other region has state 'Ladakh'). It
 *     DOES carry published inventory (4 catalog Experiences,
 *     db/seed-extras.ts:218-221, status 'published' at :728), so its price-range
 *     and top-activities sections DO render — but its "Nearby destinations"
 *     section is genuinely EMPTY, because `deriveNearbyRegions` filters to OTHER
 *     same-state regions and Ladakh has none (intelligence.ts:289-292). That is
 *     the real, seed-accurate "empty section is hidden" assertion.
 *
 * The fully-empty empty-safe path (a region with NO inventory at all hides
 * EVERY section) is the binding proof at the unit/component level — see
 * tests/unit/components/intelligence-sections.test.tsx ("renders NOTHING when
 * the region has no derived data" and "hides only the empty sections, keeping
 * the populated ones"). All 10 registered regions are seeded with published
 * inventory, so there is no genuinely-empty registered region to exercise that
 * path end-to-end without perturbing the registry (which feeds sitemap /
 * region-count tests).
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

  test('a destination hides a derived section that has no data (empty nearby)', async ({
    page,
  }) => {
    // `leh-ladakh` is the SOLE registered region in state "Ladakh", so its
    // "Nearby destinations" (same-state) section is genuinely empty and must be
    // hidden — even though the region itself carries published inventory.
    const response = await page.goto('/destinations/leh-ladakh')
    expect(response?.status()).toBe(200)

    // The inventory-backed sections DO render (4 published catalog Experiences).
    const priceRange = page.locator('[data-testid="intelligence-price-range"]')
    await expect(priceRange).toBeVisible()
    await expect(priceRange).toContainText(/From ₹[\d,]+ to ₹[\d,]+/)

    const topActivities = page.locator('[data-testid="intelligence-top-activities"]')
    await expect(topActivities).toBeVisible()
    expect(await topActivities.locator('a[href^="/activities/"]').count()).toBeGreaterThanOrEqual(1)

    // The "Nearby destinations" section is HIDDEN because Ladakh has no other
    // inventory-bearing region — the empty-safe, seed-accurate assertion.
    await expect(page.locator('[data-testid="intelligence-nearby"]')).toHaveCount(0)
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
