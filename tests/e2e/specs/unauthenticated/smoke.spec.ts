/**
 * Minimal smoke test for the `unauthenticated` project.
 * Uses the DevTools fixture to verify console error detection and
 * accessibility checks are wired correctly.
 */

import { test, expect } from '../../fixtures/devtools'

test('home page loads without console errors or a11y violations', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)
  await expect(page).toHaveTitle(/Outvers/)
})
