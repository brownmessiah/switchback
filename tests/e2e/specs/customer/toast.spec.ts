/**
 * E2E — wishlist-add toast for a signed-in Customer (issue 24, DECISION D11).
 *
 * Acceptance: "wishlist add → toast". Authenticated as the seeded customer via
 * the customer project's storageState. Saving an Experience from the PDP fires
 * an accessible success toast (role=status, dismissible). Mutates shared DB
 * state, so it runs serially and leaves the wishlist clean (toggle-on then
 * toggle-off) to stay idempotent across reruns.
 */

import { test, expect } from '../../fixtures/devtools'

const RAFTING_SLUG = 'rishikesh-rafting-grade-iii'

test.describe('Wishlist add toast (customer)', () => {
  test.describe.configure({ mode: 'serial' })

  test('saving from the PDP fires an accessible success toast', async ({ page }) => {
    await page.goto(`/experience/${RAFTING_SLUG}`)
    await expect(page.locator('h1')).toBeVisible()

    const heart = page.getByTestId('wishlist-button').first()
    await expect(heart).toBeVisible()

    // Start from an un-saved state so the click is an ADD (fires toast.added).
    if ((await heart.getAttribute('data-saved')) === 'true') {
      await heart.click()
      await expect(heart).toHaveAttribute('data-saved', 'false')
      await expect(heart).toHaveAttribute('data-pending', 'false')
    }

    await heart.click()
    await expect(heart).toHaveAttribute('data-saved', 'true')

    // Accessible success toast (role=status) confirming the wishlist add.
    const toast = page.getByRole('status').filter({ hasText: /wishlist/i }).first()
    await expect(toast).toBeVisible()

    // Clean up — toggle back off so the spec is idempotent (also fires a toast).
    await expect(heart).toHaveAttribute('data-pending', 'false')
    await heart.click()
    await expect(heart).toHaveAttribute('data-saved', 'false')
    await expect(heart).toHaveAttribute('data-pending', 'false')
  })
})
