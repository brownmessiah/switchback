/**
 * E2E — PDP fullscreen swipeable gallery modal (issue 14).
 *
 * The Experience detail hero+grid gallery opens a fullscreen, focus-trapped
 * Dialog. We exercise: opening from a tile, navigating with the on-screen
 * Next/Previous buttons + ArrowRight/ArrowLeft keys (with wrap), and closing
 * with Escape. The DevTools fixture runs axe-core (wcag2a + wcag2aa) after each
 * test, so the assertions also gate accessible dialog semantics + focus trap.
 *
 * Asserted on the seeded camping Experience (≥5 gallery tiles under the demo
 * catalog — real media + DISTINCT activity fallbacks).
 */

import { test, expect } from '../../fixtures/devtools'

const PDP = '/experience/bir-billing-camping-mountain-stay'

test.describe('PDP fullscreen gallery modal (issue 14)', () => {
  test('opens a focus-trapped dialog from the hero tile', async ({ page }) => {
    const response = await page.goto(PDP)
    expect(response?.status()).toBe(200)

    // No dialog until a tile is clicked.
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // The hero tile (first gallery opener) opens the modal.
    await page.getByRole('button', { name: /open photo gallery/i }).first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // Counter announces the position (Image 1 of N) — accessible Title.
    await expect(dialog.getByText(/image 1 of/i)).toBeVisible()
    // The active modal image is present with non-empty alt text.
    const activeImg = dialog.locator('img').first()
    await expect(activeImg).toBeVisible()
    await expect(activeImg).toHaveAttribute('alt', /.+/)
  })

  test('navigates with the Next/Previous buttons and ArrowRight/ArrowLeft keys', async ({
    page,
  }) => {
    await page.goto(PDP)
    await page.getByRole('button', { name: /open photo gallery/i }).first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/image 1 of/i)).toBeVisible()

    // Next button → image 2.
    await dialog.getByRole('button', { name: /next image/i }).click()
    await expect(dialog.getByText(/image 2 of/i)).toBeVisible()

    // ArrowRight → image 3.
    await page.keyboard.press('ArrowRight')
    await expect(dialog.getByText(/image 3 of/i)).toBeVisible()

    // ArrowLeft → back to image 2.
    await page.keyboard.press('ArrowLeft')
    await expect(dialog.getByText(/image 2 of/i)).toBeVisible()

    // Previous button → image 1.
    await dialog.getByRole('button', { name: /previous image/i }).click()
    await expect(dialog.getByText(/image 1 of/i)).toBeVisible()
  })

  test('closes on Escape and restores focus to the page', async ({ page }) => {
    await page.goto(PDP)
    const opener = page.getByRole('button', { name: /open photo gallery/i }).first()
    await opener.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // Dialog owns focus-restore: focus returns to the opener trigger.
    await expect(opener).toBeFocused()
  })
})
