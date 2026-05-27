/**
 * Browser-side Razorpay checkout mock for E2E tests.
 *
 * Intercepts the Razorpay checkout.js script and replaces it with a
 * lightweight stub that immediately fires the `handler.success` callback
 * with deterministic test payment IDs.
 */

import type { Page } from '@playwright/test'

/**
 * Mock Razorpay constructor script injected into the browser.
 * When `Razorpay.open()` is called, it synchronously invokes the
 * `handler.success` callback with test payment details.
 */
const RAZORPAY_MOCK_SCRIPT = `
  window.Razorpay = function RazorpayMock(options) {
    this._options = options;
    this.open = function () {
      if (options.handler) {
        options.handler({
          razorpay_payment_id: 'pay_test_' + Date.now(),
          razorpay_order_id: options.order_id || 'order_test_' + Date.now(),
          razorpay_signature: 'sig_test_' + Date.now(),
        });
      }
    };
    this.close = function () {};
    this.on = function () { return this; };
  };
`

/**
 * Intercepts the Razorpay checkout.js load and replaces it with a mock
 * that fires `handler.success` when `open()` is called.
 *
 * Call this before navigating to any page that loads Razorpay checkout.
 *
 * @example
 * ```ts
 * import { mockRazorpayCheckout } from '../helpers/razorpay-mock'
 *
 * test('checkout flow', async ({ page }) => {
 *   await mockRazorpayCheckout(page)
 *   await page.goto('/checkout')
 *   // ... click pay button, Razorpay mock auto-fires success
 * })
 * ```
 */
export async function mockRazorpayCheckout(page: Page): Promise<void> {
  await page.route('**/checkout.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: RAZORPAY_MOCK_SCRIPT,
    })
  })
}
