/**
 * E2E for the customer wishlist (Issue #08).
 *
 * Flow: visit an Experience PDP → click the wishlist heart (saves) → visit
 * /wishlist → the Experience appears → toggle it off from the PDP → it is
 * gone from /wishlist.
 *
 * Authenticated as the seeded customer (u_seed_customer) via the customer
 * project's storageState. The test mutates the seed customer's wishlist
 * (shared DB state), so it runs serially and leaves the wishlist empty at
 * the end (toggle-on then toggle-off) to stay idempotent across reruns.
 *
 * Target: the seeded published flagship Experience rishikesh-rafting-grade-iii.
 */

import { test, expect } from '../../fixtures/devtools'

const RAFTING_SLUG = 'rishikesh-rafting-grade-iii'
const RAFTING_TITLE_RE = /rafting/i

test.describe('Customer wishlist', () => {
  // Serial: these steps share the seed customer's single wishlist array.
  test.describe.configure({ mode: 'serial' })

  test('save from PDP → appears on /wishlist → remove → gone', async ({
    page,
  }) => {
    // ── 1. Visit the PDP. The wishlist heart renders for the logged-in
    //    customer. Ensure we start from a clean (un-saved) state — if a prior
    //    run left it saved, toggle it off first.
    await page.goto(`/experience/${RAFTING_SLUG}`)
    await expect(page.locator('h1')).toBeVisible()

    const pdpHeart = page.getByTestId('wishlist-button').first()
    await expect(pdpHeart).toBeVisible()

    if ((await pdpHeart.getAttribute('data-saved')) === 'true') {
      await pdpHeart.click()
      await expect(pdpHeart).toHaveAttribute('data-saved', 'false')
      // Wait for the server action to settle before continuing.
      await expect(pdpHeart).toHaveAttribute('data-pending', 'false')
    }

    // ── 2. Save it. The button flips to the saved state, and we wait for the
    //    server action to COMMIT (data-pending=false) before navigating so the
    //    /wishlist render sees the persisted row (not just the optimistic flip).
    await pdpHeart.click()
    await expect(pdpHeart).toHaveAttribute('data-saved', 'true')
    await expect(pdpHeart).toHaveAttribute('data-pending', 'false')

    // ── 3. /wishlist now lists the saved Experience.
    await page.goto('/wishlist')
    await expect(page.locator('h1')).toContainText(/wishlist/i)
    const grid = page.getByTestId('wishlist-grid')
    await expect(grid).toBeVisible()
    await expect(
      grid.locator(`a[href*="/experience/${RAFTING_SLUG}"]`),
    ).toBeVisible()
    await expect(grid.getByText(RAFTING_TITLE_RE).first()).toBeVisible()

    // ── 4. Toggle it OFF (from the PDP) and confirm it disappears.
    await page.goto(`/experience/${RAFTING_SLUG}`)
    const heartAgain = page.getByTestId('wishlist-button').first()
    await expect(heartAgain).toHaveAttribute('data-saved', 'true')
    await heartAgain.click()
    await expect(heartAgain).toHaveAttribute('data-saved', 'false')
    await expect(heartAgain).toHaveAttribute('data-pending', 'false')

    // ── 5. /wishlist no longer lists it → empty state surfaces.
    await page.goto('/wishlist')
    await expect(page.locator('h1')).toContainText(/wishlist/i)
    await expect(
      page.locator(`a[href*="/experience/${RAFTING_SLUG}"]`),
    ).toHaveCount(0)
    await expect(page.getByText(/no saved experiences yet/i)).toBeVisible()
  })
})
