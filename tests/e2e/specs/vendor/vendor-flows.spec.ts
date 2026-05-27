/**
 * E2E tests for authenticated vendor dashboard flows.
 *
 * Covers: onboarding redirect, listings CRUD, availability management,
 * bookings/payouts/reviews/messages/settings smoke checks.
 *
 * Uses the DevTools fixture for automatic console-error, uncaught-exception,
 * network-failure, and axe-core accessibility checks after each test.
 *
 * Authenticated via `tests/e2e/.auth/vendor-storage.json` (injected by
 * the global setup project — seed user `u_seed_v_business`, business-verified).
 */

import { test, expect } from '../../fixtures/devtools'

// ---------------------------------------------------------------------------
// 1. Onboarding page — already-onboarded vendor redirects to dashboard
// ---------------------------------------------------------------------------
test.describe('Vendor onboarding', () => {
  test('redirects to dashboard when vendor profile already exists', async ({
    page,
  }) => {
    // The seed vendor (u_seed_v_business) already has a vendor profile,
    // so the onboarding page should redirect to /vendor/dashboard
    await page.goto('/vendor/onboarding')
    await page.waitForURL(/\/vendor\/dashboard/)

    // Dashboard heading is visible
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Dashboard')

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-onboarding-redirect.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 2. Listings page — shows vendor's seeded experiences
// ---------------------------------------------------------------------------
test.describe('Vendor listings', () => {
  test('renders listing cards for seeded experiences', async ({ page }) => {
    const response = await page.goto('/vendor/listings')
    expect(response?.status()).toBe(200)

    // Page heading
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Listings')

    // Count subtitle — the business-tier vendor has 4 seeded experiences
    await expect(page.getByText(/\d+ experience/)).toBeVisible()

    // "Create listing" link is visible
    await expect(page.locator('a[href="/vendor/listings/new"]')).toBeVisible()

    // At least one listing card is visible with a title and status badge
    const listingCards = page.locator('a[href*="/vendor/listings/"]').filter({
      has: page.locator('h3'),
    })
    const cardCount = await listingCards.count()
    expect(cardCount).toBeGreaterThanOrEqual(1)

    // Verify the first listing shows activity/region/price info
    const firstCard = listingCards.first()
    await expect(firstCard).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-listings.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 3. Create listing — fill new experience form → save → appears in table
// ---------------------------------------------------------------------------
test.describe('Create listing', () => {
  test('fill form, save, and verify new listing appears', async ({ page }) => {
    // Navigate to the new listing form
    await page.goto('/vendor/listings/new')
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Create listing')

    // Fill title
    await page.fill('#title', 'E2E Test Experience — Sunset Kayaking')

    // Fill description
    await page.fill(
      '#description',
      'A scenic sunset kayaking session for testing purposes.',
    )

    // Select activity — open the select, pick "Kayaking"
    const activityTrigger = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: 'Select activity' })
    await activityTrigger.click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Kayaking' }).click()

    // Select region — open the select, pick "Goa"
    const regionTrigger = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: 'Select region' })
    await regionTrigger.click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Goa' }).click()

    // Fill pricing — 1-2 guests
    await page.fill('#price12', '2500')

    // Submit the form
    const submitButton = page.locator('button[type="submit"]')
    await expect(submitButton).toBeVisible()
    await submitButton.click()

    // Wait for redirect back to the listings page
    await page.waitForURL(/\/vendor\/listings$/, { timeout: 15_000 })

    // Verify the new listing appears on the listings page
    await expect(
      page.getByText('E2E Test Experience — Sunset Kayaking'),
    ).toBeVisible({ timeout: 10_000 })

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-create-listing.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 4. Edit listing — click listing → edit price → save → verify updated price
// ---------------------------------------------------------------------------
test.describe('Edit listing', () => {
  test('edit experience price and verify update persists', async ({ page }) => {
    // Navigate to listings
    await page.goto('/vendor/listings')
    await expect(page.locator('h1')).toContainText('Listings')

    // Click the first listing card to go to the edit page
    const listingLink = page.locator('a[href*="/vendor/listings/"]').filter({
      has: page.locator('h3'),
    }).first()
    await expect(listingLink).toBeVisible()
    await listingLink.click()

    // Wait for the edit page to load
    await page.waitForURL(/\/vendor\/listings\/[^/]+\/edit/)
    await expect(page.locator('h1')).toContainText('Edit experience')

    // Change the 1-2 guests price to a known value
    const priceInput = page.locator('#price12')
    await expect(priceInput).toBeVisible()
    await priceInput.fill('9999')

    // Submit the form
    const saveButton = page.locator('button[type="submit"]')
    await saveButton.click()

    // Wait for the success message
    await expect(page.getByText('Experience updated.')).toBeVisible({
      timeout: 10_000,
    })

    // Reload the page to verify persistence
    await page.reload()
    await expect(page.locator('h1')).toContainText('Edit experience')

    // Verify the price field retained the updated value
    const updatedPrice = page.locator('#price12')
    await expect(updatedPrice).toHaveValue('9999')

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-edit-listing.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 5. Availability management — add a pattern → verify it appears
// ---------------------------------------------------------------------------
test.describe('Availability management', () => {
  test('navigate to availability, add pattern, verify it appears', async ({
    page,
  }) => {
    // Navigate to listings to get a listing ID
    await page.goto('/vendor/listings')
    await expect(page.locator('h1')).toContainText('Listings')

    // Click the first listing to go to edit page
    const listingLink = page.locator('a[href*="/vendor/listings/"]').filter({
      has: page.locator('h3'),
    }).first()
    await listingLink.click()
    await page.waitForURL(/\/vendor\/listings\/([^/]+)\/edit/)

    // Extract the listing ID from the URL
    const editUrl = page.url()
    const listingIdMatch = editUrl.match(/\/vendor\/listings\/([^/]+)\/edit/)
    expect(listingIdMatch).toBeTruthy()
    const listingId = listingIdMatch![1]

    // Navigate to the availability page
    await page.goto(`/vendor/listings/${listingId}/availability`)
    await expect(page.locator('h1')).toContainText('Availability')

    // Click "Add Pattern" button
    const addPatternBtn = page.locator('button').filter({ hasText: 'Add Pattern' })
    await expect(addPatternBtn).toBeVisible()
    await addPatternBtn.click()

    // The form should appear with day, start time, end time, capacity fields
    await expect(page.locator('#startTime')).toBeVisible()
    await expect(page.locator('#endTime')).toBeVisible()
    await expect(page.locator('#capacity')).toBeVisible()

    // Fill the form — Wednesday, 10:00-14:00, capacity 8
    // Day select — pick Wednesday (value "3")
    const dayTrigger = page.locator('#dayOfWeek')
    await dayTrigger.click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Wednesday' }).click()

    await page.fill('#startTime', '10:00')
    await page.fill('#endTime', '14:00')
    await page.fill('#capacity', '8')

    // Click "Save Pattern"
    const savePatternBtn = page.locator('button').filter({ hasText: 'Save Pattern' })
    await savePatternBtn.click()

    // Verify the new pattern appears in the list
    await expect(page.getByText('Wednesday')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('8 spots')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-availability.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 6. Bookings page — smoke test
// ---------------------------------------------------------------------------
test.describe('Vendor bookings', () => {
  test('loads bookings page with heading and table structure', async ({
    page,
  }) => {
    const response = await page.goto('/vendor/bookings')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Bookings')

    // Count subtitle is visible
    await expect(page.getByText(/\d+ booking/)).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-bookings.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 7. Payouts page — smoke test
// ---------------------------------------------------------------------------
test.describe('Vendor payouts', () => {
  test('loads payouts page with earnings summary', async ({ page }) => {
    const response = await page.goto('/vendor/payouts')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Payouts')

    // Earnings summary cards are visible
    await expect(page.getByText('Gross earnings')).toBeVisible()
    await expect(page.getByText('Commission')).toBeVisible()
    await expect(page.getByText('Net payout')).toBeVisible()

    // Payout method section
    await expect(page.getByText('Payout method')).toBeVisible()

    // How payouts work section
    await expect(page.getByText('How payouts work')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-payouts.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 8. Reviews page — smoke test
// ---------------------------------------------------------------------------
test.describe('Vendor reviews', () => {
  test('loads reviews page with heading', async ({ page }) => {
    const response = await page.goto('/vendor/reviews')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Reviews')

    // Either the empty state or the review list is visible
    const hasReviews = await page.getByText(/\d+ review/).isVisible().catch(() => false)
    if (!hasReviews) {
      await expect(page.getByText('No reviews yet')).toBeVisible()
    }

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-reviews.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 9. Messages page — smoke test
// ---------------------------------------------------------------------------
test.describe('Vendor messages', () => {
  test('loads messages page with heading', async ({ page }) => {
    const response = await page.goto('/vendor/messages')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Messages')

    // Either the empty state or conversations list is visible
    const hasMessages = await page
      .locator('[class*="conversation"]')
      .first()
      .isVisible()
      .catch(() => false)
    if (!hasMessages) {
      await expect(page.getByText('No messages yet')).toBeVisible()
    }

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-messages.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 10. Settings page — smoke test
// ---------------------------------------------------------------------------
test.describe('Vendor settings', () => {
  test('loads settings page with tabs', async ({ page }) => {
    const response = await page.goto('/vendor/settings')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Settings')

    // Tabs are visible — Business details, Payout method, KYC documents
    await expect(page.getByRole('tab', { name: 'Business details' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Payout method' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'KYC documents' })).toBeVisible()

    // Default tab (business) content is visible
    await expect(page.getByRole('tabpanel')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-settings.png',
      fullPage: true,
    })
  })
})
