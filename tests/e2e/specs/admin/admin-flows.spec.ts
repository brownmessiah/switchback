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
  clearWalletForUser,
  countAdminVendorAuditRows,
  countBookingsInWindowForExperience,
  countCommissionTierAuditRows,
  countDisputeAuditRows,
  countExperienceAuditRows,
  countPayoutAuditRows,
  countPromoAuditRows,
  countRefundAuditRows,
  deleteCommissionTierById,
  deleteDisputedBookingFixture,
  deletePromoCodeById,
  getAdminVendorState,
  getBookingLifecycle,
  getBookingPayoutState,
  getCommissionTierById,
  getCommissionTierByName,
  getEarliestBookingCommissionSnapshotForVendor,
  getExperienceIdBySlug,
  getExperienceSlugRegion,
  getExperienceStatus,
  getLatestAdminVendorAudit,
  getLatestClosureAudit,
  getLatestCommissionTierAudit,
  getLatestDisputeAudit,
  getLatestExperienceAudit,
  getLatestPayoutAudit,
  getLatestRefundAudit,
  getPendingPayoutBookingsForVendor,
  getPendingRefundRequestsForCustomer,
  getPromoCodeByCode,
  getPromoCodeById,
  getRefundBalanceCreditAuditForBooking,
  getRefundRequestForBooking,
  getRefundRequestStateById,
  getRegionClosureById,
  getRegionClosureByReason,
  getVendorManualPayoutsRemaining,
  getWalletBalanceRupees,
  getWalletGrantAudit,
  getWalletTransactions,
  insertDisputedBookingFixture,
  setVendorCommissionRate,
  setVendorSuspended,
} from '../../helpers/db-assertions'
import { getIndexedExperience } from '../../helpers/meili-assertions'

// Seed user IDs — must match db/seed.ts.
const SEED_ADMIN_ID = 'u_seed_admin'
const SEED_PHONE_VENDOR_ID = 'u_seed_v_phone'
const SEED_IDENTITY_VENDOR_ID = 'u_seed_v_identity'

// #24 refund-queue + payout-queue dedicated fixtures — must match db/seed.ts.
const SEED_REFUND_QUEUE_CUSTOMER_ID = 'u_seed_customer_refundq'
const SEED_PAYOUT_QUEUE_VENDOR_ID = 'u_seed_v_payout'
const REFUND_QUEUE_CUSTOMER_EMAIL = 'customer-refundq@seed.outvers.dev'

// #26 commission-tier scope-count + loyalty-grant fixtures — must match db/seed.ts.
const SEED_LOYALTY_CUSTOMER_ID = 'u_seed_customer_loyalty'
const SEED_LOYALTY_CUSTOMER_EMAIL = 'customer-loyalty@seed.outvers.dev'
const SEED_COMMISSION_SCOPE_SLUG = 'commission-scope-fixture-bir-billing'
// The fixed September-2026 window the commission-scope fixture Bookings sit in.
// `*_FILL` are minute-precision strings for the datetime-local inputs (no
// seconds — datetime-local rejects them); `*_ISO` are the precise boundaries
// the independent DB-count reference uses. The minute-precision window still
// brackets the three 08:00-UTC in-window Bookings and excludes the Aug control.
const COMMISSION_SCOPE_WINDOW_START_FILL = '2026-09-01T00:00'
const COMMISSION_SCOPE_WINDOW_END_FILL = '2026-09-30T23:59'
const COMMISSION_SCOPE_WINDOW_START_ISO = '2026-09-01T00:00:00.000Z'
const COMMISSION_SCOPE_WINDOW_END_ISO = '2026-09-30T23:59:59.000Z'
// Three Bookings created INSIDE the window (one control created before it).
const COMMISSION_SCOPE_IN_WINDOW = 3

// Dedicated Experience-moderation seed slugs — must match db/seed.ts.
// Each is owned by the identity-tier Vendor and is isolated from every other
// spec (no bookings, no reviews, distinct slugs/slots). The within-cap ones
// approve cleanly; the over-cap one is rejected by the ADR-0007 tier-cap guard.
const MOD_APPROVE_SLUG = 'mod-pending-approve-within-cap'
const MOD_OVERCAP_SLUG = 'mod-pending-overcap'
const MOD_REJECT_SLUG = 'mod-pending-reject'
const MOD_PAUSE_SLUG = 'mod-pending-pause'
const MOD_ARCHIVE_SLUG = 'mod-pending-archive'

// #25 dispute-resolution + region-closure fixtures.
// Staged disputed Bookings are owned by an existing seed customer; the refund
// is asserted via the immutable wallet.credit_refund_balance audit row (keyed
// by bookingId), so no dedicated wallet is required. The Experience hosts the
// staged disputed Bookings (on fresh past slots) and is also the surface the
// region-closure test asserts the inline customer-facing block on.
const SEED_DISPUTE_CUSTOMER_ID = 'u_seed_customer_biz'
// A business-Vendor published Experience in the bir-billing region. No other
// admin test asserts a bir-billing closure, so the closure this test creates +
// deletes via the UI never races another admin assertion.
const DISPUTE_EXPERIENCE_SLUG = 'bir-billing-paragliding-full-day'

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
// 3. Functional: admin Experience moderation (#23)
//
// Drives the four admin Experience-moderation Server Actions FROM THE UI
// (approve / reject / pause / archive) and asserts BOTH the persisted
// experiences.status AND the Meilisearch index/deindex side-effect
// (ADR-0013), plus the append-only audit_logs trail.
//
//   - APPROVE     : pending_review → published AND INDEXED into Meilisearch
//                   (getIndexedExperience returns the doc → searchable).
//   - APPROVE cap : an OVER-CAP pending Experience (price > Rs.5000 for an
//                   identity-tier Vendor) is REJECTED by the ADR-0007 tier-cap
//                   guard — stays pending_review, NOT indexed, a
//                   tier_cap_rejected audit row written (ADR-0007).
//   - REJECT      : pending_review → archived (stays OUT of the live catalog),
//                   reason recorded in the audit payload, NOT indexed.
//   - PAUSE       : a freshly-approved (published + indexed) Experience →
//                   paused AND DE-INDEXED (getIndexedExperience returns null).
//   - ARCHIVE     : a freshly-approved (published + indexed) Experience →
//                   archived AND DE-INDEXED.
//
// Each action writes exactly one audit_logs row with the admin as actor.
// Every Experience here is a DEDICATED moderation seed (identity-tier Vendor,
// no bookings, no reviews, distinct slugs/slots) so these one-way status
// transitions never disturb any other spec's determinism. The seed does NOT
// pre-index into Meilisearch, so pause/archive first approve (proving the doc
// IS indexed) and then prove the de-index — a full index→deindex round-trip.
//
// Serial so the per-Experience approve→pause / approve→archive chains run in
// a known order against the shared E2E DB + Meili index.
// ---------------------------------------------------------------------------
test.describe('Admin experience moderation (#23)', () => {
  test.describe.configure({ mode: 'serial' })

  test('approve: pending_review → published AND indexed into Meilisearch + audit row', async ({
    page,
  }) => {
    const experienceId = await getExperienceIdBySlug(MOD_APPROVE_SLUG)
    expect(experienceId, `seed moderation experience ${MOD_APPROVE_SLUG} must exist`).not.toBeNull()
    // Best-effort idempotency on a reused DB: skip if a prior run already approved it.
    const statusBefore = await getExperienceStatus(experienceId!)
    test.skip(statusBefore !== 'pending_review', 'already moderated on a reused DB')

    await page.goto('/admin/experiences?status=pending_review')
    await expect(page.locator('h1')).toContainText('Experience Moderation')

    const row = page.locator('tr').filter({ hasText: 'Approve me — Within-Cap Pending' })
    await expect(row).toBeVisible()
    await row.locator('button').filter({ hasText: 'Approve' }).click()

    // After the server action + revalidation the now-published row drops OUT
    // of the pending_review-filtered list.
    await expect(row).toHaveCount(0, { timeout: 15_000 })

    // ── Assert: persisted status is published ────────────────────────────
    await expect
      .poll(async () => getExperienceStatus(experienceId!), { timeout: 15_000 })
      .toBe('published')

    // ── Assert: INDEXED into Meilisearch → discoverable in search ────────
    const doc = await getIndexedExperience(experienceId!)
    expect(doc, 'approved experience must be indexed in Meilisearch').not.toBeNull()
    expect(doc!.id).toBe(experienceId)
    expect(doc!.slug).toBe(MOD_APPROVE_SLUG)

    // ── Assert: exactly one approve audit row with actor + transition ────
    expect(
      await countExperienceAuditRows('admin.experience.approve', experienceId!),
    ).toBe(1)
    const audit = await getLatestExperienceAudit('admin.experience.approve', experienceId!)
    expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
    expect(audit!.payload).toMatchObject({
      previousStatus: 'pending_review',
      newStatus: 'published',
    })

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-experience-approved.png',
      fullPage: true,
    })
  })

  test('approve over-cap: tier-cap guard rejects — stays pending_review, NOT indexed, rejection audited (ADR-0007)', async ({
    page,
  }) => {
    const experienceId = await getExperienceIdBySlug(MOD_OVERCAP_SLUG)
    expect(experienceId, `seed over-cap experience ${MOD_OVERCAP_SLUG} must exist`).not.toBeNull()
    const statusBefore = await getExperienceStatus(experienceId!)
    test.skip(statusBefore !== 'pending_review', 'already moderated on a reused DB')

    await page.goto('/admin/experiences?status=pending_review')
    await expect(page.locator('h1')).toContainText('Experience Moderation')

    const row = page.locator('tr').filter({ hasText: 'Over-Cap Pending' })
    await expect(row).toBeVisible()
    await row.locator('button').filter({ hasText: 'Approve' }).click()

    // The inline cell surfaces the guard's rejection reason; the badge never
    // flips to published.
    await expect(row.getByText(/Rs\.5000 per person/)).toBeVisible({ timeout: 15_000 })

    // ── Assert: REJECTED — status unchanged, never published ─────────────
    expect(await getExperienceStatus(experienceId!)).toBe('pending_review')

    // ── Assert: NOT indexed into Meilisearch ─────────────────────────────
    expect(
      await getIndexedExperience(experienceId!, { timeoutMs: 2000 }),
      'over-cap experience must NOT be indexed',
    ).toBeNull()

    // ── Assert: no approve row, exactly one tier_cap_rejected row (ADR-0007)
    expect(
      await countExperienceAuditRows('admin.experience.approve', experienceId!),
    ).toBe(0)
    expect(
      await countExperienceAuditRows('admin.experience.tier_cap_rejected', experienceId!),
    ).toBe(1)
    const audit = await getLatestExperienceAudit(
      'admin.experience.tier_cap_rejected',
      experienceId!,
    )
    expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
    expect(audit!.payload).toMatchObject({ code: 'PRICE_OVER_CAP' })
  })

  test('reject: pending_review → archived (out of catalog), reason recorded, NOT indexed', async ({
    page,
  }) => {
    const experienceId = await getExperienceIdBySlug(MOD_REJECT_SLUG)
    expect(experienceId, `seed reject experience ${MOD_REJECT_SLUG} must exist`).not.toBeNull()
    const statusBefore = await getExperienceStatus(experienceId!)
    test.skip(statusBefore !== 'pending_review', 'already moderated on a reused DB')

    const REJECT_REASON = `E2E: photos do not match the activity ${Date.now()}`

    await page.goto('/admin/experiences?status=pending_review')
    const row = page.locator('tr').filter({ hasText: 'Reject me — Pending' })
    await expect(row).toBeVisible()
    await row.locator('button').filter({ hasText: 'Reject' }).click()

    // The reject dialog opens; provide a reason and confirm.
    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog.getByText('Reject Experience')).toBeVisible()
    await dialog.locator('textarea').fill(REJECT_REASON)
    await dialog.getByRole('button', { name: 'Reject', exact: true }).click()

    // ── Assert: archived — out of the live catalog, never published ──────
    await expect
      .poll(async () => getExperienceStatus(experienceId!), { timeout: 15_000 })
      .toBe('archived')

    // ── Assert: NOT indexed ──────────────────────────────────────────────
    expect(
      await getIndexedExperience(experienceId!, { timeoutMs: 2000 }),
      'rejected experience must NOT be indexed',
    ).toBeNull()

    // ── Assert: reject audit row with actor + reason ─────────────────────
    expect(
      await countExperienceAuditRows('admin.experience.reject', experienceId!),
    ).toBe(1)
    const audit = await getLatestExperienceAudit('admin.experience.reject', experienceId!)
    expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
    expect(audit!.payload).toMatchObject({
      previousStatus: 'pending_review',
      newStatus: 'archived',
      reason: REJECT_REASON,
    })
  })

  test('pause: approve (published + indexed) → pause → paused AND de-indexed + audit row', async ({
    page,
  }) => {
    const experienceId = await getExperienceIdBySlug(MOD_PAUSE_SLUG)
    expect(experienceId, `seed pause experience ${MOD_PAUSE_SLUG} must exist`).not.toBeNull()
    const statusBefore = await getExperienceStatus(experienceId!)
    test.skip(statusBefore !== 'pending_review', 'already moderated on a reused DB')

    // ── Step 1: approve so it is published AND indexed (proves index) ────
    await page.goto('/admin/experiences?status=pending_review')
    const pendingRow = page.locator('tr').filter({ hasText: 'Pause me — Pending' })
    await expect(pendingRow).toBeVisible()
    await pendingRow.locator('button').filter({ hasText: 'Approve' }).click()
    // Drops out of the pending_review filter once published.
    await expect(pendingRow).toHaveCount(0, { timeout: 15_000 })

    await expect
      .poll(async () => getExperienceStatus(experienceId!), { timeout: 15_000 })
      .toBe('published')
    expect(
      await getIndexedExperience(experienceId!),
      'experience must be indexed after approve',
    ).not.toBeNull()

    // ── Step 2: pause the now-published Experience ───────────────────────
    await page.goto('/admin/experiences?status=published')
    const publishedRow = page.locator('tr').filter({ hasText: 'Pause me — Pending' })
    await expect(publishedRow).toBeVisible()
    await publishedRow.locator('button').filter({ hasText: 'Pause' }).click()
    // Drops out of the published filter once paused.
    await expect(publishedRow).toHaveCount(0, { timeout: 15_000 })

    // ── Assert: persisted status is paused ───────────────────────────────
    await expect
      .poll(async () => getExperienceStatus(experienceId!), { timeout: 15_000 })
      .toBe('paused')

    // ── Assert: DE-INDEXED — no longer in search ─────────────────────────
    expect(
      await getIndexedExperience(experienceId!, { timeoutMs: 4000 }),
      'paused experience must be de-indexed',
    ).toBeNull()

    // ── Assert: pause audit row with actor + transition ──────────────────
    expect(
      await countExperienceAuditRows('admin.experience.pause', experienceId!),
    ).toBe(1)
    const audit = await getLatestExperienceAudit('admin.experience.pause', experienceId!)
    expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
    expect(audit!.payload).toMatchObject({
      previousStatus: 'published',
      newStatus: 'paused',
    })
  })

  test('archive: approve (published + indexed) → archive → archived AND de-indexed + audit row', async ({
    page,
  }) => {
    const experienceId = await getExperienceIdBySlug(MOD_ARCHIVE_SLUG)
    expect(experienceId, `seed archive experience ${MOD_ARCHIVE_SLUG} must exist`).not.toBeNull()
    const statusBefore = await getExperienceStatus(experienceId!)
    test.skip(statusBefore !== 'pending_review', 'already moderated on a reused DB')

    // ── Step 1: approve so it is published AND indexed ───────────────────
    await page.goto('/admin/experiences?status=pending_review')
    const pendingRow = page.locator('tr').filter({ hasText: 'Archive me — Pending' })
    await expect(pendingRow).toBeVisible()
    await pendingRow.locator('button').filter({ hasText: 'Approve' }).click()
    // Drops out of the pending_review filter once published.
    await expect(pendingRow).toHaveCount(0, { timeout: 15_000 })

    await expect
      .poll(async () => getExperienceStatus(experienceId!), { timeout: 15_000 })
      .toBe('published')
    expect(
      await getIndexedExperience(experienceId!),
      'experience must be indexed after approve',
    ).not.toBeNull()

    // ── Step 2: archive the now-published Experience ─────────────────────
    await page.goto('/admin/experiences?status=published')
    const publishedRow = page.locator('tr').filter({ hasText: 'Archive me — Pending' })
    await expect(publishedRow).toBeVisible()
    await publishedRow.locator('button').filter({ hasText: 'Archive' }).click()
    // Drops out of the published filter once archived.
    await expect(publishedRow).toHaveCount(0, { timeout: 15_000 })

    // ── Assert: persisted status is archived ─────────────────────────────
    await expect
      .poll(async () => getExperienceStatus(experienceId!), { timeout: 15_000 })
      .toBe('archived')

    // ── Assert: DE-INDEXED — no longer in search ─────────────────────────
    expect(
      await getIndexedExperience(experienceId!, { timeoutMs: 4000 }),
      'archived experience must be de-indexed',
    ).toBeNull()

    // ── Assert: archive audit row with actor + transition ────────────────
    expect(
      await countExperienceAuditRows('admin.experience.archive', experienceId!),
    ).toBe(1)
    const audit = await getLatestExperienceAudit('admin.experience.archive', experienceId!)
    expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
    expect(audit!.payload).toMatchObject({
      previousStatus: 'published',
      newStatus: 'archived',
    })

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-experience-archived.png',
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

// ---------------------------------------------------------------------------
// 15. Functional: admin refund queue (#24)
//
// Drives the two admin refund Server Actions FROM THE UI (approve / reject)
// and asserts BOTH the persisted refund_requests.state AND the money movement
// (approve → credit the Customer's Refund balance per ADR-0004/0005; reject →
// NOT credited, reason recorded), plus the append-only audit_logs trail.
//
//   - APPROVE : a seeded pending refund_request → approve the full amount →
//               state credited; a wallet.credit_refund_balance audit row for
//               the Booking proves the Refund balance was credited (race-free
//               proof — the live balance row can be moved by other specs);
//               an admin.refund.approve audit row with the admin as actor.
//   - REJECT  : a SECOND seeded pending refund_request → reject with a reason →
//               state rejected; NO credit audit row for that Booking; the
//               reason persisted on the row + in an admin.refund.reject audit.
//
// Both fixtures are DEDICATED pending refund_requests owned by
// REFUND_QUEUE_CUSTOMER on DISTINCT Bookings (the one_active_refund_per_booking
// partial unique forbids two active requests on one Booking), so crediting
// THIS customer never disturbs #13–#15's u_seed_customer wallet determinism.
// Serial so the approve/reject pair claim distinct seeded fixtures in order.
// ---------------------------------------------------------------------------
test.describe('Admin refund queue (#24)', () => {
  test.describe.configure({ mode: 'serial' })

  test('approve: pending refund → credited to Customer Refund balance + audit row', async ({
    page,
  }) => {
    const pending = await getPendingRefundRequestsForCustomer(
      SEED_REFUND_QUEUE_CUSTOMER_ID,
    )
    expect(
      pending.length,
      'seed must provide a pending refund_request to approve',
    ).toBeGreaterThanOrEqual(1)
    const target = pending[0]

    // Pre-credit balance for the dedicated customer (race-free: only #24 ever
    // touches this customer's wallet, and this test runs before the credit).
    const balanceBefore = await getWalletBalanceRupees(
      SEED_REFUND_QUEUE_CUSTOMER_ID,
      'refund_balance',
    )

    await page.goto('/admin/refunds?status=pending')
    await expect(page.locator('h1')).toContainText('Refund requests')

    const row = page.locator(`tr[data-refund-request-id="${target.refundRequestId}"]`)
    await expect(row).toBeVisible()
    await expect(row).toContainText(REFUND_QUEUE_CUSTOMER_EMAIL)

    // Open the approve dialog and confirm the full requested amount.
    await row.getByRole('button', { name: 'Approve', exact: true }).click()
    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog.getByRole('heading', { name: 'Approve Refund' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Approve Refund' }).click()

    // After the server action + revalidation the credited row drops OUT of the
    // pending-filtered list.
    await expect(row).toHaveCount(0, { timeout: 15_000 })

    // ── Assert: persisted state is credited ──────────────────────────────
    await expect
      .poll(async () => (await getRefundRequestStateById(target.refundRequestId))?.state, {
        timeout: 15_000,
      })
      .toBe('credited')

    // ── Assert: the Refund balance was credited the full amount ──────────
    // The immutable wallet.credit_refund_balance audit row is the race-free
    // proof the credit landed in the Refund (cashable) bucket.
    const creditAudit = await getRefundBalanceCreditAuditForBooking(target.bookingId)
    expect(creditAudit, 'a refund-balance credit must have been written').not.toBeNull()
    expect(creditAudit!.amountRupees).toBe(target.amountRupees)
    expect(creditAudit!.userId).toBe(SEED_REFUND_QUEUE_CUSTOMER_ID)
    expect(creditAudit!.refundRequestId).toBe(target.refundRequestId)

    // The live balance row reflects the credit too (only #24 moves it).
    const balanceAfter = await getWalletBalanceRupees(
      SEED_REFUND_QUEUE_CUSTOMER_ID,
      'refund_balance',
    )
    expect(balanceAfter).toBe(balanceBefore + target.amountRupees)

    // ── Assert: exactly one approve audit row with actor + transition ────
    expect(
      await countRefundAuditRows('admin.refund.approve', target.refundRequestId),
    ).toBe(1)
    const audit = await getLatestRefundAudit('admin.refund.approve', target.refundRequestId)
    expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
    expect(audit!.payload).toMatchObject({
      previousState: 'pending',
      newState: 'credited',
      approvedAmountRupees: target.amountRupees,
      customerUserId: SEED_REFUND_QUEUE_CUSTOMER_ID,
    })

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-refund-approved.png',
      fullPage: true,
    })
  })

  test('reject: pending refund → rejected (NOT credited), reason recorded + audit row', async ({
    page,
  }) => {
    const pending = await getPendingRefundRequestsForCustomer(
      SEED_REFUND_QUEUE_CUSTOMER_ID,
    )
    expect(
      pending.length,
      'seed must provide a second pending refund_request to reject',
    ).toBeGreaterThanOrEqual(1)
    const target = pending[0]

    const balanceBefore = await getWalletBalanceRupees(
      SEED_REFUND_QUEUE_CUSTOMER_ID,
      'refund_balance',
    )

    const REJECT_REASON = `E2E: refund denied — outside policy, no exception ${Date.now()}`

    await page.goto('/admin/refunds?status=pending')
    const row = page.locator(`tr[data-refund-request-id="${target.refundRequestId}"]`)
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Reject', exact: true }).click()
    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog.getByRole('heading', { name: 'Reject Refund' })).toBeVisible()
    await dialog.locator('textarea').fill(REJECT_REASON)
    await dialog.getByRole('button', { name: 'Reject Refund' }).click()

    // Drops out of the pending-filtered list once rejected.
    await expect(row).toHaveCount(0, { timeout: 15_000 })

    // ── Assert: persisted state is rejected + reason recorded in notes ───
    await expect
      .poll(async () => (await getRefundRequestStateById(target.refundRequestId))?.state, {
        timeout: 15_000,
      })
      .toBe('rejected')
    const refund = await getRefundRequestStateById(target.refundRequestId)
    expect(refund!.notes).toBe(REJECT_REASON)
    expect(refund!.resolvedAt).not.toBeNull()

    // ── Assert: NOT credited — no refund-balance credit for this Booking ─
    expect(
      await getRefundBalanceCreditAuditForBooking(target.bookingId),
      'a rejected refund must NOT credit the Refund balance',
    ).toBeNull()
    const balanceAfter = await getWalletBalanceRupees(
      SEED_REFUND_QUEUE_CUSTOMER_ID,
      'refund_balance',
    )
    expect(balanceAfter).toBe(balanceBefore)

    // ── Assert: exactly one reject audit row with actor + reason ─────────
    expect(
      await countRefundAuditRows('admin.refund.reject', target.refundRequestId),
    ).toBe(1)
    const audit = await getLatestRefundAudit('admin.refund.reject', target.refundRequestId)
    expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
    expect(audit!.payload).toMatchObject({
      previousState: 'pending',
      newState: 'rejected',
      reason: REJECT_REASON,
    })
  })
})

// ---------------------------------------------------------------------------
// 16. Functional: admin payout queue + first-3 manual gate (#24, ADR-0016)
//
// Drives the three admin payout Server Actions FROM THE UI (approve / hold /
// reject) on a DEDICATED Identity-verified Vendor and asserts the persisted
// bookings.payout_state transitions, the ADR-0016 first-3-manual-approval gate
// (vendor_profiles.manual_payouts_remaining 3→2→1→0, auto thereafter), and the
// append-only audit_logs trail.
//
//   - FIRST-3 GATE : approve the vendor's first three pending Payouts in order
//                    → payout_state approved each, manual_payouts_remaining
//                    decrements 3→2→1→0. The 4th approval finds the gate OPEN
//                    (remaining already 0) → no further decrement (auto path).
//   - HOLD         : a pending Payout → held (Dispute pause); reason audited.
//   - REJECT       : a pending Payout → rejected; reason persisted + audited.
//
// The vendor + its six pending-payout Bookings are DEDICATED seed fixtures, so
// the one-way payout-state transitions + the gate decrement never disturb
// #20's u_seed_v_business payout sums or #22's u_seed_v_identity mutations.
// Serial so the gate decrement is asserted against a known approval order.
// ---------------------------------------------------------------------------
test.describe('Admin payout queue + first-3 manual gate (#24)', () => {
  test.describe.configure({ mode: 'serial' })

  test('first-3 gate: approve 3 → manual_payouts_remaining 3→2→1→0; 4th is auto', async ({
    page,
  }) => {
    const remainingBefore = await getVendorManualPayoutsRemaining(
      SEED_PAYOUT_QUEUE_VENDOR_ID,
    )
    expect(remainingBefore, 'seed payout vendor must start at the full manual gate').toBe(3)

    const pending = await getPendingPayoutBookingsForVendor(SEED_PAYOUT_QUEUE_VENDOR_ID)
    expect(
      pending.length,
      'seed must provide ≥4 pending Payouts to exercise the first-3 gate + auto',
    ).toBeGreaterThanOrEqual(4)

    // Approve the first FOUR in slot order; assert the gate decrements only on
    // the first three (3→2→1→0) and the 4th approval is auto (stays 0).
    const expectedRemainingAfter = [2, 1, 0, 0]
    for (let i = 0; i < 4; i++) {
      const target = pending[i]
      await page.goto('/admin/payouts')
      await expect(page.locator('h1')).toContainText('Payout queue')

      const row = page.locator(`tr[data-booking-id="${target.bookingId}"]`)
      await expect(row).toBeVisible()
      await row.getByRole('button', { name: 'Approve', exact: true }).click()

      // After the action + revalidation the row's actions cell flips to the
      // "Approved" badge (no more Approve button).
      await expect(row.getByText('Approved', { exact: true })).toBeVisible({
        timeout: 15_000,
      })

      // ── Assert: payout_state approved ──────────────────────────────────
      await expect
        .poll(async () => (await getBookingPayoutState(target.bookingId))?.payoutState, {
          timeout: 15_000,
        })
        .toBe('approved')

      // ── Assert: the gate decremented (or stayed 0 on the auto 4th) ──────
      await expect
        .poll(async () => getVendorManualPayoutsRemaining(SEED_PAYOUT_QUEUE_VENDOR_ID), {
          timeout: 15_000,
        })
        .toBe(expectedRemainingAfter[i])

      // ── Assert: approve audit row with actor + gate before/after ───────
      const audit = await getLatestPayoutAudit('admin.payout.approve', target.bookingId)
      expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
      expect(audit!.payload).toMatchObject({
        previousPayoutState: 'pending',
        newPayoutState: 'approved',
        manualPayoutsRemainingBefore: i < 3 ? 3 - i : 0,
        manualPayoutsRemainingAfter: expectedRemainingAfter[i],
      })
    }

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-payout-approved.png',
      fullPage: true,
    })
  })

  test('hold: pending Payout → held (Dispute pause) + audit row', async ({ page }) => {
    const pending = await getPendingPayoutBookingsForVendor(SEED_PAYOUT_QUEUE_VENDOR_ID)
    const target = pending.find((p) => p.payoutState === 'pending')
    expect(target, 'seed must leave a pending Payout to hold').toBeTruthy()

    const HOLD_REASON = `E2E: payout held pending Dispute review ${Date.now()}`

    await page.goto('/admin/payouts')
    const row = page.locator(`tr[data-booking-id="${target!.bookingId}"]`)
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Hold', exact: true }).click()

    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog.getByRole('heading', { name: 'Hold Payout' })).toBeVisible()
    await dialog.locator('textarea').fill(HOLD_REASON)
    await dialog.getByRole('button', { name: 'Hold Payout' }).click()

    // After revalidation the held row shows the "Held" badge.
    await expect(row.getByText('Held', { exact: true })).toBeVisible({ timeout: 15_000 })

    // ── Assert: payout_state held ────────────────────────────────────────
    await expect
      .poll(async () => (await getBookingPayoutState(target!.bookingId))?.payoutState, {
        timeout: 15_000,
      })
      .toBe('held')

    // ── Assert: hold audit row with actor + reason ───────────────────────
    expect(
      await countPayoutAuditRows('admin.payout.hold', target!.bookingId),
    ).toBe(1)
    const audit = await getLatestPayoutAudit('admin.payout.hold', target!.bookingId)
    expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
    expect(audit!.payload).toMatchObject({
      previousPayoutState: 'pending',
      newPayoutState: 'held',
      reason: HOLD_REASON,
    })
  })

  test('reject: pending Payout → rejected, reason recorded + audit row', async ({ page }) => {
    const pending = await getPendingPayoutBookingsForVendor(SEED_PAYOUT_QUEUE_VENDOR_ID)
    const target = pending.find((p) => p.payoutState === 'pending')
    expect(target, 'seed must leave a pending Payout to reject').toBeTruthy()

    const REJECT_REASON = `E2E: payout rejected — Vendor account flagged ${Date.now()}`

    await page.goto('/admin/payouts')
    const row = page.locator(`tr[data-booking-id="${target!.bookingId}"]`)
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Reject', exact: true }).click()

    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog.getByText('Reject Payout')).toBeVisible()
    await dialog.locator('textarea').fill(REJECT_REASON)
    await dialog.getByRole('button', { name: 'Reject', exact: true }).click()

    // After revalidation the rejected row shows the "Rejected" badge.
    await expect(row.getByText('Rejected', { exact: true })).toBeVisible({ timeout: 15_000 })

    // ── Assert: payout_state rejected + reason persisted ─────────────────
    await expect
      .poll(async () => (await getBookingPayoutState(target!.bookingId))?.payoutState, {
        timeout: 15_000,
      })
      .toBe('rejected')
    const after = await getBookingPayoutState(target!.bookingId)
    expect(after!.payoutRejectionReason).toBe(REJECT_REASON)

    // ── Assert: reject audit row with actor + reason ─────────────────────
    expect(
      await countPayoutAuditRows('admin.payout.reject', target!.bookingId),
    ).toBe(1)
    const audit = await getLatestPayoutAudit('admin.payout.reject', target!.bookingId)
    expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
    expect(audit!.payload).toMatchObject({
      previousPayoutState: 'pending',
      newPayoutState: 'rejected',
      reason: REJECT_REASON,
    })

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-payout-rejected.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 17. Functional: admin dispute resolution (#25, ADR-0003)
//
// Drives the two admin dispute Server Actions FROM THE UI on dedicated staged
// disputed Bookings and asserts the persisted bookings.state + payout_state
// transitions, the optional partial / full refund credited to the Customer's
// Refund balance, and the append-only audit_logs trail.
//
//   - COMPLETION : disputed → completed (Vendor's favour). Payout resumes
//                  (held → pending). Optional partial refund credited to the
//                  Customer's Refund balance + commission adjustment recorded
//                  in the audit. (ADR-0003)
//   - CANCEL POST-EXPERIENCE : disputed → cancelled_post_experience (Customer
//                  wins). Full refund to the Customer's Refund balance, NO
//                  Payout (held → rejected), Commission effectively zero.
//
// Each test stages its own disputed Booking on a fresh past slot (distinct UTC
// hour so the two never collide) and removes it in a finally, so the seed's
// single disputed Booking (#19) and all parallel specs are undisturbed. Serial
// so the dispute-queue row counts stay deterministic across the two tests.
// ---------------------------------------------------------------------------
test.describe('Admin dispute resolution (#25)', () => {
  test.describe.configure({ mode: 'serial' })

  test('resolve as Completion: disputed → completed, partial refund + commission adjust, payout resumes (held → pending) + audit row', async ({
    page,
  }) => {
    const exp = await getExperienceSlugRegion(DISPUTE_EXPERIENCE_SLUG)
    expect(exp, 'seed Experience for the dispute fixture must exist').not.toBeNull()

    const GROSS = 9000
    const PARTIAL_REFUND = 2000
    const ADJUSTED_RATE = '10.00'
    const fixture = await insertDisputedBookingFixture({
      experienceId: exp!.id,
      customerUserId: SEED_DISPUTE_CUSTOMER_ID,
      grossRupees: GROSS,
      participantCount: 2,
      slotHourUtc: 11,
    })

    try {
      const NOTES = `E2E: resolved in Vendor favour — partial goodwill refund ${Date.now()}`

      await page.goto('/admin/disputes')
      await expect(page.locator('h1')).toContainText('Dispute queue')

      // Target THIS staged disputed Booking's row deterministically.
      const row = page.locator(`tr[data-booking-id="${fixture.bookingId}"]`)
      await expect(row).toBeVisible()

      // Open the "Complete" dialog, supply notes + a partial refund + an
      // adjusted commission rate, then resolve.
      await row.getByRole('button', { name: 'Complete', exact: true }).click()
      const dialog = page.locator('[data-slot="dialog-content"]')
      await expect(dialog.getByRole('heading', { name: 'Resolve as Completed' })).toBeVisible()
      await dialog.locator('#complete-notes').fill(NOTES)
      await dialog.locator('#partial-refund').fill(String(PARTIAL_REFUND))
      await dialog.locator('#adjusted-rate').fill(ADJUSTED_RATE)
      await dialog.getByRole('button', { name: 'Resolve as Completed' }).click()

      // After the server action + revalidation the resolved row drops OUT of
      // the disputed-only queue.
      await expect(row).toHaveCount(0, { timeout: 15_000 })

      // ── Assert: booking state completed + payout resumed (held → pending) ─
      await expect
        .poll(async () => (await getBookingLifecycle(fixture.bookingId))?.state, {
          timeout: 15_000,
        })
        .toBe('completed')
      const lifecycle = await getBookingLifecycle(fixture.bookingId)
      expect(lifecycle!.payoutState).toBe('pending')
      expect(lifecycle!.completedAt).not.toBeNull()

      // ── Assert: the partial refund was credited to the Refund balance ────
      const creditAudit = await getRefundBalanceCreditAuditForBooking(fixture.bookingId)
      expect(creditAudit, 'a partial-refund credit must have been written').not.toBeNull()
      expect(creditAudit!.amountRupees).toBe(PARTIAL_REFUND)
      expect(creditAudit!.userId).toBe(SEED_DISPUTE_CUSTOMER_ID)

      // A refund_request row records the goodwill refund (credited, refund_balance).
      const refundReq = await getRefundRequestForBooking(fixture.bookingId)
      expect(refundReq!.state).toBe('credited')
      expect(refundReq!.destination).toBe('refund_balance')
      expect(refundReq!.amount).toBe(PARTIAL_REFUND)
      expect(refundReq!.reason).toBe('outside_policy_dispute_resolved')

      // ── Assert: exactly one resolve-complete audit row, actor + adjustment ─
      expect(
        await countDisputeAuditRows('booking.dispute_resolved_complete', fixture.bookingId),
      ).toBe(1)
      const audit = await getLatestDisputeAudit(
        'booking.dispute_resolved_complete',
        fixture.bookingId,
      )
      expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
      expect(audit!.payload).toMatchObject({
        previousState: 'disputed',
        newState: 'completed',
        partialRefundRupees: PARTIAL_REFUND,
        adjustedCommissionRate: ADJUSTED_RATE,
        payoutStateChange: 'held → pending',
      })

      await page.screenshot({
        path: 'tests/e2e/screenshots/admin-dispute-completed.png',
        fullPage: true,
      })
    } finally {
      await deleteDisputedBookingFixture(fixture)
    }
  })

  test('resolve as cancelled_post_experience: disputed → cancelled, full refund, no commission, no payout (held → rejected) + audit row', async ({
    page,
  }) => {
    const exp = await getExperienceSlugRegion(DISPUTE_EXPERIENCE_SLUG)
    expect(exp, 'seed Experience for the dispute fixture must exist').not.toBeNull()

    const GROSS = 7000
    const fixture = await insertDisputedBookingFixture({
      experienceId: exp!.id,
      customerUserId: SEED_DISPUTE_CUSTOMER_ID,
      grossRupees: GROSS,
      participantCount: 2,
      slotHourUtc: 13,
    })

    try {
      const NOTES = `E2E: resolved for Customer — experience not delivered ${Date.now()}`

      await page.goto('/admin/disputes')
      const row = page.locator(`tr[data-booking-id="${fixture.bookingId}"]`)
      await expect(row).toBeVisible()

      // Open the "Cancel & Refund" dialog, supply notes, full-refund resolve.
      await row.getByRole('button', { name: 'Cancel & Refund' }).click()
      const dialog = page.locator('[data-slot="dialog-content"]')
      await expect(dialog.getByRole('heading', { name: 'Cancel Post-Experience' })).toBeVisible()
      await dialog.locator('#cancel-notes').fill(NOTES)
      await dialog.getByRole('button', { name: 'Cancel & Full Refund' }).click()

      // Drops OUT of the disputed-only queue once resolved.
      await expect(row).toHaveCount(0, { timeout: 15_000 })

      // ── Assert: booking state cancelled_post_experience; payout rejected ──
      await expect
        .poll(async () => (await getBookingLifecycle(fixture.bookingId))?.state, {
          timeout: 15_000,
        })
        .toBe('cancelled_post_experience')
      const lifecycle = await getBookingLifecycle(fixture.bookingId)
      expect(lifecycle!.payoutState).toBe('rejected')
      expect(lifecycle!.cancelledAt).not.toBeNull()
      expect(lifecycle!.cancellationReason).toBe(NOTES)

      // ── Assert: the FULL gross was credited to the Refund balance ────────
      const creditAudit = await getRefundBalanceCreditAuditForBooking(fixture.bookingId)
      expect(creditAudit, 'a full-refund credit must have been written').not.toBeNull()
      expect(creditAudit!.amountRupees).toBe(GROSS)
      expect(creditAudit!.userId).toBe(SEED_DISPUTE_CUSTOMER_ID)

      const refundReq = await getRefundRequestForBooking(fixture.bookingId)
      expect(refundReq!.state).toBe('credited')
      expect(refundReq!.destination).toBe('refund_balance')
      expect(refundReq!.amount).toBe(GROSS)

      // ── Assert: exactly one resolve-cancel audit row; commission zero ────
      expect(
        await countDisputeAuditRows('booking.dispute_resolved_cancel', fixture.bookingId),
      ).toBe(1)
      const audit = await getLatestDisputeAudit(
        'booking.dispute_resolved_cancel',
        fixture.bookingId,
      )
      expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
      expect(audit!.payload).toMatchObject({
        previousState: 'disputed',
        newState: 'cancelled_post_experience',
        refundAmountRupees: GROSS,
        commissionEffectivelyZero: true,
        payoutStateChange: 'held → rejected',
      })

      await page.screenshot({
        path: 'tests/e2e/screenshots/admin-dispute-cancelled.png',
        fullPage: true,
      })
    } finally {
      await deleteDisputedBookingFixture(fixture)
    }
  })
})

// ---------------------------------------------------------------------------
// 18. Functional: admin region-closure create / delete (#25, ADR-0011)
//
// Drives the two admin region-closure Server Actions FROM THE UI
// (createClosureAction / deleteClosureAction) and asserts the persisted
// region_closures row, the inline customer-facing block (the Experience detail
// page surfaces the closure and DISABLES Book-now per ADR-0011), and that a
// delete RESTORES the bookable state. Also asserts the create + delete
// audit_logs trail.
//
// The closure targets the bir-billing region (DISPUTE_EXPERIENCE_SLUG's
// region) over a window covering "now", so the Experience detail page enters
// the closed state immediately. A unique reason stamp resolves the UI-created
// row deterministically; the test deletes it via the UI (and force-cleans in a
// finally) so it leaves no residue for parallel specs.
// ---------------------------------------------------------------------------
test.describe('Admin region-closure create/delete (#25)', () => {
  test('create blocks booking inline on the Experience page; delete restores it + audit rows', async ({
    page,
  }) => {
    const exp = await getExperienceSlugRegion(DISPUTE_EXPERIENCE_SLUG)
    expect(exp, 'seed Experience for the closure test must exist').not.toBeNull()
    const region = exp!.regionSlug

    const REASON = `E2E closure: maintenance window — reopens soon ${Date.now()}`
    // A window that brackets "now" (start yesterday, end +60d) so the
    // Experience detail page enters the closed state immediately and the
    // closure overlaps the materialiser's 90-day booking window.
    const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    const endDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)

    let createdClosureId: string | null = null

    try {
      // ── Pre-condition: the Experience page is bookable (Book-now enabled) ─
      await page.goto(`/experience/${DISPUTE_EXPERIENCE_SLUG}`)
      await expect(
        page.getByRole('link', { name: 'Book now' }),
        'Experience must be bookable before the closure',
      ).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Currently closed')).toHaveCount(0)

      // ── Create the closure via the admin UI ──────────────────────────────
      await page.goto('/admin/region-closures')
      await expect(page.locator('h1')).toContainText('Region Closures')

      await page.getByRole('button', { name: 'Add Closure' }).click()
      const createDialog = page.locator('[data-slot="dialog-content"]')
      await expect(createDialog.getByRole('heading', { name: 'Create Region Closure' })).toBeVisible()
      await createDialog.locator('#region-slug').fill(region)
      await createDialog.locator('#start-date').fill(startDate)
      await createDialog.locator('#end-date').fill(endDate)
      await createDialog.locator('#reason').fill(REASON)
      await createDialog.getByRole('button', { name: 'Create', exact: true }).click()

      // The new closure row appears in the table (region cell).
      await expect(
        page.locator('tr', { hasText: REASON }),
      ).toBeVisible({ timeout: 15_000 })

      // ── Assert: the closure persisted to region_closures (source 'admin') ─
      const closure = await getRegionClosureByReason(region, REASON)
      expect(closure, 'the UI-created closure must persist').not.toBeNull()
      createdClosureId = closure!.id
      expect(closure!.regionSlug).toBe(region)
      expect(closure!.source).toBe('admin')

      // ── Assert: exactly one create audit row with actor + window ─────────
      const createAudit = await getLatestClosureAudit(
        'admin.region_closure.create',
        createdClosureId,
      )
      expect(createAudit!.actorUserId).toBe(SEED_ADMIN_ID)
      expect(createAudit!.payload).toMatchObject({ regionSlug: region, reason: REASON })

      // ── Assert: booking is BLOCKED inline on the Experience page ─────────
      // (ADR-0011 — the closure is surfaced inline and Book-now is disabled.)
      await page.goto(`/experience/${DISPUTE_EXPERIENCE_SLUG}`)
      await expect(page.getByText('Currently closed')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(REASON)).toBeVisible()
      // The Book-now link is gone — replaced by a disabled button.
      await expect(page.getByRole('link', { name: 'Book now' })).toHaveCount(0)
      const disabledBook = page.getByRole('button', { name: 'Book now' })
      await expect(disabledBook).toBeVisible()
      await expect(disabledBook).toBeDisabled()

      await page.screenshot({
        path: 'tests/e2e/screenshots/admin-region-closure-blocked.png',
        fullPage: true,
      })

      // ── Delete the closure via the admin UI ──────────────────────────────
      await page.goto('/admin/region-closures')
      const closureRow = page.locator('tr', { hasText: REASON })
      await expect(closureRow).toBeVisible()
      await closureRow.getByRole('button', { name: 'Delete', exact: true }).click()
      const deleteDialog = page.locator('[data-slot="dialog-content"]')
      await expect(deleteDialog.getByRole('heading', { name: 'Delete Region Closure' })).toBeVisible()
      await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click()

      // The row drops out of the table.
      await expect(closureRow).toHaveCount(0, { timeout: 15_000 })

      // ── Assert: the closure row is gone from the DB ──────────────────────
      await expect
        .poll(async () => await getRegionClosureById(createdClosureId!), { timeout: 15_000 })
        .toBeNull()

      // ── Assert: exactly one delete audit row with actor ──────────────────
      const deleteAudit = await getLatestClosureAudit(
        'admin.region_closure.delete',
        createdClosureId,
      )
      expect(deleteAudit!.actorUserId).toBe(SEED_ADMIN_ID)
      expect(deleteAudit!.payload).toMatchObject({ regionSlug: region })

      // ── Assert: the Experience page is bookable AGAIN (closure restored) ─
      await page.goto(`/experience/${DISPUTE_EXPERIENCE_SLUG}`)
      await expect(
        page.getByRole('link', { name: 'Book now' }),
        'deleting the closure must restore the bookable state',
      ).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Currently closed')).toHaveCount(0)
      createdClosureId = null
    } finally {
      // Force-clean in case an assertion failed before the UI delete landed.
      if (createdClosureId) {
        const stale = await getRegionClosureById(createdClosureId)
        if (stale) {
          const { deleteRegionClosure } = await import('../../helpers/db-assertions')
          await deleteRegionClosure(createdClosureId)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 19. Functional: admin commission-tier CRUD + scope count (#26, ADR-0008)
//
// Drives the commission-tier CRUD Server Actions FROM THE UI (create / edit /
// delete) and the scope-filtered getAffectedBookingCount surfaced in the table
// (the #34 fix), asserting BOTH the persisted commission_tiers row AND the
// append-only audit_logs trail.
//
//   - CREATE : a Festival tier with a fixed Sept-2026 window SCOPED to the
//              dedicated COMMISSION_SCOPE Experience → persists (name, window,
//              rate, scope arrays). The table's affected-Booking count for the
//              new tier equals the scope-filtered DB count = the seeded 3
//              in-window Bookings (the August control is excluded → proves the
//              count honours the window AND the scope, ADR-0008 / #34).
//   - EDIT   : change the rate + reason → persists.
//   - DELETE : remove the tier → row gone from the DB.
//
// The tier is created freshly in-test (unique name stamp) and removed in a
// finally, so it never disturbs other specs. The scope fixture (dedicated
// Experience + 3 in-window + 1 control Bookings) is seeded deterministically;
// no other spec books on that fixture Experience. Serial so the create→edit→
// delete chain runs against a known single tier.
// ---------------------------------------------------------------------------
test.describe('Admin commission-tier CRUD + scope count (#26)', () => {
  test.describe.configure({ mode: 'serial' })

  const TIER_NAME = `e2e-festival-${Date.now()}`
  let tierId: string | null = null

  test.afterAll(async () => {
    // Force-clean the tier in case an assertion aborted before the UI delete.
    if (tierId) {
      const stale = await getCommissionTierById(tierId)
      if (stale) await deleteCommissionTierById(tierId)
    }
  })

  test('create Festival tier (window + Experience scope) persists + scope-filtered count + audit', async ({
    page,
  }) => {
    const scopeExperienceId = await getExperienceIdBySlug(SEED_COMMISSION_SCOPE_SLUG)
    expect(
      scopeExperienceId,
      `seed commission-scope Experience ${SEED_COMMISSION_SCOPE_SLUG} must exist`,
    ).not.toBeNull()

    // The independent DB count of in-window Bookings on the scope Experience.
    const expectedCount = await countBookingsInWindowForExperience(
      scopeExperienceId!,
      new Date(COMMISSION_SCOPE_WINDOW_START_ISO),
      new Date(COMMISSION_SCOPE_WINDOW_END_ISO),
    )
    expect(
      expectedCount,
      'seed must place exactly COMMISSION_SCOPE_IN_WINDOW Bookings inside the window',
    ).toBe(COMMISSION_SCOPE_IN_WINDOW)

    await page.goto('/admin/commission')
    await expect(page.locator('h1')).toContainText('Commission Tiers')

    // Fill the Create Festival Tier form: a Sept-2026 window scoped to the
    // dedicated fixture Experience (so the count discriminates on scope).
    await page.locator('#name').fill(TIER_NAME)
    await page.locator('#rateOverride').fill('12.5')
    await page.locator('#startAt').fill(COMMISSION_SCOPE_WINDOW_START_FILL)
    await page.locator('#endAt').fill(COMMISSION_SCOPE_WINDOW_END_FILL)
    await page.locator('#appliesToExperienceIds').fill(scopeExperienceId!)
    await page.locator('#reason').fill('E2E festival-season commission override (#26)')
    await page.getByRole('button', { name: 'Create Commission Tier' }).click()

    await expect(page.getByText('Commission tier created.')).toBeVisible({ timeout: 15_000 })

    // ── Assert: the tier persisted with window + scope ───────────────────
    const tier = await getCommissionTierByName(TIER_NAME)
    expect(tier, 'the UI-created Festival tier must persist').not.toBeNull()
    tierId = tier!.id
    expect(Number(tier!.rateOverride)).toBe(12.5)
    expect(tier!.appliesToExperienceIds).toEqual([scopeExperienceId])
    expect(tier!.appliesToCategories).toEqual([])
    expect(tier!.appliesToVendorIds).toEqual([])

    // ── Assert: exactly one create audit row with actor + window ─────────
    expect(
      await countCommissionTierAuditRows('admin.commission_tier.create', tierId!),
    ).toBe(1)
    const createAudit = await getLatestCommissionTierAudit(
      'admin.commission_tier.create',
      tierId!,
    )
    expect(createAudit!.actorUserId).toBe(SEED_ADMIN_ID)
    expect(createAudit!.payload).toMatchObject({ name: TIER_NAME, rateOverride: 12.5 })

    // ── Assert: the table surfaces the SCOPE-FILTERED affected count ─────
    // The Sept-2026 window is in the future → the tier is "Upcoming". Read its
    // row's affected-Booking count cell and assert it equals the scope-filtered
    // DB count (3 in-window; the August control is excluded — proves window +
    // scope, ADR-0008 / #34).
    await page.goto('/admin/commission')
    await page.getByRole('tab', { name: /Upcoming/ }).click()
    const row = page.locator(`tr[data-tier-id="${tierId}"]`)
    await expect(row).toBeVisible({ timeout: 15_000 })
    const countCell = row.locator('[data-affected-count]')
    await expect(countCell).toHaveText(String(expectedCount))
    await expect(countCell).toHaveAttribute('data-affected-count', String(expectedCount))

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-commission-tier-created.png',
      fullPage: true,
    })
  })

  test('edit Festival tier: rate + reason update persists + audit', async ({ page }) => {
    expect(tierId, 'create test must have produced a tier id').not.toBeNull()
    const NEW_REASON = `E2E edited reason ${Date.now()}`

    await page.goto('/admin/commission')
    await page.getByRole('tab', { name: /Upcoming/ }).click()
    const row = page.locator(`tr[data-tier-id="${tierId}"]`)
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByRole('button', { name: 'Edit' }).click()

    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog.getByText('Edit Commission Tier')).toBeVisible()
    await dialog.locator(`#edit-rate-${tierId}`).fill('17.5')
    await dialog.locator(`#edit-reason-${tierId}`).fill(NEW_REASON)
    await dialog.getByRole('button', { name: 'Save Changes' }).click()

    // The dialog closes on a successful save.
    await expect(dialog.getByText('Edit Commission Tier')).not.toBeVisible({
      timeout: 15_000,
    })

    // ── Assert: the rate + reason persisted ──────────────────────────────
    await expect
      .poll(async () => (await getCommissionTierById(tierId!))?.rateOverride, {
        timeout: 15_000,
      })
      .toBe('17.50')
    const updated = await getCommissionTierById(tierId!)
    expect(updated!.reason).toBe(NEW_REASON)
    // The window + scope are untouched by a rate/reason edit.
    expect(updated!.appliesToExperienceIds).toHaveLength(1)

    // ── Assert: an update audit row with actor ───────────────────────────
    expect(
      await countCommissionTierAuditRows('admin.commission_tier.update', tierId!),
    ).toBe(1)
    const updateAudit = await getLatestCommissionTierAudit(
      'admin.commission_tier.update',
      tierId!,
    )
    expect(updateAudit!.actorUserId).toBe(SEED_ADMIN_ID)
  })

  test('delete Festival tier: removed from the DB + audit', async ({ page }) => {
    expect(tierId, 'create test must have produced a tier id').not.toBeNull()

    await page.goto('/admin/commission')
    await page.getByRole('tab', { name: /Upcoming/ }).click()
    const row = page.locator(`tr[data-tier-id="${tierId}"]`)
    await expect(row).toBeVisible({ timeout: 15_000 })

    // The delete button confirms via window.confirm — auto-accept it.
    page.once('dialog', (dialog) => dialog.accept())
    await row.getByRole('button', { name: 'Delete' }).click()

    // After the action + revalidation the deleted row drops out of the table.
    await expect(row).toHaveCount(0, { timeout: 15_000 })

    // ── Assert: the tier row is gone from the DB ─────────────────────────
    await expect
      .poll(async () => await getCommissionTierById(tierId!), { timeout: 15_000 })
      .toBeNull()

    // ── Assert: a delete audit row with actor ────────────────────────────
    expect(
      await countCommissionTierAuditRows('admin.commission_tier.delete', tierId!),
    ).toBe(1)
    const deleteAudit = await getLatestCommissionTierAudit(
      'admin.commission_tier.delete',
      tierId!,
    )
    expect(deleteAudit!.actorUserId).toBe(SEED_ADMIN_ID)
    tierId = null
  })
})

// ---------------------------------------------------------------------------
// 20. Functional: admin promo CRUD (#26, ADR-0004)
//
// Drives the promo Server Actions FROM THE UI (create percent-style credit
// amount + flat, toggle active/inactive, delete) and asserts the persisted
// promo_codes rows + the append-only audit_logs trail.
//
//   - CREATE  : two promos — one with an expiry, one without → persist with the
//               right credit amount, active flag, and expiry.
//   - TOGGLE  : deactivate then reactivate one → active flag flips, audited.
//   - DELETE  : remove a 0-use promo → row gone from the DB.
//
// Both promos are created freshly in-test (unique code stamps) and removed in a
// finally, so they never disturb other specs. Serial so the create→toggle→
// delete chain runs against known rows.
// ---------------------------------------------------------------------------
test.describe('Admin promo CRUD (#26)', () => {
  test.describe.configure({ mode: 'serial' })

  const PROMO_FLAT = `E2EFLAT${Date.now()}`
  const PROMO_EXPIRY = `E2EEXP${Date.now()}`
  let flatId: string | null = null
  let expiryId: string | null = null

  test.afterAll(async () => {
    for (const id of [flatId, expiryId]) {
      if (id) {
        const stale = await getPromoCodeById(id)
        if (stale) await deletePromoCodeById(id)
      }
    }
  })

  test('create: a flat promo + an expiring promo persist with the right credit + expiry', async ({
    page,
  }) => {
    await page.goto('/admin/promo')
    await expect(page.locator('h1')).toContainText('Promo Codes')

    // ── Promo 1: a flat ₹500 credit, no expiry ───────────────────────────
    await page.locator('#code').fill(PROMO_FLAT)
    await page.locator('#creditAmount').fill('500')
    await page.getByRole('button', { name: 'Create Promo Code' }).click()
    await expect(page.getByText('Promo code created.')).toBeVisible({ timeout: 15_000 })

    const flat = await getPromoCodeByCode(PROMO_FLAT)
    expect(flat, 'the flat promo must persist').not.toBeNull()
    flatId = flat!.id
    expect(flat!.creditAmountRupees).toBe(500)
    expect(flat!.active).toBe(true)
    expect(flat!.expiresAt).toBeNull()
    expect(flat!.currentUses).toBe(0)

    // ── Assert: a create audit row (entity_id = the code) ────────────────
    expect(await countPromoAuditRows('admin.promo_code.create', PROMO_FLAT)).toBe(1)

    // ── Promo 2: a ₹1000 credit WITH an expiry ───────────────────────────
    await page.goto('/admin/promo')
    await page.locator('#code').fill(PROMO_EXPIRY)
    await page.locator('#creditAmount').fill('1000')
    await page.locator('#expiresAt').fill('2027-12-31T23:59')
    await page.getByRole('button', { name: 'Create Promo Code' }).click()
    await expect(page.getByText('Promo code created.')).toBeVisible({ timeout: 15_000 })

    const expiring = await getPromoCodeByCode(PROMO_EXPIRY)
    expect(expiring, 'the expiring promo must persist').not.toBeNull()
    expiryId = expiring!.id
    expect(expiring!.creditAmountRupees).toBe(1000)
    expect(expiring!.expiresAt, 'the expiry must persist').not.toBeNull()
    expect(expiring!.expiresAt!.getUTCFullYear()).toBe(2027)

    await page.screenshot({
      path: 'tests/e2e/screenshots/admin-promo-created.png',
      fullPage: true,
    })
  })

  test('toggle: deactivate then reactivate the flat promo + audit', async ({ page }) => {
    expect(flatId, 'create test must have produced a flat promo id').not.toBeNull()

    await page.goto('/admin/promo')
    const row = page.locator('tr').filter({ hasText: PROMO_FLAT })
    await expect(row).toBeVisible()

    // ── Deactivate ───────────────────────────────────────────────────────
    await row.getByRole('button', { name: 'Deactivate' }).click()
    await expect
      .poll(async () => (await getPromoCodeById(flatId!))?.active, { timeout: 15_000 })
      .toBe(false)
    expect(await countPromoAuditRows('admin.promo_code.deactivate', flatId!)).toBe(1)

    // ── Reactivate (the button now reads "Activate") ─────────────────────
    const refreshedRow = page.locator('tr').filter({ hasText: PROMO_FLAT })
    await expect(refreshedRow.getByRole('button', { name: 'Activate' })).toBeVisible({
      timeout: 15_000,
    })
    await refreshedRow.getByRole('button', { name: 'Activate' }).click()
    await expect
      .poll(async () => (await getPromoCodeById(flatId!))?.active, { timeout: 15_000 })
      .toBe(true)
    expect(await countPromoAuditRows('admin.promo_code.activate', flatId!)).toBe(1)
  })

  test('delete: a 0-use promo is removed from the DB + audit', async ({ page }) => {
    expect(expiryId, 'create test must have produced an expiring promo id').not.toBeNull()

    await page.goto('/admin/promo')
    const row = page.locator('tr').filter({ hasText: PROMO_EXPIRY })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Delete' }).click()

    // After the action + revalidation the deleted row drops out of the table.
    await expect(row).toHaveCount(0, { timeout: 15_000 })

    // ── Assert: the promo row is gone from the DB ────────────────────────
    await expect
      .poll(async () => await getPromoCodeById(expiryId!), { timeout: 15_000 })
      .toBeNull()
    expect(await countPromoAuditRows('admin.promo_code.delete', expiryId!)).toBe(1)
    expiryId = null
  })
})

// ---------------------------------------------------------------------------
// 21. Functional: admin loyalty grant — Outvers credit bucket + expiry (#26)
//
// Drives the manual loyalty grant Server Action (adminGrantCredit) FROM THE UI
// and asserts the grant lands in the CORRECT wallet bucket per ADR-0004:
//
//   - OUTVERS CREDIT : a grant of Outvers credit creates an admin-source
//                      wallet_transactions row in the outvers_credit bucket
//                      (NOT refund_balance) WITH an expires_at 12–18 months out
//                      (ADR-0004 — closed-loop promo credit expires), the
//                      aggregate outvers_credit balance increments by the
//                      amount, the Refund balance is UNTOUCHED, and a
//                      wallet.grant_credit audit row records the admin actor +
//                      the expiry.
//
// The grant targets a DEDICATED Customer (u_seed_customer_loyalty) so crediting
// it never disturbs #13–#15's u_seed_customer two-bucket wallet determinism.
// The customer's wallet is cleared in a finally so the grant leaves no residue.
// ---------------------------------------------------------------------------
test.describe('Admin loyalty grant — Outvers credit bucket + expiry (#26)', () => {
  test('grant Outvers credit → outvers_credit bucket WITH expiry, NOT Refund balance + audit', async ({
    page,
  }) => {
    const GRANT_RUPEES = 750
    const outversBefore = await getWalletBalanceRupees(
      SEED_LOYALTY_CUSTOMER_ID,
      'outvers_credit',
    )
    const refundBefore = await getWalletBalanceRupees(
      SEED_LOYALTY_CUSTOMER_ID,
      'refund_balance',
    )

    try {
      await page.goto('/admin/loyalty')
      await expect(page.locator('h1')).toContainText('Loyalty & Credits')

      // Fill the Manual Credit Grant form: Outvers credit to the dedicated
      // loyalty Customer.
      await page.locator('#userId').fill(SEED_LOYALTY_CUSTOMER_ID)
      await page.locator('#amountRupees').fill(String(GRANT_RUPEES))
      await page.selectOption('#balanceType', 'outvers_credit')
      await page.locator('#reason').fill(`E2E goodwill loyalty grant ${Date.now()}`)
      await page.getByRole('button', { name: 'Grant Credit' }).click()

      // Inline success state surfaces the new wallet_transaction id.
      await expect(page.getByText(/Credit granted\. Transaction:/)).toBeVisible({
        timeout: 15_000,
      })

      // ── Assert: an admin-source outvers_credit ledger row WITH expiry ────
      const outversTxns = await getWalletTransactions(
        SEED_LOYALTY_CUSTOMER_ID,
        'outvers_credit',
        'admin',
      )
      expect(outversTxns.length, 'one admin Outvers-credit grant must exist').toBe(1)
      const txn = outversTxns[0]
      expect(txn.amountRupees).toBe(GRANT_RUPEES)
      // ── ADR-0004: Outvers credit MUST carry an expiry 12–18 months out ──
      expect(txn.expiresAt, 'Outvers credit grant must have an expiry (ADR-0004)').not.toBeNull()
      const monthsOut =
        (txn.expiresAt!.getTime() - txn.createdAt.getTime()) /
        (1000 * 60 * 60 * 24 * 30)
      expect(monthsOut).toBeGreaterThanOrEqual(11.5)
      expect(monthsOut).toBeLessThanOrEqual(18.5)

      // ── Assert: the Outvers credit aggregate incremented by the amount ──
      const outversAfter = await getWalletBalanceRupees(
        SEED_LOYALTY_CUSTOMER_ID,
        'outvers_credit',
      )
      expect(outversAfter).toBe(outversBefore + GRANT_RUPEES)

      // ── Assert: the Refund balance bucket is UNTOUCHED ──────────────────
      const refundAfter = await getWalletBalanceRupees(
        SEED_LOYALTY_CUSTOMER_ID,
        'refund_balance',
      )
      expect(refundAfter).toBe(refundBefore)
      const refundTxns = await getWalletTransactions(
        SEED_LOYALTY_CUSTOMER_ID,
        'refund_balance',
      )
      expect(refundTxns, 'no refund-balance row may be written by an Outvers grant').toHaveLength(0)

      // ── Assert: a wallet.grant_credit audit row with actor + expiry ─────
      const audit = await getWalletGrantAudit(txn.id)
      expect(audit, 'a wallet.grant_credit audit row must exist').not.toBeNull()
      expect(audit!.actorUserId).toBe(SEED_ADMIN_ID)
      expect(audit!.payload).toMatchObject({
        userId: SEED_LOYALTY_CUSTOMER_ID,
        amountRupees: GRANT_RUPEES,
        balanceType: 'outvers_credit',
        source: 'admin',
      })
      expect(audit!.payload.expiresAt, 'the audit must record the expiry').not.toBeNull()

      // The granted Customer's email surfaces in the balances table.
      await page.goto('/admin/loyalty')
      await expect(page.getByText(SEED_LOYALTY_CUSTOMER_EMAIL).first()).toBeVisible({
        timeout: 15_000,
      })

      await page.screenshot({
        path: 'tests/e2e/screenshots/admin-loyalty-grant.png',
        fullPage: true,
      })
    } finally {
      // Clear the dedicated Customer's wallet so the grant leaves no residue.
      await clearWalletForUser(SEED_LOYALTY_CUSTOMER_ID)
    }
  })
})
