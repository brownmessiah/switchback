/**
 * E2E — customer account settings (/settings).
 *
 * Seeded customer (`u_seed_customer`, db/seed.ts) visits /settings, edits a
 * profile field + saves, then toggles a notification preference. Persistence
 * is asserted end-to-end via the rendered state: the page is a server
 * component that re-reads `users` / `customer_profiles` /
 * `notification_preferences` from the DB on every load, so a full page reload
 * showing the new value proves the write committed (no direct DB coupling
 * needed in the worker — see the issue note).
 *
 * Serial: the two tests mutate the same seeded customer's rows, so they must
 * not interleave under fullyParallel.
 */
import { test, expect } from '../../fixtures/devtools'

test.describe.configure({ mode: 'serial' })

test.describe('Customer settings — profile', () => {
  test('renders the settings page with the profile form + notification grid', async ({
    page,
  }) => {
    const response = await page.goto('/settings')
    expect(response?.status()).toBe(200)

    await expect(page.getByTestId('customer-settings')).toBeVisible()
    await expect(page.getByTestId('profile-form')).toBeVisible()
    // The previously-orphaned grid is now mounted + reachable.
    await expect(page.getByTestId('notification-preferences')).toBeVisible()
    await expect(page.getByRole('switch').first()).toBeVisible()
  })

  test('edits a profile field and persists it across a reload', async ({ page }) => {
    await page.goto('/settings')

    const cityInput = page.locator('#city')
    await expect(cityInput).toBeVisible()

    // Unique value so the assertion is robust against prior seed data.
    const newCity = `Pune-${Date.now()}`
    const line1 = page.locator('#line1')
    await line1.fill('42 Settings Test Rd')
    await cityInput.fill(newCity)
    await page.locator('#state').fill('MH')
    await page.locator('#pincode').fill('411001')

    await page.getByTestId('settings-save').click()

    // Success state confirms the Server Action returned ok.
    await expect(page.getByTestId('settings-saved')).toBeVisible()

    // Reload: the server component re-reads customer_profiles from the DB.
    // The persisted value re-hydrating the input proves the write committed.
    await page.reload()
    await expect(page.locator('#city')).toHaveValue(newCity)
    await expect(page.locator('#pincode')).toHaveValue('411001')
  })
})

test.describe('Customer settings — notification preferences', () => {
  test('toggles a notification preference and persists it across a reload', async ({
    page,
  }) => {
    await page.goto('/settings')

    // Target a deterministic toggle: payout_processed × sms (irrelevant to a
    // customer, safe to flip; defaults enabled under the opt-out model).
    const toggle = page.getByTestId('notif-toggle-payout_processed-sms')
    await expect(toggle).toBeVisible()

    const before = await toggle.getAttribute('aria-checked')
    await toggle.click()
    // Optimistic UI flips immediately; wait for the new state to settle.
    const expected = before === 'true' ? 'false' : 'true'
    await expect(toggle).toHaveAttribute('aria-checked', expected)

    // Reload: NotificationPreferences re-fetches via getNotificationPreferences,
    // so the flipped value re-rendering proves the upsert committed.
    await page.reload()
    const persisted = page.getByTestId('notif-toggle-payout_processed-sms')
    await expect(persisted).toHaveAttribute('aria-checked', expected)
  })
})
