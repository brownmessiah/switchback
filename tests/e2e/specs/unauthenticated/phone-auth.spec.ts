/**
 * E2E: phone/OTP sign-in and sign-up (launch-readiness 03).
 *
 * Exercises the `000000` dev bypass — live in this environment because
 * NODE_ENV is 'development' (see lib/auth/otp-availability.ts /
 * lib/auth/msg91-provider.ts). No seeded User has a phone_number
 * (db/seed.ts is out of scope for this slice), so every case here signs
 * up first, then signs back in with the same number.
 *
 * Uses the DevTools fixture: any 4xx/5xx response, console error, or axe
 * violation fails the test — so this file intentionally never drives an
 * INVALID OTP through the UI (that path is covered by
 * app/[locale]/(marketing)/sign-in/use-phone-auth.test.ts instead, where a
 * 400 response is the point of the assertion, not a fixture violation).
 */

import { test, expect } from '../../fixtures/devtools'

const SIGN_UP_NUMBER = '9812300001'
const SIGN_IN_NUMBER = '9812300002'
const DEV_BYPASS_OTP = '000000'

test.describe('Phone sign-in / sign-up', () => {
  test('signs up an unknown number, allows editing the number mid-flow, and lands on the customer dashboard', async ({
    page,
  }) => {
    const response = await page.goto('/sign-in')
    expect(response?.status()).toBe(200)

    await page.getByRole('tab', { name: 'Phone' }).click()

    const numberInput = page.locator('#phone-number')
    await expect(numberInput).toBeVisible()
    await numberInput.fill(SIGN_UP_NUMBER)
    await page.getByRole('button', { name: 'Send code' }).click()

    // Code step reached — shows which number the code went to.
    const otpInput = page.locator('#phone-otp')
    await expect(otpInput).toBeVisible()
    await expect(page.getByText(`+91 98123 00001`, { exact: false })).toBeVisible()

    // Editable without restarting the flow: back to the number step, the
    // previously typed number is preserved, not cleared.
    await page.getByRole('button', { name: 'Use a different number' }).click()
    await expect(numberInput).toBeVisible()
    await expect(numberInput).toHaveValue(SIGN_UP_NUMBER)

    // Re-send and complete verification with the dev bypass code.
    await page.getByRole('button', { name: 'Send code' }).click()
    await expect(otpInput).toBeVisible()
    await otpInput.fill(DEV_BYPASS_OTP)
    await page.getByRole('button', { name: 'Verify and continue' }).click()

    // Unknown number → new account created and signed in. No admin/vendor
    // profile exists for a brand-new phone signup, so role-based routing
    // (identical to the email flow, launch-readiness 02) lands on the
    // Customer dashboard.
    await page.waitForURL('**/dashboard')
    expect(page.url()).not.toContain('/sign-in')
  })

  test('signs in an existing phone number and lands on the customer dashboard', async ({
    page,
    request,
  }) => {
    // Provision the User out-of-band via the same API surface the UI calls,
    // so this test's OWN assertions are about the SIGN-IN path (known
    // number), not sign-up — independent of test execution order.
    const sendSetup = await request.post('/api/auth/phone-number/send-otp', {
      data: { phoneNumber: `+91${SIGN_IN_NUMBER}` },
    })
    expect(sendSetup.ok()).toBe(true)
    const verifySetup = await request.post('/api/auth/phone-number/verify', {
      data: { phoneNumber: `+91${SIGN_IN_NUMBER}`, code: DEV_BYPASS_OTP },
    })
    expect(verifySetup.ok()).toBe(true)

    // Fresh, unauthenticated browser context (the `request` fixture's
    // cookies are not shared with `page`) — the UI flow below is a genuine
    // sign-IN for a number that already has a User.
    const response = await page.goto('/sign-in')
    expect(response?.status()).toBe(200)

    await page.getByRole('tab', { name: 'Phone' }).click()
    await page.locator('#phone-number').fill(SIGN_IN_NUMBER)
    await page.getByRole('button', { name: 'Send code' }).click()

    const otpInput = page.locator('#phone-otp')
    await expect(otpInput).toBeVisible()
    await otpInput.fill(DEV_BYPASS_OTP)
    await page.getByRole('button', { name: 'Verify and continue' }).click()

    await page.waitForURL('**/dashboard')
    expect(page.url()).not.toContain('/sign-in')
  })

  test('switching to the phone tab preserves a partially typed email, and back again preserves the phone number', async ({
    page,
  }) => {
    const response = await page.goto('/sign-in')
    expect(response?.status()).toBe(200)

    await page.locator('input#email').fill('traveller@example.com')
    await page.getByRole('tab', { name: 'Phone' }).click()
    await page.locator('#phone-number').fill('9876500000')

    await page.getByRole('tab', { name: 'Email' }).click()
    await expect(page.locator('input#email')).toHaveValue('traveller@example.com')

    await page.getByRole('tab', { name: 'Phone' }).click()
    await expect(page.locator('#phone-number')).toHaveValue('9876500000')
  })
})
