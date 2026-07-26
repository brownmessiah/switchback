/**
 * E2E for the Vendor signup journey (launch-readiness 02).
 *
 * The one journey that adds supply to the marketplace: a logged-out
 * visitor's Vendor intent must survive authentication via `returnTo`.
 *
 *   - /vendor-partner CTA → /vendor/onboarding → (auth gate) →
 *     /sign-in?returnTo=%2Fvendor%2Fonboarding — intent recorded.
 *   - Signing UP from there lands on the onboarding wizard, not the
 *     Customer dashboard.
 *   - Signing IN with an existing profile-less account lands on the
 *     wizard too.
 *   - returnTo survives toggling sign-in ↔ sign-up modes.
 *   - A cross-origin returnTo is silently ignored (role routing wins) —
 *     the open-redirect guard.
 *
 * Fresh accounts are minted per run (unique emails); the harness
 * reseeds the database on every global-setup, so runs stay repeatable.
 *
 * All tests run through the DevTools fixture (axe wcag2a+wcag2aa +
 * console-error + 4xx/5xx gating).
 */

import { DEMO_PASSWORD } from '@/db/seed-demo-passwords'

import { test, expect } from '../../fixtures/devtools'

const PASSWORD = 'E2eVendor!2026'

function uniqueEmail(tag: string): string {
  return `e2e-rt-${tag}-${Date.now()}@e2e.outvers.test`
}

/** Fill the two-step email form in the requested mode and submit. */
async function completeEmailAuth(
  page: import('@playwright/test').Page,
  mode: 'signin' | 'signup',
  email: string,
): Promise<void> {
  const form = page
    .locator('form')
    .filter({ has: page.locator('input#email[type="email"]') })

  if (mode === 'signup') {
    await page.getByRole('button', { name: /create|sign up/i }).click()
  }

  await form.locator('input#email').fill(email)
  await form.getByRole('button', { name: /continue/i }).click()
  await form.locator('input#password').fill(PASSWORD)
  await form.locator('button[type="submit"]').click()
}

test.describe('Vendor signup journey — returnTo carries intent', () => {
  test('logged-out Vendor CTA records intent on the sign-in URL', async ({ page }) => {
    await page.goto('/vendor-partner')

    // The hero CTA still targets the wizard directly (its href is part
    // of the public contract); the /vendor auth gate translates it into
    // a sign-in redirect that carries returnTo.
    await page
      .getByRole('link', { name: /start vendor onboarding/i })
      .first()
      .click()

    await page.waitForURL(/\/sign-in\?returnTo=/)
    const url = new URL(page.url())
    expect(url.pathname).toBe('/sign-in')
    expect(url.searchParams.get('returnTo')).toBe('/vendor/onboarding')
  })

  test('signup with Vendor intent lands on the onboarding wizard and completes the funnel', async ({
    page,
  }) => {
    await page.goto('/sign-in?returnTo=%2Fvendor%2Fonboarding')

    await completeEmailAuth(page, 'signup', uniqueEmail('signup'))

    await page.waitForURL('**/vendor/onboarding')
    expect(new URL(page.url()).pathname).toBe('/vendor/onboarding')
    await expect(page.getByRole('heading', { name: /become a vendor/i })).toBeVisible()

    // Close the supply funnel: complete the wizard's required fields and
    // land on the Vendor dashboard — which only renders for a User with
    // a vendor_profiles row, proving the profile was created (the same
    // row /admin/vendors lists).
    const slug = `e2e-rt-vendor-${Date.now()}`
    // Step 1 — business identity.
    await page.locator('input#businessName').fill('E2E ReturnTo Adventures')
    await page.locator('input#slug').fill(slug)
    await page.getByRole('button', { name: /^continue$/i }).click()
    // Step 2 — optional KYC/PAN, nothing required.
    await page.getByRole('button', { name: /^continue$/i }).click()
    // Step 3 — commission disclosure, then create.
    await page.getByRole('button', { name: /create vendor profile/i }).click()

    await page.waitForURL('**/vendor/dashboard**')
    expect(new URL(page.url()).pathname).toContain('/vendor/dashboard')
  })

  test('a User who already has a Vendor profile is routed to the dashboard, not onboarding', async ({
    page,
  }) => {
    // The seeded Business-verified Vendor signs in through the real UI
    // with Vendor-onboarding intent; the wizard's own guard must bounce
    // an existing profile-holder to the dashboard.
    await page.goto('/sign-in?returnTo=%2Fvendor%2Fonboarding')
    const form = page
      .locator('form')
      .filter({ has: page.locator('input#email[type="email"]') })
    await form.locator('input#email').fill('business-tier@seed.outvers.dev')
    await form.getByRole('button', { name: /continue/i }).click()
    await form.locator('input#password').fill(DEMO_PASSWORD)
    await form.locator('button[type="submit"]').click()

    await page.waitForURL('**/vendor/dashboard**')
    expect(new URL(page.url()).pathname).toContain('/vendor/dashboard')
  })

  test('sign-in with an existing profile-less account honours returnTo, and returnTo survives mode toggling', async ({
    page,
  }) => {
    // First create the account (no vendor profile results from signup alone).
    const email = uniqueEmail('signin')
    await page.goto('/sign-in')
    await completeEmailAuth(page, 'signup', email)
    await page.waitForURL('**/dashboard')

    // Sign out by clearing cookies (the UI path is not under test here).
    await page.context().clearCookies()

    // Return with Vendor intent, toggle to sign-up and back to sign-in —
    // returnTo must survive the round trip (it lives outside form state).
    await page.goto('/sign-in?returnTo=%2Fvendor%2Fonboarding')
    await page.getByRole('button', { name: /create|sign up/i }).click()
    await page.getByRole('button', { name: /sign in/i }).first().click()
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/vendor/onboarding')

    await completeEmailAuth(page, 'signin', email)

    await page.waitForURL('**/vendor/onboarding')
    expect(new URL(page.url()).pathname).toBe('/vendor/onboarding')
  })

  test('cross-origin returnTo is ignored — signup lands on the Customer dashboard', async ({
    page,
  }) => {
    await page.goto('/sign-in?returnTo=https%3A%2F%2Fevil.example%2Fphish')

    await completeEmailAuth(page, 'signup', uniqueEmail('evil'))

    await page.waitForURL('**/dashboard')
    const url = new URL(page.url())
    expect(url.hostname).not.toContain('evil.example')
    expect(url.pathname).toBe('/dashboard')
  })

  test('protocol-relative returnTo is ignored too', async ({ page }) => {
    await page.goto('/sign-in?returnTo=%2F%2Fevil.example')

    await completeEmailAuth(page, 'signup', uniqueEmail('proto'))

    await page.waitForURL('**/dashboard')
    expect(new URL(page.url()).pathname).toBe('/dashboard')
  })
})
