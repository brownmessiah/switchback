/**
 * E2E smoke for the Vendor Team & Roles surface (issue #05).
 *
 * Authenticated via `tests/e2e/.auth/vendor-storage.json` (seed user
 * `u_seed_v_business`) — the Owner of their account, who holds `team:manage`
 * via the Owner wildcard and therefore reaches `/vendor/team`.
 *
 * Covers:
 *   - The Owner reaches /vendor/team and sees the title + subtitle, the
 *     "+ Add User" button, the protected Owner row, and the member list.
 *   - The Add-User modal opens and collects full name / email / phone / role /
 *     status (the role dropdown offers the four ASSIGNABLE roles only).
 *   - The "Team & Roles" sidebar item navigates to the route (nav wiring +
 *     EXCLUDED_PREFIXES — a missing prefix would 404 via the public storefront).
 *   - A non-team user (a Customer with no Vendor role) is DENIED the surface.
 *
 * The interactive write paths (invite/edit/remove) are exhaustively unit-tested
 * in team-core.test.ts; here we assert the DOM contract + gating. Uses the
 * DevTools fixture (console-error / uncaught-exception / network-failure +
 * axe-core a11y scan after each test).
 */

import path from 'node:path'

import { test, expect } from '../../fixtures/devtools'

test.describe('Vendor Team & Roles', () => {
  test('renders the title, subtitle, Add User button, Owner row, and member list', async ({
    page,
  }) => {
    const response = await page.goto('/vendor/team')
    expect(response?.status()).toBe(200)

    // Page heading + subtitle (en canonical copy).
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Team & Roles')
    await expect(
      page.getByText('Manage users who can access your vendor account', {
        exact: true,
      }),
    ).toBeVisible()

    // The "+ Add User" button.
    await expect(
      page.getByRole('button', { name: /Add User/i }).first(),
    ).toBeVisible()

    // The protected Owner row (implicit account holder; full access, no actions).
    const ownerRow = page.getByTestId('team-owner-row')
    await expect(ownerRow).toBeVisible()
    await expect(ownerRow.getByText('Owner — you', { exact: true })).toBeVisible()
    await expect(ownerRow.getByText('Full access', { exact: true })).toBeVisible()
    // The Owner row carries NO Edit / Remove affordance.
    await expect(ownerRow.getByRole('button', { name: /Edit/i })).toHaveCount(0)
    await expect(ownerRow.getByRole('button', { name: /Remove/i })).toHaveCount(0)

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-team.png',
      fullPage: true,
    })
  })

  test('the Add-User modal opens and offers the four assignable roles', async ({
    page,
  }) => {
    await page.goto('/vendor/team')

    await page.getByRole('button', { name: /Add User/i }).first().click()

    // Scope ALL field assertions to the Add-User dialog. `getByLabel('Email')`
    // is too broad page-wide — it also matches the footer newsletter input and
    // the support@outvers.com mailto link — so every field locator below is
    // anchored to the modal's `role="dialog"`.
    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible()

    // Modal title + the collected fields.
    await expect(
      modal.getByRole('heading', { name: 'Add a team member' }),
    ).toBeVisible()
    await expect(modal.getByLabel('Full name')).toBeVisible()
    await expect(modal.getByLabel('Email')).toBeVisible()
    // Phone is labelled with an "(Optional)" suffix.
    await expect(modal.getByLabel(/Phone/i)).toBeVisible()

    // The role dropdown offers the four assignable roles — Owner is NOT
    // assignable (it is the implicit account holder, rendered as the top row).
    // Base UI's Select trigger is `data-slot="select-trigger"` (not role=combobox).
    // The role select defaults to "Manager"; the sibling status select shows
    // "Active" — so filter on the default value to pick the role trigger.
    const roleTrigger = modal
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: 'Manager' })
      .first()
    await roleTrigger.click()
    await expect(page.getByRole('option', { name: 'Manager' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Booking Staff' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Guide' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Accountant' })).toBeVisible()
    // Owner must never be an assignable option.
    await expect(page.getByRole('option', { name: 'Owner' })).toHaveCount(0)
  })

  test('reaches Team & Roles from the sidebar nav item', async ({ page }) => {
    await page.goto('/vendor/dashboard')
    await expect(page.locator('h1')).toContainText('Dashboard')

    // The sidebar renders a Team & Roles link to the route. Without the
    // /vendor/team EXCLUDED_PREFIXES entry this would 404 via the public
    // /vendor/[slug] storefront.
    await page.locator('a[href="/vendor/team"]').first().click()
    await page.waitForURL(/\/vendor\/team/)
    // Precise heading locator: a bare `locator('h1')` matches BOTH the Team &
    // Roles page heading and the (briefly co-mounted) Dashboard heading during
    // the client transition. Target the level-1 heading by its accessible name.
    await expect(
      page.getByRole('heading', { name: 'Team & Roles', level: 1 }),
    ).toBeVisible()
  })
})

// A Customer (no Vendor profile, no Vendor role) cannot reach /vendor/team —
// the (dashboard) layout gate redirects a non-Vendor to onboarding, and the
// page's own `team:manage` gate would notFound() a non-owner member. Either
// way the Team & Roles surface must NOT render for a non-team user.
test.describe('Team & Roles — non-team user is denied', () => {
  const CUSTOMER_STORAGE = path.resolve(
    __dirname,
    '../../.auth/customer-storage.json',
  )
  test.use({ storageState: CUSTOMER_STORAGE })

  test('a Customer never sees the Team & Roles surface', async ({ page }) => {
    await page.goto('/vendor/team')

    // The Team & Roles title must not render for a non-team user (redirected to
    // onboarding or notFound — never the team surface).
    await expect(
      page.getByRole('heading', { name: 'Team & Roles' }),
    ).toHaveCount(0)
    await expect(
      page.getByText('Manage users who can access your vendor account'),
    ).toHaveCount(0)
  })
})
