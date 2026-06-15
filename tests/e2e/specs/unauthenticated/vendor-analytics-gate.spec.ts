/**
 * E2E smoke for the Vendor Analytics auth gate (issue 01 — tracer bullet).
 *
 * Unauthenticated: hitting /vendor/analytics must redirect to /sign-in, exactly
 * like every other route under the `/vendor` shell (ADR-0006 — the gate is
 * inherited from `app/vendor/layout.tsx`, not re-implemented per route).
 *
 * Runs in the `unauthenticated` project (no storage state).
 */

import { test, expect } from '../../fixtures/devtools'

test.describe('/vendor/analytics — auth gate (unauthenticated)', () => {
  test('redirects an unauthenticated visitor to /sign-in', async ({ page }) => {
    await page.goto('/vendor/analytics')

    // The /vendor shell redirects a session-less visitor to /sign-in.
    await page.waitForURL(/\/sign-in/)
    await expect(page).toHaveURL(/\/sign-in/)
  })
})
