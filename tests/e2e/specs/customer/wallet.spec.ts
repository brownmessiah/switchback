/**
 * E2E for the dedicated /wallet page (issue 09).
 *
 * The page promotes the dashboard wallet aside to a full route under
 * app/(app)/wallet — auth-gated, excluded from the i18n proxy. It surfaces
 * BOTH ADR-0004 buckets (switchback_credit + refund_balance), the paginated
 * wallet_transactions ledger, and the soonest credit-expiry chip.
 *
 * Seeded customer `u_seed_customer` (db/seed.ts) has wallet rows on the core
 * seed: refund_balance ₹500 + switchback_credit ₹200, plus a credit grant
 * ledger row carrying a deterministic +12-month expiry. Authenticated via the
 * customer storage state injected by the customer project.
 *
 * Serial: these read-only assertions share the seeded customer's wallet DB
 * state. The refund_balance can be CREDITED by parallel cancel specs (it only
 * grows), so balance assertions read live from the DB and use the same
 * monotonic invariant the dashboard spec uses rather than exact equality.
 */

import { test, expect } from '../../fixtures/devtools'
import { getWalletBalanceRupees, grantSwitchbackCredit } from '../../helpers/db-assertions'

const SEED_CUSTOMER = 'u_seed_customer'

test.describe.configure({ mode: 'serial' })

test.describe('Wallet page (/wallet)', () => {
  // Isolation: the customer E2E project shares ONE seeded customer, and the
  // revenue-spine checkout spec (customer-flows.spec.ts) legitimately debits
  // this customer's switchback_credit to ₹0 via applyWalletToCheckout
  // (app/(app)/checkout/actions.ts — a real ADR-0004 feature). That is correct
  // product behaviour, not a regression, but it leaves the shared seed customer
  // with no credit by the time this suite runs → no balance, no ledger grant,
  // no expiry chip. Restore a deterministic, non-zero, unexpired credit so
  // every wallet assertion runs against a known baseline regardless of what the
  // checkout spec did. A single beforeAll suffices (the suite is serial).
  test.beforeAll(async () => {
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // ~90 days out
    await grantSwitchbackCredit(SEED_CUSTOMER, 500, expiresAt)
  })

  test('renders both bucket balances with their ADR-0004 labels', async ({ page }) => {
    const response = await page.goto('/wallet')
    // The route must NOT 404 — it is excluded from the i18n proxy.
    expect(response?.status()).toBeLessThan(400)

    await expect(page.getByTestId('wallet-page')).toBeVisible()

    const creditCard = page.getByTestId('wallet-bucket-switchback_credit')
    const refundCard = page.getByTestId('wallet-bucket-refund_balance')
    await expect(creditCard).toBeVisible()
    await expect(refundCard).toBeVisible()
    await expect(creditCard).toContainText('Switchback credit')
    await expect(refundCard).toContainText('Refund balance')

    // The Switchback-credit card renders the live DB balance exactly. Note: the
    // balance is debitable — a completed checkout applies wallet credit via
    // applyWalletToCheckout (app/(app)/checkout/actions.ts), so the revenue-spine
    // checkout spec earlier in the customer run may have drawn it down to ₹0.
    // We therefore assert render==DB (the real contract) and a non-negative
    // balance; the seeded credit GRANT's existence is covered by the ledger test.
    const creditRupees = await getWalletBalanceRupees(SEED_CUSTOMER, 'switchback_credit')
    await expect(creditCard.getByTestId('wallet-amount-switchback_credit')).toHaveText(
      `₹${creditRupees.toLocaleString('en-IN')}`,
    )
    expect(creditRupees).toBeGreaterThanOrEqual(0)

    // Refund balance only grows (parallel cancels credit it) → monotonic.
    const refundText = await refundCard
      .getByTestId('wallet-amount-refund_balance')
      .innerText()
    const renderedRefund = Number(refundText.replace(/[₹,\s]/g, ''))
    const dbRefundNow = await getWalletBalanceRupees(SEED_CUSTOMER, 'refund_balance')
    expect(Number.isFinite(renderedRefund)).toBe(true)
    expect(renderedRefund).toBeGreaterThanOrEqual(0)
    expect(renderedRefund).toBeLessThanOrEqual(dbRefundNow)
  })

  test('renders the transactions ledger with at least the seeded credit grant', async ({
    page,
  }) => {
    await page.goto('/wallet')

    const ledger = page.getByTestId('wallet-ledger')
    await expect(ledger).toBeVisible()
    // The seed grants the Switchback credit via a ledger row → at least one row.
    const rows = page.getByTestId('wallet-ledger-row')
    expect(await rows.count()).toBeGreaterThanOrEqual(1)
    // A credit row renders its signed amount with a leading + (color + text,
    // never color alone).
    await expect(ledger).toContainText('+₹')
  })

  test('surfaces the soonest credit-expiry chip (ADR-0004 credit is time-bound)', async ({
    page,
  }) => {
    await page.goto('/wallet')

    const expiry = page.getByTestId('wallet-credit-expiry')
    await expect(expiry).toBeVisible()
    await expect(expiry).toContainText(/expires/i)
    // Deterministic +12-month seed expiry → a year component must render.
    await expect(expiry).toContainText(/\d{4}/)
  })

  test('refund balance shows an honest cash-out affordance, not on the credit card', async ({
    page,
  }) => {
    await page.goto('/wallet')

    const refundCard = page.getByTestId('wallet-bucket-refund_balance')
    const cashout = refundCard.getByTestId('wallet-cashout')
    await expect(cashout).toBeVisible()
    await expect(cashout).toContainText(/cash out/i)
    await expect(cashout).toContainText(/5[–-]7 working days/i)

    // The never-cashable Switchback credit card carries no cash-out affordance.
    await expect(
      page.getByTestId('wallet-bucket-switchback_credit').getByTestId('wallet-cashout'),
    ).toHaveCount(0)
  })
})
