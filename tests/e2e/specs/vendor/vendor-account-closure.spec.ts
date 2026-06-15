/**
 * E2E for the vendor account-closure Danger Zone (issue 06).
 *
 * Authenticated via `tests/e2e/.auth/vendor-storage.json` (seed user
 * `u_seed_v_business`, business-verified). That seed Vendor has Bookings, so it
 * exercises the BLOCKED path: the Danger Zone shows the resolve-first checklist
 * and a disabled trigger.
 *
 * The HAPPY path needs a clean-eligibility Vendor fixture (no in-flight
 * Bookings, no unsettled Payout dues). No such auth fixture exists, so that
 * test is skipped — the transactional close is covered exhaustively by the
 * executeCloseVendorAccount unit/integration tests
 * (app/vendor/(dashboard)/settings/close-account-actions.test.ts).
 *
 * The DevTools fixture runs a console-error / uncaught-exception / network-failure
 * check AND an axe-core accessibility scan after each test (axe clean on the
 * Settings Danger Zone).
 */

import { test, expect } from '../../fixtures/devtools'

test.describe('Vendor account closure — Danger Zone', () => {
  test('renders the Danger Zone section at the foot of the Settings page', async ({ page }) => {
    const response = await page.goto('/vendor/settings')
    expect(response?.status()).toBe(200)

    // The Danger Zone is its own section anchored by id; the destructive trigger
    // carries the "Close Vendor account" accessible name.
    const section = page.locator('#danger-zone')
    await expect(section).toBeVisible()
    await expect(
      section.getByRole('button', { name: /Close Vendor account/i }),
    ).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-account-closure-danger-zone.png',
      fullPage: true,
    })
  })

  test('BLOCKED path: seed vendor with Bookings sees a disabled trigger + resolve-first checklist', async ({
    page,
  }) => {
    await page.goto('/vendor/settings')

    const section = page.locator('#danger-zone')
    const trigger = section.getByRole('button', { name: /Close Vendor account/i })

    // The seed business vendor has in-flight Bookings / unsettled dues → blocked.
    await expect(trigger).toBeDisabled()

    // A resolve-first checklist with at least one fix-link is shown.
    await expect(section.getByText(/can't close your Vendor account yet/i)).toBeVisible()
    const fixLinks = section.locator('a[href="/vendor/bookings"], a[href="/vendor/payouts"]')
    expect(await fixLinks.count()).toBeGreaterThanOrEqual(1)
  })

  // Happy path requires a clean-eligibility Vendor fixture (no in-flight
  // Bookings, no unsettled Payout dues). No such auth fixture exists; the
  // transactional close + redirect is covered by the executeCloseVendorAccount
  // unit/integration tests. Enable once a clean-vendor session is seeded.
  test.skip('HAPPY path: typed CLOSE enables submit → closure → redirected out', async ({
    page,
  }) => {
    await page.goto('/vendor/settings')

    const section = page.locator('#danger-zone')
    await section.getByRole('button', { name: /Close Vendor account/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const submit = dialog.getByRole('button', { name: /Close Vendor account/i })
    await expect(submit).toBeDisabled()

    await dialog.getByLabel(/type CLOSE/i).fill('CLOSE')
    await expect(submit).toBeEnabled()

    await submit.click()
    await page.waitForURL(/\/vendor\/onboarding/)
  })
})
