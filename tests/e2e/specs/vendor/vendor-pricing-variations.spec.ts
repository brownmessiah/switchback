/**
 * E2E — Pricing variations UI (issue #08).
 *
 * Covers the vendor authoring surface end-to-end:
 *   1. The Pricing section exposes a "Pricing variations" sub-section with an
 *      "Add variation" control + editable rows (name / price / active toggle).
 *   2. Creating a listing with an active variation PERSISTS the variation row
 *      (asserted against the DB).
 *   3. The KEY validation rule: clearing the base price AND having no active
 *      variation BLOCKS advancing past Pricing with a clear message.
 *
 * The customer PDP selector + listing-card "From ₹X" are unit-tested
 * (booking-rail-variations / experience-card); the wiring + i18n parity are
 * covered there. This spec focuses on the vendor form + persistence.
 *
 * Authenticated via the seeded business vendor storage state.
 */

import { test, expect } from '../../fixtures/devtools'
import {
  getExperienceByTitle,
  getPricingVariationsForExperience,
} from '../../helpers/db-assertions'

const SEED_BUSINESS_VENDOR_ID = 'u_seed_v_business'

test.describe('Pricing variations — vendor form', () => {
  test('add a variation on create → persists the variation row', async ({ page }) => {
    const title = `E2E Pricing Variation — Kayaking ${Date.now()}`

    await page.goto('/vendor/listings/new')
    await expect(page.locator('h1')).toContainText('Create listing')

    // ── Details ──────────────────────────────────────────────────────────
    await page.fill('#title', title)
    const activityTrigger = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: 'Select activity' })
    await activityTrigger.click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Kayaking' }).click()
    const regionTrigger = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: 'Select region' })
    await regionTrigger.click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Goa' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // ── Pricing — base price + ONE active variation ──────────────────────
    await expect(page.locator('#price12')).toBeVisible()
    await page.fill('#price12', '2500')

    // The Pricing variations sub-section + "Add variation" control are present.
    await expect(page.getByText('Pricing variations')).toBeVisible()
    await page.getByRole('button', { name: /add variation/i }).click()

    // The new variation row exposes name / price / active toggle.
    await expect(page.getByTestId('pricing-variation-row')).toBeVisible()
    await page.fill('#variation-name-0', 'Sunrise batch')
    await page.fill('#variation-price-0', '1800')
    // isActive defaults to checked.

    await page.getByRole('button', { name: 'Continue' }).click()

    // ── Policy → Itinerary → Review → submit ─────────────────────────────
    await page.getByRole('button', { name: 'Continue' }).click() // Policy → Itinerary
    await page.getByRole('button', { name: 'Continue' }).click() // Itinerary → Review
    const submit = page.locator('button[type="submit"]')
    await expect(submit).toBeVisible()
    await submit.click()

    await page.waitForURL(/\/vendor\/listings$/, { timeout: 15_000 })

    // ── DB: the variation persisted, scoped to the new experience ────────
    const created = await getExperienceByTitle(SEED_BUSINESS_VENDOR_ID, title)
    expect(created).not.toBeNull()
    const variations = await getPricingVariationsForExperience(created!.id)
    expect(variations).toHaveLength(1)
    expect(variations[0]!.name).toBe('Sunrise batch')
    expect(variations[0]!.pricePerPerson).toBe(1800)
    expect(variations[0]!.isActive).toBe(true)
  })

  test('blocks Pricing when there is no base price and no active variation', async ({
    page,
  }) => {
    await page.goto('/vendor/listings/new')
    await expect(page.locator('h1')).toContainText('Create listing')

    // Details
    await page.fill('#title', `E2E No-Price ${Date.now()}`)
    const activityTrigger = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: 'Select activity' })
    await activityTrigger.click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Kayaking' }).click()
    const regionTrigger = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: 'Select region' })
    await regionTrigger.click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Goa' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Pricing: leave the base price blank, add a variation but mark it INACTIVE.
    await expect(page.locator('#price12')).toBeVisible()
    await page.getByRole('button', { name: /add variation/i }).click()
    await page.fill('#variation-name-0', 'Inactive only')
    await page.fill('#variation-price-0', '1500')
    // Uncheck "Active" so the only variation is inactive → no usable price.
    await page.getByRole('checkbox', { name: /active/i }).uncheck()

    // Attempting to advance must be BLOCKED with the clear message.
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(
      page.getByText(/add a base price or at least one active pricing variation/i),
    ).toBeVisible()
  })
})
