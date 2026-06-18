/**
 * E2E — eager Razorpay X Contact + Fund Account provisioning from the vendor
 * settings UI (slice 03, ADR-0016 2026-06-18 amendment).
 *
 * Drives the REAL settings page → payout-method form → `updatePayoutMethodAction`
 * Server Action → `executeUpdatePayoutMethod` core → the deterministic Razorpay X
 * demo stub (RAZORPAY_TEST_MODE=true), then asserts the persisted side-effects in
 * outvers_e2e:
 *   - vendor_profiles.razorpay_contact_id is cached (a `cont_demo_*` id), and
 *   - a vendor_fund_accounts row exists for `destinationFingerprint({ vpa })`
 *     with a coolingOffUntil ~7 days out.
 *
 * This proves the eager-provisioning path end-to-end through the browser, the
 * Server Action, and the stub — the upstream half of the send loop that
 * payout-batch-loop.spec.ts exercises downstream.
 *
 * Authenticated via `tests/e2e/.auth/vendor-storage.json` (seed user
 * `u_seed_v_business` — business-verified, Owner, so it holds `bank:manage`).
 */

import { destinationFingerprint } from '@/lib/payments/payout-destination'

import { test, expect } from '../../fixtures/devtools'
import {
  getVendorFundAccounts,
  getVendorRazorpayContactId,
} from '../../helpers/db-assertions'

const VENDOR = 'u_seed_v_business'
const COOLING_OFF_MS = 7 * 24 * 60 * 60 * 1000

test.describe('Vendor payout provisioning (slice 03)', () => {
  test('setting a UPI destination eagerly provisions a Contact + Fund Account', async ({
    page,
  }) => {
    // A NEW, unique VPA so the change is real and its fingerprint cannot collide
    // with any seeded / prior-run row.
    const vpa = `apex-provision-${Date.now()}@upi`
    const expectedFingerprint = destinationFingerprint({ vpa })

    const response = await page.goto('/vendor/settings')
    expect(response?.status()).toBe(200)

    // The payout section renders inline (single-scroll #56 B). Select UPI and
    // enter the VPA via robust label/role locators.
    const payoutSection = page.locator('#payout-method')
    await expect(payoutSection).toBeVisible()

    // The seed vendor defaults to bank_account → switch to UPI to reveal the VPA
    // field. The radio's accessible name is "UPI VPA".
    await page.getByRole('radio', { name: 'UPI VPA' }).check()

    // "UPI VPA" also labels the radio, so target the textbox specifically (the
    // <Label htmlFor="vpa"> input).
    const vpaInput = page.getByRole('textbox', { name: 'UPI VPA' })
    await expect(vpaInput).toBeVisible()
    await vpaInput.fill(vpa)

    const before = Date.now()
    await page.getByRole('button', { name: /update payout method/i }).click()

    // Wait for the success state — the form renders a success Alert on `ok`.
    await expect(
      page.getByText(/payout method updated/i),
    ).toBeVisible({ timeout: 15_000 })

    // ── DB side-effects (the proof slice-03 ran through the real path) ────────

    // Contact cached on the vendor profile (the stub returns a `cont_demo_*` id).
    const contactId = await getVendorRazorpayContactId(VENDOR)
    expect(contactId, 'a Razorpay X Contact must be provisioned + cached').toBeTruthy()
    expect(contactId).toMatch(/^cont_demo_/)

    // A Fund Account row keyed on the destination fingerprint, cooling off ~7d.
    const fundAccounts = await getVendorFundAccounts(VENDOR)
    const provisioned = fundAccounts.find(
      (fa) => fa.destinationFingerprint === expectedFingerprint,
    )
    expect(
      provisioned,
      'a vendor_fund_accounts row must exist for the entered VPA fingerprint',
    ).toBeTruthy()
    expect(provisioned!.razorpayFundAccountId).toMatch(/^fa_demo_/)

    // coolingOffUntil ≈ changeTime + 7 days (allow generous slack for the round
    // trip: it must be in the future and within ~7d ± a few minutes of `before`).
    const coolMs = provisioned!.coolingOffUntil.getTime()
    expect(coolMs).toBeGreaterThan(before + COOLING_OFF_MS - 5 * 60 * 1000)
    expect(coolMs).toBeLessThan(Date.now() + COOLING_OFF_MS + 5 * 60 * 1000)
  })
})
