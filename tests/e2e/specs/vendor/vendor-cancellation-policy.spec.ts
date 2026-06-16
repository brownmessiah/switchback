/**
 * E2E — Cancellation policy UI (issue #10).
 *
 * Vendor authoring surface + customer detail surface, spec-level:
 *   1. The Policy step exposes a "Cancellation policy" radio group with all FOUR
 *      named presets (Flexible / Moderate / Strict / Non-cancellable), the
 *      Non-cancellable helper text, and a "Reschedule allowed" toggle.
 *   2. Creating a listing as Non-cancellable with reschedule OFF persists both
 *      the preset and the reschedule snapshot (asserted against the DB).
 *   3. The customer Experience detail surfaces the cancellation policy — either
 *      the "Free cancellation up to Xh" line (windowed preset) or the
 *      "Non-cancellable" badge.
 *
 * Per-preset plain-language copy + the badge/line selection are unit-tested
 * (lib/payments/cancellation-copy, listing-cancellation-section, the i18n
 * parity suite). This spec focuses on the wiring + persistence.
 *
 * Authenticated via the seeded business vendor storage state.
 */

import { test, expect } from '../../fixtures/devtools'
import {
  getExperienceByTitle,
  getExperienceCancellationByTitle,
} from '../../helpers/db-assertions'

const SEED_BUSINESS_VENDOR_ID = 'u_seed_v_business'
const PUBLISHED_PDP = '/experience/bir-billing-camping-mountain-stay'

test.describe('Cancellation policy — vendor form', () => {
  test('Policy step shows the four preset radios + helper text + reschedule toggle', async ({
    page,
  }) => {
    await page.goto('/vendor/listings/new')
    await expect(page.locator('h1')).toContainText('Create listing')

    // Jump straight to the Policy step via the revisitable stepper (button "3").
    const nav = page.getByRole('navigation', { name: /listing builder progress/i })
    await nav.getByRole('button', { name: '3', exact: true }).click()

    const group = page.getByRole('radiogroup', { name: /cancellation policy/i })
    await expect(group).toBeVisible()

    // All four named presets are present as radios.
    for (const value of ['flexible', 'moderate', 'strict', 'non_cancellable']) {
      await expect(group.locator(`input[type="radio"][value="${value}"]`)).toHaveCount(1)
    }

    // The Moderate rule states 72h (the accurate figure), never "7 days".
    await expect(group).toContainText('72')
    await expect(group).not.toContainText('up to 7 days before the activity')

    // Non-cancellable helper text.
    await expect(
      page.getByText(/customers cannot cancel after payment/i),
    ).toBeVisible()
    await expect(page.getByText(/exceptional refunds/i)).toBeVisible()

    // Reschedule-allowed toggle, defaulting ON for a new Experience.
    const reschedule = page.getByRole('checkbox', { name: /reschedule allowed/i })
    await expect(reschedule).toBeChecked()
  })

  test('create as Non-cancellable with reschedule OFF persists both', async ({ page }) => {
    const title = `E2E Non-cancellable — Trek ${Date.now()}`

    await page.goto('/vendor/listings/new')
    await expect(page.locator('h1')).toContainText('Create listing')

    // Details — open the activity Select via its trigger, pick a real activity,
    // then the region Select. Each option is scoped to the OPEN listbox via a
    // hasText filter; a bare `.first()` is fragile because Radix keeps the
    // just-closed activity dropdown's items mounted during its exit animation,
    // so `.first()` can resolve to a hidden stale option and hang (mirrors the
    // canonical create-experience pattern in vendor-flows.spec.ts).
    await page.fill('#title', title)
    const activityTrigger = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: 'Select activity' })
    await activityTrigger.click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Trekking' }).click()
    const regionTrigger = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: 'Select region' })
    await regionTrigger.click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Manali' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Pricing — a base price so the listing is valid.
    await expect(page.locator('#price12')).toBeVisible()
    await page.fill('#price12', '5000')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Policy — pick Non-cancellable + turn reschedule OFF.
    const group = page.getByRole('radiogroup', { name: /cancellation policy/i })
    await group.locator('input[type="radio"][value="non_cancellable"]').check()
    await page.getByRole('checkbox', { name: /reschedule allowed/i }).uncheck()
    await page.getByRole('button', { name: 'Continue' }).click() // Policy → Itinerary
    await page.getByRole('button', { name: 'Continue' }).click() // Itinerary → Review

    const submit = page.locator('button[type="submit"]')
    await expect(submit).toBeVisible()
    await submit.click()
    await page.waitForURL(/\/vendor\/listings$/, { timeout: 15_000 })

    // DB: the preset + reschedule snapshot persisted.
    const created = await getExperienceByTitle(SEED_BUSINESS_VENDOR_ID, title)
    expect(created).not.toBeNull()
    const policy = await getExperienceCancellationByTitle(SEED_BUSINESS_VENDOR_ID, title)
    expect(policy).not.toBeNull()
    expect(policy!.cancellationPreset).toBe('non_cancellable')
    expect(policy!.rescheduleAllowed).toBe(false)
  })
})

test.describe('Cancellation policy — customer detail', () => {
  test('PDP surfaces the cancellation policy badge/line', async ({ page }) => {
    await page.goto(PUBLISHED_PDP)
    const section = page.locator('#cancellation')
    await expect(section).toBeVisible()

    // Either the "Free cancellation up to Xh" line (windowed preset) or the
    // Non-cancellable badge — both sourced from the single copy constant.
    const text = (await section.innerText()).toLowerCase()
    expect(/free cancellation up to \d+h|non-cancellable/.test(text)).toBe(true)
  })
})
