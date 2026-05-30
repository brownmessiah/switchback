/**
 * E2E tests for authenticated admin panel flows.
 *
 * Covers: dashboard smoke, vendors list + detail, experience approval,
 * bookings list + detail, commission, refunds, payouts, support tickets,
 * blog CMS CRUD, sub-admins, audit log, analytics, and smoke batch
 * (region closures, disputes, loyalty, promo).
 *
 * Uses the DevTools fixture for automatic console-error, uncaught-exception,
 * network-failure, and axe-core accessibility checks after each test.
 *
 * Authenticated via `tests/e2e/.auth/admin-storage.json` (injected by
 * the global setup project -- seed user `u_seed_admin`).
 */

import { test, expect } from '../../fixtures/devtools'
import {
  countAdminVendorAuditRows,
  getAdminVendorState,
  getEarliestBookingCommissionSnapshotForVendor,
  getLatestAdminVendorAudit,
  setVendorCommissionRate,
  setVendorSuspended,
} from '../../helpers/db-assertions'

// Seed user IDs — must match db/seed.ts.
const SEED_ADMIN_ID = 'u_seed_admin'
const SEED_PHONE_VENDOR_ID = 'u_seed_v_phone'
const SEED_IDENTITY_VENDOR_ID = 'u_seed_v_identity'

// ---------------------------------------------------------------------------
// 1. Dashboard: loads with stat cards
// ---------------------------------------------------------------------------
test.describe('Admin dashboard', () => {
  test('loads with stat cards and pending actions', async ({ page }) => {
    const response = await page.goto('/admin/dashboard')
    expect(response?.status()).toBe(200)

    // Page heading
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Admin overview')

    // Stat cards are visible -- the dashboard shows 5 KPI cards
    await expect(page.getByText('Users', { exact: true })).toBeVisible()
    await expect(page.getByText('Vendors', { exact: true })).toBeVisible()
    await expect(page.getByText('Experiences', { exact: true })).toBeVisible()
    await expect(page.getByText('Bookings', { exact: true })).toBeVisible()
    await expect(page.getByText('Total revenue')).toBeVisible()

    // Pending actions section
    await expect(page.getByText('Pending actions')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-dashboard.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 2. Vendors list -> detail: navigate vendors list -> click vendor -> detail
// ---------------------------------------------------------------------------
test.describe('Admin vendors list and detail', () => {
  test('navigate vendors list, click vendor, view detail with KYC info', async ({
    page,
  }) => {
    const response = await page.goto('/admin/vendors')
    expect(response?.status()).toBe(200)

    // Page heading
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Vendors')

    // Vendor count subtitle
    await expect(page.getByText(/\d+ registered vendor/)).toBeVisible()

    // Table headers
    await expect(page.getByRole('columnheader', { name: 'Business' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'KYC' })).toBeVisible()

    // Click the first vendor link in the table to navigate to detail
    const vendorLink = page.locator('a[href*="/admin/vendors/"]').first()
    await expect(vendorLink).toBeVisible()
    const vendorName = await vendorLink.textContent()
    await vendorLink.click()

    // Wait for the detail page to load
    await page.waitForURL(/\/admin\/vendors\/[^/]+/)
    await expect(page.locator('h1')).toContainText(vendorName?.trim() ?? '')

    // KYC Documents section is visible on the detail page
    await expect(page.getByText('KYC Documents')).toBeVisible()

    // Business Information section
    await expect(page.getByText('Business Information')).toBeVisible()

    // PAN field in KYC (present as a label)
    await expect(page.getByText('PAN')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-vendor-detail.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 3. Experiences: approve pending -- find pending -> approve -> verify status
// ---------------------------------------------------------------------------
test.describe('Admin experience approval', () => {
  test('find pending experience, approve it, verify status changes to published', async ({
    page,
  }) => {
    // Navigate to experiences with pending_review filter
    await page.goto('/admin/experiences?status=pending_review')
    await expect(page.locator('h1')).toContainText('Experience Moderation')

    // Check if there are pending experiences
    const pendingRows = page.locator('tr').filter({
      has: page.locator('text=pending review'),
    })
    const pendingCount = await pendingRows.count()

    if (pendingCount === 0) {
      // No pending experiences -- navigate to unfiltered list and skip
      // (this test is best-effort against seeded data)
      test.skip(true, 'No pending experiences in seed data')
      return
    }

    // Find the Approve button in the first pending row
    const firstPendingRow = pendingRows.first()
    const approveButton = firstPendingRow.locator('button').filter({ hasText: 'Approve' })
    await expect(approveButton).toBeVisible()

    // Capture the experience title for verification
    const titleCell = firstPendingRow.locator('td').first()
    const experienceTitle = await titleCell.textContent()

    // Click Approve
    await approveButton.click()

    // Wait for the page to update -- the row should now show "published"
    // After server action + revalidation, the status badge changes
    await expect(
      firstPendingRow.locator('text=published'),
    ).toBeVisible({ timeout: 15_000 })

    // Verify by navigating to published filter
    await page.goto('/admin/experiences?status=published')
    await expect(
      page.getByText(experienceTitle?.trim() ?? ''),
    ).toBeVisible({ timeout: 10_000 })

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-experience-approved.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 4. Bookings list -> detail: navigate bookings -> click -> detail page
// ---------------------------------------------------------------------------
test.describe('Admin bookings list and detail', () => {
  test('navigate bookings list, click booking, view detail with payment info', async ({
    page,
  }) => {
    const response = await page.goto('/admin/bookings')
    expect(response?.status()).toBe(200)

    // Page heading
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('All Bookings')

    // Booking count subtitle
    await expect(page.getByText(/\d+ booking/)).toBeVisible()

    // Table headers
    await expect(page.getByRole('columnheader', { name: 'Booking ID' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Amount' })).toBeVisible()

    // Check if there are any bookings
    const bookingLinks = page.locator('a[href*="/admin/bookings/"]')
    const linkCount = await bookingLinks.count()

    if (linkCount === 0) {
      test.skip(true, 'No bookings in seed data')
      return
    }

    // Click the first booking link
    await bookingLinks.first().click()

    // Wait for the detail page to load
    await page.waitForURL(/\/admin\/bookings\/[^/]+/)
    await expect(page.locator('h1')).toContainText('Booking Detail')

    // Commission Snapshot section with payment info
    await expect(page.getByText('Commission Snapshot')).toBeVisible()
    await expect(page.getByText('Gross Total')).toBeVisible()

    // Payment Timeline section
    await expect(page.getByText('Payment Timeline')).toBeVisible()

    // Booking Overview section
    await expect(page.getByText('Booking Overview')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-booking-detail.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 5. Commission page: loads with commission config UI
// ---------------------------------------------------------------------------
test.describe('Admin commission page', () => {
  test('loads with commission tier UI and tabs', async ({ page }) => {
    const response = await page.goto('/admin/commission')
    expect(response?.status()).toBe(200)

    // Page heading
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Commission Tiers')

    // Tier count subtitle
    await expect(page.getByText(/\d+ tier/)).toBeVisible()

    // Create Festival Tier form section
    await expect(page.getByText('Create Festival Tier')).toBeVisible()

    // Tab navigation -- Active, Upcoming, Expired
    await expect(page.getByRole('tab', { name: /Active/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Upcoming/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Expired/ })).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-commission.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 6. Refunds page: loads
// ---------------------------------------------------------------------------
test.describe('Admin refunds page', () => {
  test('loads with heading and table structure', async ({ page }) => {
    const response = await page.goto('/admin/refunds')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Refund requests')

    // Request count subtitle
    await expect(page.getByText(/\d+ request/)).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-refunds.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 7. Payouts page: loads
// ---------------------------------------------------------------------------
test.describe('Admin payouts page', () => {
  test('loads with heading and payout queue', async ({ page }) => {
    const response = await page.goto('/admin/payouts')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Payout queue')

    // Queue count subtitle
    await expect(page.getByText(/\d+ booking/)).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-payouts.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 8. Support tickets: loads
// ---------------------------------------------------------------------------
test.describe('Admin support tickets', () => {
  test('loads with heading and ticket table', async ({ page }) => {
    const response = await page.goto('/admin/support')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Support Tickets')

    // Ticket count subtitle
    await expect(page.getByText(/\d+ ticket/)).toBeVisible()

    // Table column headers
    await expect(page.getByRole('columnheader', { name: 'Subject' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-support.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 9. Blog CMS: create post -> save -> appears -> edit -> verify
// ---------------------------------------------------------------------------
test.describe('Admin blog CMS', () => {
  const testTitle = `E2E Blog Post -- ${Date.now()}`
  const testContent = 'This is a test blog post created by E2E tests.'
  const updatedTitle = `${testTitle} (Updated)`

  test('create new post, verify in list, edit, verify change persists', async ({
    page,
  }) => {
    await page.goto('/admin/blog')
    await expect(page.locator('h1')).toContainText('Blog CMS')

    // Post count subtitle
    await expect(page.getByText(/\d+ post/)).toBeVisible()

    // Fill the create form
    await expect(page.getByText('Create Blog Post')).toBeVisible()
    await page.fill('#title', testTitle)

    // Fill content in the textarea (controlled component)
    const contentTextarea = page.locator('#content')
    await expect(contentTextarea).toBeVisible()
    await contentTextarea.fill(testContent)

    // Submit the form -- "Save as Draft" button
    const saveDraftBtn = page.locator('button[type="submit"]').filter({ hasText: 'Save as Draft' })
    await saveDraftBtn.click()

    // Wait for success message
    await expect(page.getByText('Blog post created.')).toBeVisible({
      timeout: 15_000,
    })

    // Reload the page to see the new post in the list
    await page.reload()
    await expect(page.locator('h1')).toContainText('Blog CMS')

    // Verify the post appears in the list
    await expect(page.getByText(testTitle)).toBeVisible({ timeout: 10_000 })

    // Click "Edit" on the row containing the test post
    const postRow = page.locator('tr').filter({ hasText: testTitle })
    await expect(postRow).toBeVisible()
    const editButton = postRow.locator('button').filter({ hasText: 'Edit' })
    await editButton.click()

    // Wait for the edit dialog to open
    await expect(page.getByText('Edit Blog Post')).toBeVisible({ timeout: 5_000 })

    // Change the title in the edit dialog
    const editTitleInput = page.locator('input[name="title"]').last()
    await editTitleInput.fill(updatedTitle)

    // Click "Save as Draft" in the dialog
    const dialogSaveBtn = page
      .locator('[data-slot="dialog-content"]')
      .locator('button[type="submit"]')
      .filter({ hasText: 'Save as Draft' })
    await dialogSaveBtn.click()

    // The dialog should close after successful save
    await expect(page.getByText('Edit Blog Post')).not.toBeVisible({
      timeout: 10_000,
    })

    // Reload to verify persistence
    await page.reload()
    await expect(page.getByText(updatedTitle)).toBeVisible({ timeout: 10_000 })

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-blog-crud.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 10. Sub-admins page: loads
// ---------------------------------------------------------------------------
test.describe('Admin sub-admins page', () => {
  test('loads with heading and admin table', async ({ page }) => {
    const response = await page.goto('/admin/sub-admins')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Sub-Admin Management')

    // Admin count subtitle
    await expect(page.getByText(/\d+ admin/)).toBeVisible()

    // Invite Sub-Admin form section
    await expect(page.getByText('Invite Sub-Admin')).toBeVisible()

    // Current Admins table
    await expect(page.getByText('Current Admins')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-sub-admins.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 11. Audit log: loads with log entries
// ---------------------------------------------------------------------------
test.describe('Admin audit log', () => {
  test('loads with heading, filters, and log table', async ({ page }) => {
    const response = await page.goto('/admin/audit')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Audit Logs')

    // Log count subtitle
    await expect(page.getByText(/\d+ log/)).toBeVisible()

    // Table column headers
    await expect(page.getByRole('columnheader', { name: 'Time' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Action' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Actor' })).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-audit-log.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 12. Analytics: loads with chart components rendering
// ---------------------------------------------------------------------------
test.describe('Admin analytics', () => {
  test('loads with KPI cards and chart components', async ({ page }) => {
    const response = await page.goto('/admin/analytics')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Analytics')

    // KPI cards
    await expect(page.getByText('Total revenue')).toBeVisible()
    await expect(page.getByText('Total bookings')).toBeVisible()
    await expect(page.getByText('Avg booking value')).toBeVisible()
    await expect(page.getByText('Total users')).toBeVisible()
    await expect(page.getByText('Total vendors')).toBeVisible()
    await expect(page.getByText('Published experiences')).toBeVisible()

    // Chart components -- verify the chart card titles render
    await expect(page.getByText('Revenue trend (monthly)')).toBeVisible()
    await expect(page.getByText('Booking volume (weekly)')).toBeVisible()
    await expect(page.getByText('Vendor growth (monthly)')).toBeVisible()
    await expect(page.getByText('Category performance')).toBeVisible()

    // Recharts renders SVG containers -- verify at least one is present
    const svgCharts = page.locator('.recharts-responsive-container')
    const chartCount = await svgCharts.count()
    expect(chartCount).toBeGreaterThanOrEqual(4)

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-analytics.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 13. Smoke batch: region closures, disputes, loyalty, promo all return 200
// ---------------------------------------------------------------------------
test.describe('Admin smoke batch', () => {
  const smokePagesMap: ReadonlyArray<{ path: string; heading: string }> = [
    { path: '/admin/region-closures', heading: 'Region Closures' },
    { path: '/admin/disputes', heading: 'Dispute queue' },
    { path: '/admin/loyalty', heading: 'Loyalty & Credits' },
    { path: '/admin/promo', heading: 'Promo Codes' },
  ]

  for (const { path: pagePath, heading } of smokePagesMap) {
    test(`${pagePath} loads with heading "${heading}"`, async ({ page }) => {
      const response = await page.goto(pagePath)
      expect(response?.status()).toBe(200)

      const h1 = page.locator('h1')
      await expect(h1).toBeVisible()
      await expect(h1).toContainText(heading)

      await page.screenshot({
        path: `tests/e2e/screenshots/admin-smoke-${pagePath.replace(/\//g, '-').slice(1)}.png`,
        fullPage: true,
      })
    })
  }
})

// ---------------------------------------------------------------------------
// 14. Functional: admin vendor KYC + commission + suspend (#22)
//
// Drives the four privileged admin Server Actions FROM THE UI and asserts
// the persisted vendor_profiles state plus the append-only audit_logs trail.
//   - KYC APPROVE: phone → identity (the ADR-0007 manual-review path from #16)
//   - KYC REJECT : tier unchanged, reason recorded
//   - COMMISSION : base rate persists + existing Booking snapshot UNCHANGED
//                  (ADR-0008 snapshot immutability)
//   - SUSPEND    : toggle suspends then reactivates
//
// Each privileged action MUST write exactly one audit_logs row with the
// admin as actor. Mutating tests (commission, suspend) restore their writes
// in a finally so seed determinism for parallel specs is preserved. The KYC
// approve permanently promotes the phone-tier seed Vendor — that Vendor has
// no listings/bookings and no other spec depends on its tier, so the one-way
// transition is safe and is exactly the documented manual-approve behaviour.
// ---------------------------------------------------------------------------
test.describe('Admin vendor KYC + commission + suspend (#22)', () => {
  test.describe.configure({ mode: 'serial' })

  test('KYC approve: phone-tier vendor → identity + audit row with actor + notes', async ({
    page,
  }) => {
    const before = await getAdminVendorState(SEED_PHONE_VENDOR_ID)
    expect(before, 'seed phone-tier vendor must exist').not.toBeNull()
    // Best-effort idempotency on a reused DB: if a prior run already promoted
    // this vendor, the approve UI will not be available — skip in that case.
    test.skip(before!.kycTier !== 'phone', 'phone-tier vendor already promoted')

    const APPROVE_NOTES = `E2E: Aadhaar + PAN verified offline ${Date.now()}`

    await page.goto(`/admin/vendors/${SEED_PHONE_VENDOR_ID}`)
    await expect(page.getByText('KYC Tier Management')).toBeVisible()

    // The approval form is the first of the two KYC forms (approve / reject).
    await page.locator('#approve-notes').fill(APPROVE_NOTES)
    await page.getByRole('button', { name: /Approve → identity/ }).click()

    // Inline success state on a persisted promotion.
    await expect(page.getByText('KYC tier promoted successfully.')).toBeVisible({
      timeout: 15_000,
    })

    // ── Assert: tier persisted as identity ───────────────────────────────
    const after = await getAdminVendorState(SEED_PHONE_VENDOR_ID)
    expect(after!.kycTier).toBe('identity')

    // ── Assert: exactly one approve audit row with actor + decision notes ─
    expect(
      await countAdminVendorAuditRows('admin.kyc.approve', SEED_PHONE_VENDOR_ID),
    ).toBe(1)
    const audit = await getLatestAdminVendorAudit(
      'admin.kyc.approve',
      SEED_PHONE_VENDOR_ID,
    )
    expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
    expect(audit!.payload).toMatchObject({
      previousTier: 'phone',
      newTier: 'identity',
      notes: APPROVE_NOTES,
    })

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-vendor-kyc-approve.png',
      fullPage: true,
    })
  })

  test('KYC reject: tier unchanged + reason recorded in audit row', async ({
    page,
  }) => {
    const before = await getAdminVendorState(SEED_IDENTITY_VENDOR_ID)
    expect(before, 'seed identity-tier vendor must exist').not.toBeNull()
    const tierBefore = before!.kycTier
    const rejectsBefore = await countAdminVendorAuditRows(
      'admin.kyc.reject',
      SEED_IDENTITY_VENDOR_ID,
    )

    const REJECT_REASON = `E2E: GSTIN certificate illegible ${Date.now()}`

    await page.goto(`/admin/vendors/${SEED_IDENTITY_VENDOR_ID}`)
    await expect(page.getByText('KYC Tier Management')).toBeVisible()

    await page.locator('#reject-reason').fill(REJECT_REASON)
    await page.getByRole('button', { name: 'Reject Promotion' }).click()

    await expect(page.getByText('Rejection recorded.')).toBeVisible({
      timeout: 15_000,
    })

    // ── Assert: rejection does NOT change the tier ───────────────────────
    const after = await getAdminVendorState(SEED_IDENTITY_VENDOR_ID)
    expect(after!.kycTier).toBe(tierBefore)

    // ── Assert: a new reject audit row with the reason was appended ───────
    expect(
      await countAdminVendorAuditRows('admin.kyc.reject', SEED_IDENTITY_VENDOR_ID),
    ).toBe(rejectsBefore + 1)
    const audit = await getLatestAdminVendorAudit(
      'admin.kyc.reject',
      SEED_IDENTITY_VENDOR_ID,
    )
    expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
    expect(audit!.payload).toMatchObject({
      currentTier: tierBefore,
      reason: REJECT_REASON,
    })
  })

  test('commission-rate update persists + existing Booking snapshot UNCHANGED (ADR-0008)', async ({
    page,
  }) => {
    // The identity-tier Vendor owns existing seed Bookings whose commission
    // snapshot was locked at booking-create (20.00). Changing the base rate
    // must NOT touch that snapshot.
    const booking = await getEarliestBookingCommissionSnapshotForVendor(
      SEED_IDENTITY_VENDOR_ID,
    )
    expect(booking, 'identity vendor must own an existing booking').not.toBeNull()
    const snapshotBefore = booking!.commissionRateSnapshot

    const stateBefore = await getAdminVendorState(SEED_IDENTITY_VENDOR_ID)
    const rateBefore = stateBefore!.commissionRate
    const NEW_RATE = '12.50'
    expect(rateBefore, 'pick a rate distinct from the seed default').not.toBe(NEW_RATE)

    try {
      await page.goto(`/admin/vendors/${SEED_IDENTITY_VENDOR_ID}`)
      await expect(page.getByText('Commission Rate')).toBeVisible()

      // The Commission Rate card shows the value read-only; click Edit to
      // reveal the inline form (the only Edit button on the detail page).
      await page.getByRole('button', { name: 'Edit' }).click()

      await page.locator('#commissionRate').fill(NEW_RATE)
      await page.getByRole('button', { name: 'Save', exact: true }).click()

      await expect(page.getByText('Rate updated successfully.')).toBeVisible({
        timeout: 15_000,
      })

      // ── Assert: base rate persisted on the Vendor ──────────────────────
      const stateAfter = await getAdminVendorState(SEED_IDENTITY_VENDOR_ID)
      expect(stateAfter!.commissionRate).toBe(NEW_RATE)

      // ── Assert: the existing Booking's snapshot is UNCHANGED ───────────
      const bookingAfter = await getEarliestBookingCommissionSnapshotForVendor(
        SEED_IDENTITY_VENDOR_ID,
      )
      expect(bookingAfter!.bookingId).toBe(booking!.bookingId)
      expect(bookingAfter!.commissionRateSnapshot).toBe(snapshotBefore)

      // ── Assert: an update audit row with actor + before/after rate ─────
      const audit = await getLatestAdminVendorAudit(
        'admin.commission_rate.update',
        SEED_IDENTITY_VENDOR_ID,
      )
      expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
      expect(audit!.payload).toMatchObject({
        previousRate: rateBefore,
        newRate: NEW_RATE,
      })

      await page.screenshot({
        path: 'tests/e2e/screenshots/admin-vendor-commission.png',
        fullPage: true,
      })
    } finally {
      // Restore the seed base rate so parallel/later specs see deterministic data.
      await setVendorCommissionRate(SEED_IDENTITY_VENDOR_ID, rateBefore)
    }
  })

  test('suspend toggle: suspends then reactivates + audit rows', async ({ page }) => {
    // Operate on the phone-tier Vendor (no listings/bookings) so the toggle
    // never disturbs other specs' booking determinism.
    const before = await getAdminVendorState(SEED_PHONE_VENDOR_ID)
    expect(before, 'seed phone-tier vendor must exist').not.toBeNull()
    const suspendsBefore = await countAdminVendorAuditRows(
      'admin.vendor.suspend',
      SEED_PHONE_VENDOR_ID,
    )
    const reactivatesBefore = await countAdminVendorAuditRows(
      'admin.vendor.reactivate',
      SEED_PHONE_VENDOR_ID,
    )

    try {
      // Ensure a known starting point (active) regardless of prior runs.
      await setVendorSuspended(SEED_PHONE_VENDOR_ID, false)

      await page.goto(`/admin/vendors/${SEED_PHONE_VENDOR_ID}`)
      await expect(page.getByText('Account Status')).toBeVisible()

      // ── Suspend ────────────────────────────────────────────────────────
      await page.locator('#suspend-notes').fill('E2E: repeated policy violations.')
      await page.getByRole('button', { name: 'Suspend Vendor' }).click()
      await expect(page.getByText('Vendor suspended.')).toBeVisible({ timeout: 15_000 })

      const suspended = await getAdminVendorState(SEED_PHONE_VENDOR_ID)
      expect(suspended!.suspended).toBe(true)
      expect(
        await countAdminVendorAuditRows('admin.vendor.suspend', SEED_PHONE_VENDOR_ID),
      ).toBe(suspendsBefore + 1)

      // ── Reactivate ──────────────────────────────────────────────────────
      // After revalidation the form now renders the reactivate variant.
      await expect(page.getByRole('button', { name: 'Reactivate Vendor' })).toBeVisible({
        timeout: 15_000,
      })
      await page.locator('#suspend-notes').fill('E2E: issue resolved, reinstated.')
      await page.getByRole('button', { name: 'Reactivate Vendor' }).click()
      await expect(page.getByText('Vendor reactivated.')).toBeVisible({ timeout: 15_000 })

      const reactivated = await getAdminVendorState(SEED_PHONE_VENDOR_ID)
      expect(reactivated!.suspended).toBe(false)
      expect(
        await countAdminVendorAuditRows('admin.vendor.reactivate', SEED_PHONE_VENDOR_ID),
      ).toBe(reactivatesBefore + 1)

      const audit = await getLatestAdminVendorAudit(
        'admin.vendor.reactivate',
        SEED_PHONE_VENDOR_ID,
      )
      expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
      expect(audit!.payload).toMatchObject({ suspended: false })

      await page.screenshot({
        path: 'tests/e2e/screenshots/admin-vendor-suspend.png',
        fullPage: true,
      })
    } finally {
      await setVendorSuspended(SEED_PHONE_VENDOR_ID, false)
    }
  })
})
