/**
 * E2E smoke for the Vendor Analytics surface (issue 01 — tracer bullet).
 *
 * Authenticated via `tests/e2e/.auth/vendor-storage.json` (seed user
 * `u_seed_v_business`, business-verified, with seeded Bookings).
 *
 * Covers:
 *   - An authenticated Vendor reaches /vendor/analytics and sees the Analytics
 *     heading plus the Total revenue / Total bookings headline KPIs.
 *   - The trended Key Metrics grid (issue 02) renders for a Vendor WITH
 *     Bookings, and the honest empty state shows (with NO Key Metrics grid)
 *     when the Vendor has no data.
 *   - The "Analytics" sidebar item navigates to the route (nav wiring).
 *
 * Uses the DevTools fixture for automatic console-error, uncaught-exception,
 * network-failure, and axe-core accessibility checks after each test.
 */

import { test, expect } from '../../fixtures/devtools'

test.describe('Vendor analytics', () => {
  test('renders the Analytics heading and headline KPIs', async ({ page }) => {
    const response = await page.goto('/vendor/analytics')
    expect(response?.status()).toBe(200)

    // Page heading.
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Analytics')

    // Headline KPI labels (en canonical copy).
    await expect(page.getByText('Total revenue', { exact: true })).toBeVisible()
    await expect(page.getByText('Total bookings', { exact: true })).toBeVisible()

    // The seed business Vendor has Bookings → at least one rupee figure renders.
    await expect(page.getByText(/₹[\d,]+/).first()).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-analytics.png',
      fullPage: true,
    })
  })

  test('renders the trended Key Metrics grid for a Vendor with Bookings', async ({
    page,
  }) => {
    await page.goto('/vendor/analytics')

    // The seed business Vendor has Bookings → the Key Metrics section renders
    // (and the empty state does NOT).
    const keyMetrics = page.getByTestId('analytics-key-metrics')
    await expect(keyMetrics).toBeVisible()
    await expect(page.getByTestId('analytics-empty-state')).toHaveCount(0)

    // Section heading + each metric label (en canonical copy).
    await expect(
      page.getByRole('heading', { name: 'Key metrics' }),
    ).toBeVisible()
    await expect(
      page.getByText('Revenue (last 30 days)', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Bookings (last 30 days)', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Average Booking value', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Upcoming (next 7 days)', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('New Bookings (last 7 days)', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Cancellation rate', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Repeat Customers', { exact: true }),
    ).toBeVisible()

    // Cancellation rate renders a real percentage (never NaN).
    await expect(page.getByText(/\d+\.\d%/).first()).toBeVisible()

    // No net/payout/"you keep X%" figure is ever introduced (ADR-0016).
    await expect(page.getByText(/you keep/i)).toHaveCount(0)
    await expect(page.getByText(/payout %/i)).toHaveCount(0)
  })

  test('renders the charts, status breakdown, and Revenue-by-Experience for a Vendor with Bookings', async ({
    page,
  }) => {
    await page.goto('/vendor/analytics')

    // Trends section (issue 03) — both revenue charts render through the shared
    // TrendChart primitive (the seed business Vendor has Bookings → real series).
    await expect(page.getByTestId('analytics-charts')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Trends' }),
    ).toBeVisible()
    await expect(
      page.getByText('Revenue — last 30 days', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Monthly revenue', { exact: true }),
    ).toBeVisible()

    // Booking status breakdown — counts grouped by Booking state.
    await expect(page.getByTestId('analytics-status-breakdown')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Booking status breakdown' }),
    ).toBeVisible()

    // Revenue by Experience — per-Experience Booking count + gross revenue.
    const byExperience = page.getByTestId('analytics-revenue-by-experience')
    await expect(byExperience).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Revenue by Experience' }),
    ).toBeVisible()
    // The seed Vendor has Bookings → at least one Experience row renders (the
    // table key spreads data-experience-id onto every row at ≥ md AND < md).
    await expect(
      byExperience.locator('[data-experience-id]').first(),
    ).toBeVisible()

    // Revenue stays GROSS (ADR-0016) — no net/payout/"you keep X%" anywhere.
    await expect(page.getByText(/you keep/i)).toHaveCount(0)
  })

  // Empty-state contract for a Vendor WITHOUT Bookings: the honest empty state
  // renders and the Key Metrics grid does NOT (no fabricated values). The
  // zero-base aggregation is exhaustively unit-tested in
  // lib/vendor/analytics-loader.test.ts ("zero-base Key Metrics for a Vendor
  // with no Bookings"); here we assert the DOM contract. It requires an
  // authenticated Vendor that has a vendor_profile but no Bookings — the seed
  // `u_seed_v_phone` qualifies, but it has no pre-built auth storage state in
  // the default project matrix, so this is skipped until that fixture exists
  // (adding a new auth fixture is outside this issue's file scope).
  test.skip('shows the honest empty state (no Key Metrics) for a Vendor without Bookings', async ({
    page,
  }) => {
    await page.goto('/vendor/analytics')

    await expect(page.getByTestId('analytics-empty-state')).toBeVisible()
    await expect(page.getByText('No Bookings yet.', { exact: false })).toBeVisible()
    // No fabricated metrics — the Key Metrics grid must be absent.
    await expect(page.getByTestId('analytics-key-metrics')).toHaveCount(0)
    await expect(page.getByText('+100', { exact: false })).toHaveCount(0)
    // No fabricated charts/breakdowns either — the issue-03 sections (which
    // each carry their own honest empty state) are gated on data.hasData and
    // must be absent for a Vendor with no Bookings. The all-zero-series and
    // empty-list paths are exhaustively unit-tested in analytics-loader.test.ts
    // ("returns honest empty breakdowns for a Vendor with no Bookings").
    await expect(page.getByTestId('analytics-charts')).toHaveCount(0)
    await expect(page.getByTestId('analytics-status-breakdown')).toHaveCount(0)
    await expect(
      page.getByTestId('analytics-revenue-by-experience'),
    ).toHaveCount(0)
  })

  test('reaches Analytics from the sidebar nav item', async ({ page }) => {
    await page.goto('/vendor/dashboard')
    await expect(page.locator('h1')).toContainText('Dashboard')

    // The sidebar renders one Analytics link to the route. Click the first.
    await page.locator('a[href="/vendor/analytics"]').first().click()
    await page.waitForURL(/\/vendor\/analytics/)
    await expect(page.locator('h1')).toContainText('Analytics')
  })
})
