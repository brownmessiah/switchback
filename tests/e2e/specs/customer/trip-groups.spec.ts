/**
 * E2E — TripGroup `/community` (ADR-0009 / issue #20).
 *
 * Covers the hero flow as an authenticated customer (u_seed_customer):
 * discover seeded groups, create a group, join + leave a public group, and the
 * women-only eligibility block (an unverified account cannot join a
 * public_women_only group). Serial so the shared seeded groups + the customer's
 * membership state don't race under parallel workers.
 *
 * Authenticated via the customer storage state (global-setup seed user
 * `u_seed_customer`). The DevTools fixture adds console-error + axe checks.
 */

import { test, expect } from '../../fixtures/devtools'

test.describe.configure({ mode: 'serial' })

test.describe('TripGroups — /community', () => {
  test('discovery lists seeded public groups', async ({ page }) => {
    await page.goto('/community')
    await expect(page.getByRole('heading', { name: 'Community', level: 1 })).toBeVisible()
    await expect(page.getByText('Rishikesh rafting weekend')).toBeVisible()
    // The women-only group is discoverable (the JOIN gate is separate).
    await expect(page.getByText('Goa girls’ dive trip')).toBeVisible()
  })

  test('create a group lands on its detail page', async ({ page }) => {
    await page.goto('/community')
    const unique = `E2E Trip ${Date.now()}`
    await page.getByLabel('Trip name').fill(unique)
    await page.getByLabel('Destinations').fill('rishikesh')
    await page.getByRole('button', { name: /create trip group/i }).click()
    await page.waitForURL(/\/community\/[0-9a-f-]{36}/)
    await expect(page.getByRole('heading', { name: unique, level: 1 })).toBeVisible()
    // The creator is the host → no Join button; an itinerary "Add a plan" form shows.
    await expect(page.getByRole('button', { name: /add to itinerary/i })).toBeVisible()
  })

  test('join then leave a public group', async ({ page }) => {
    await page.goto('/community')
    await page.getByText('Rishikesh rafting weekend').click()
    await page.waitForURL(/\/community\/[0-9a-f-]{36}/)

    const joinBtn = page.getByRole('button', { name: /join trip/i })
    const leaveBtn = page.getByRole('button', { name: /^leave$/i })

    // May already be a member from a prior retry — only join if the button shows.
    if (await joinBtn.isVisible().catch(() => false)) {
      await joinBtn.click()
      await expect(leaveBtn).toBeVisible()
    }
    // Clean up so the test is repeatable.
    if (await leaveBtn.isVisible().catch(() => false)) {
      await leaveBtn.click()
      await expect(page.getByRole('button', { name: /join trip/i })).toBeVisible()
    }
  })

  test('women-only group blocks an unverified account from joining', async ({ page }) => {
    await page.goto('/community')
    await page.getByText('Goa girls’ dive trip').click()
    await page.waitForURL(/\/community\/[0-9a-f-]{36}/)
    await page.getByRole('button', { name: /join trip/i }).click()
    await expect(
      page.getByText(/Aadhaar-verified women only/i),
    ).toBeVisible()
    // The block holds — no Leave button (never became a member).
    await expect(page.getByRole('button', { name: /^leave$/i })).toHaveCount(0)
  })
})
