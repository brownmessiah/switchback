/**
 * E2E tests for authenticated vendor dashboard flows.
 *
 * Covers: onboarding redirect, listings CRUD, availability management,
 * bookings/payouts/reviews/messages/settings smoke checks.
 *
 * Uses the DevTools fixture for automatic console-error, uncaught-exception,
 * network-failure, and axe-core accessibility checks after each test.
 *
 * Authenticated via `tests/e2e/.auth/vendor-storage.json` (injected by
 * the global setup project — seed user `u_seed_v_business`, business-verified).
 */

import path from 'node:path'

import postgres from 'postgres'

import { computeVendorNetPayout } from '@/lib/payments/payout-calculator'

import { test, expect } from '../../fixtures/devtools'
import { e2eDbUrl } from '../../helpers/config'
import {
  getExperienceByTitle,
  getExperienceById,
  getPublishedExperienceForVendor,
  getMediaAssetsForExperience,
  getAvailabilityPatterns,
  getSlotsForExperienceOnDate,
  countSlotsForExperienceInRange,
  insertRegionClosure,
  deleteRegionClosure,
  clearAvailabilityForExperience,
  getVendorBookingByStateAndSlug,
  getBookingLifecycle,
  getVendorSlaScore,
  getPaymentsForBooking,
  getRefundRequestForBooking,
  getRefundBalanceCreditAuditForBooking,
  getVendorReviewAwaitingResponse,
  getReviewResponse,
  getVendorEarningBookings,
  getVendorConversationBySubject,
  getVendorProfileSettings,
  getExperienceIsCombo,
  getVendorKycTier,
  setVendorKycTier,
  insertAvailabilitySlot,
  deleteAvailabilitySlot,
  countBookingsForSlotAndCustomer,
  countBookingTierCapRejectedAuditRows,
} from '../../helpers/db-assertions'
import { getIndexedExperience } from '../../helpers/meili-assertions'
import { storageFileExists } from '../../helpers/storage-assertions'

// ---------------------------------------------------------------------------
// 1. Onboarding page — already-onboarded vendor redirects to dashboard
// ---------------------------------------------------------------------------
test.describe('Vendor onboarding', () => {
  test('redirects to dashboard when vendor profile already exists', async ({
    page,
  }) => {
    // The seed vendor (u_seed_v_business) already has a vendor profile,
    // so the onboarding page should redirect to /vendor/dashboard
    await page.goto('/vendor/onboarding')
    await page.waitForURL(/\/vendor\/dashboard/)

    // Dashboard heading is visible
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Dashboard')

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-onboarding-redirect.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 1b. Onboarding flow — a signed-up vendor WITHOUT a profile completes the
//     wizard and a phone-tier Vendor profile is created (functional #16).
//
//     Uses the `u_seed_v_onboarding` seed user (no vendor_profile) via its
//     own injected session, overriding the project's default vendor storage.
// ---------------------------------------------------------------------------
const ONBOARDING_STORAGE = path.resolve(
  __dirname,
  '../../.auth/vendor-onboarding-storage.json',
)
const ONBOARDING_USER_ID = 'u_seed_v_onboarding'

test.describe('Vendor onboarding flow (no profile yet)', () => {
  test.use({ storageState: ONBOARDING_STORAGE })

  test('completes the wizard and creates a phone-tier vendor profile', async ({
    page,
  }) => {
    // Deterministic, slug-unique business name for this run.
    const businessName = 'E2E Onboarding Outfitters'
    const expectedSlug = 'e2e-onboarding-outfitters'

    // Make the test retry-safe: ensure this user has no profile before we
    // drive the wizard (globalSetup reseeds, but CI retries reuse the DB).
    {
      const cleanup = postgres(e2eDbUrl(), { max: 1 })
      try {
        await cleanup`DELETE FROM vendor_profiles WHERE user_id = ${ONBOARDING_USER_ID}`
      } finally {
        await cleanup.end()
      }
    }

    await page.goto('/vendor/onboarding')

    // The onboarding wizard renders (not a redirect) because this user has
    // no vendor profile yet.
    await expect(page.locator('h1')).toContainText('Become a vendor')

    // ── #73 variant A: the persistent trust banner (B5 + commission
    //    transparency) is visible on step 1 — "0% upfront fee" plus the
    //    commission-before-you-finish framing. Asserted via a stable
    //    data-testid so the copy can evolve without breaking the gate.
    const trustBanner = page.getByTestId('onboarding-trust-banner')
    await expect(trustBanner).toBeVisible()
    await expect(trustBanner).toContainText(/0%\s*upfront/i)
    await expect(trustBanner).toContainText(/commission/i)

    // ── Step 1: business details ──────────────────────────────────────
    await page.fill('#businessName', businessName)
    // Slug auto-derives from the business name; confirm it.
    await expect(page.locator('#slug')).toHaveValue(expectedSlug)

    await page.locator('button', { hasText: 'Continue' }).click()

    // The trust banner persists across steps (it rides the whole wizard).
    await expect(page.getByTestId('onboarding-trust-banner')).toBeVisible()

    // ── Step 2: verification (mocked manual-approve path, no live Aadhaar) ─
    // PAN is optional here; we intentionally leave it blank to assert the
    // profile is created at the phone tier with no self-promotion. The
    // step explicitly defers Aadhaar/document upload to a connected
    // external service — i.e. the mocked manual-approve path.
    await expect(
      page.getByText(/Aadhaar verification and document upload will be available/i),
    ).toBeVisible()

    await page.locator('button', { hasText: 'Continue' }).click()

    // ── Step 3: confirm & create ──────────────────────────────────────
    await expect(page.getByText('Confirm & create profile')).toBeVisible()
    await page.locator('button', { hasText: 'Create vendor profile' }).click()

    // On success the form redirects to the dashboard.
    await page.waitForURL(/\/vendor\/dashboard/, { timeout: 15_000 })
    await expect(page.locator('h1')).toContainText('Dashboard')

    // ── Assert against the DB: a phone-tier profile now exists ────────
    const sql = postgres(e2eDbUrl(), { max: 1 })
    try {
      const rows = await sql<
        { kyc_tier: string; slug: string; pan: string | null }[]
      >`
        SELECT kyc_tier, slug, pan
        FROM vendor_profiles
        WHERE user_id = ${ONBOARDING_USER_ID}
        LIMIT 1
      `
      expect(rows).toHaveLength(1)
      expect(rows[0].slug).toBe(expectedSlug)
      // ADR-0007: a freshly-onboarded vendor is ALWAYS phone tier. The
      // identity tier is reached only via the admin manual-approve path.
      expect(rows[0].kyc_tier).toBe('phone')
      expect(rows[0].pan).toBeNull()
    } finally {
      await sql.end()
    }

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-onboarding-create.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 2. Listings page — shows vendor's seeded experiences
// ---------------------------------------------------------------------------
test.describe('Vendor listings', () => {
  test('renders the A3 listings table with status, price, and completeness', async ({
    page,
  }) => {
    const response = await page.goto('/vendor/listings')
    expect(response?.status()).toBe(200)

    // Page heading
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Listings')

    // Count subtitle — the business-tier vendor has 4 seeded experiences
    await expect(page.getByText(/\d+ experience/)).toBeVisible()

    // "Create listing" link is visible (preserved CTA → …/new)
    await expect(page.locator('a[href="/vendor/listings/new"]')).toBeVisible()

    // ── #75 variant A: a dense A3 table, one row per listing, addressed by a
    //    stable data-testid (the title is now a table-cell link, not an
    //    <a><h3>). At least one row for the seeded experiences.
    const rows = page.getByTestId('listing-row')
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThanOrEqual(1)

    const firstRow = rows.first()
    await expect(firstRow).toBeVisible()

    // Each row links to its edit page (preserved per-listing link intent).
    const editLink = firstRow.locator('a[href*="/vendor/listings/"]').first()
    await expect(editLink).toBeVisible()
    await expect(editLink).toHaveAttribute('href', /\/vendor\/listings\/[^/]+\/edit/)

    // Each row carries a status Badge (preserved status signal).
    await expect(firstRow.getByTestId('listing-status')).toBeVisible()

    // Each row shows activity/region and a price (preserved info).
    await expect(firstRow.getByTestId('listing-taxonomy')).toBeVisible()
    await expect(firstRow.getByTestId('listing-price')).toContainText('₹')

    // ── New (#75): a per-listing completeness indicator (the ring) with an
    //    accessible percentage value.
    const completeness = firstRow.getByTestId('listing-completeness')
    await expect(completeness).toBeVisible()
    await expect(completeness).toContainText('%')

    // ── New (#75): the filter + sort controls (a small client island).
    await expect(page.getByTestId('listing-status-filter')).toBeVisible()
    await expect(page.getByTestId('listing-sort')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-listings.png',
      fullPage: true,
    })
  })

  test('filters listings by status via the status filter', async ({ page }) => {
    // The business vendor has both published and draft seeded experiences.
    await page.goto('/vendor/listings')
    await expect(page.locator('h1')).toContainText('Listings')

    const allCount = await page.getByTestId('listing-row').count()
    expect(allCount).toBeGreaterThanOrEqual(1)

    // Narrow to published only via the URL-driven filter (SSR-safe; no
    // dependency on a hydrated control to drive the query).
    await page.goto('/vendor/listings?status=published')
    await expect(page.locator('h1')).toContainText('Listings')

    const publishedRows = page.getByTestId('listing-row')
    const publishedCount = await publishedRows.count()
    expect(publishedCount).toBeGreaterThanOrEqual(1)
    // Every visible row in the published view shows a "published" status.
    for (let i = 0; i < publishedCount; i++) {
      await expect(
        publishedRows.nth(i).getByTestId('listing-status'),
      ).toContainText(/published/i)
    }
    // Filtering is a strict subset of the unfiltered list.
    expect(publishedCount).toBeLessThanOrEqual(allCount)
  })
})

// ---------------------------------------------------------------------------
// 3. Create listing — fill new experience form → save → persists as draft →
//    appears in the vendor Experiences list (AC #1: create path).
// ---------------------------------------------------------------------------
const SEED_BUSINESS_VENDOR_ID = 'u_seed_v_business'

test.describe('Create listing', () => {
  test('fill form, save, persist as draft, and verify new listing appears', async ({
    page,
  }) => {
    // Deterministic, unique title per run so retries / parallel runs don't
    // collide (the action appends a base36 timestamp to the slug).
    const title = `E2E Create Experience — Sunset Kayaking ${Date.now()}`

    // Navigate to the new listing form
    await page.goto('/vendor/listings/new')
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Create listing')

    // ── #76 variant A "Guided Builder": the create form is now a sectioned B5
    //    stepper (Details → Pricing → Policy → Review). Fields live on focused
    //    sections; we advance via the sticky-footer "Continue" control (which
    //    runs per-section inline validation) and submit only on the final
    //    Review step. Every original assertion below is preserved verbatim.

    // ── Section 1: Details — title, description, activity, region ──────────
    // Fill title
    await page.fill('#title', title)

    // Fill description
    await page.fill(
      '#description',
      'A scenic sunset kayaking session for testing purposes.',
    )

    // Select activity — open the select, pick "Kayaking"
    const activityTrigger = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: 'Select activity' })
    await activityTrigger.click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Kayaking' }).click()

    // Select region — open the select, pick "Goa"
    const regionTrigger = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: 'Select region' })
    await regionTrigger.click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Goa' }).click()

    // Advance to the Pricing section (validates Details first).
    await page.getByRole('button', { name: 'Continue' }).click()

    // ── Section 2: Pricing — 1-2 guests bracket ────────────────────────────
    await expect(page.locator('#price12')).toBeVisible()
    await page.fill('#price12', '2500')
    await page.getByRole('button', { name: 'Continue' }).click()

    // ── Section 3: Policy & payment → advance to Review ────────────────────
    await page.getByRole('button', { name: 'Continue' }).click()

    // ── Section 4: Review — commission (20%) is shown before the final submit ─
    await expect(page.getByText(/20%/).first()).toBeVisible()
    const submit = page.locator('button[type="submit"]')
    await expect(submit).toBeVisible()

    // Submit the form
    await submit.click()

    // Wait for the client-side navigation to the listings page
    await page.waitForURL(/\/vendor\/listings$/, { timeout: 15_000 })

    // Verify the new listing appears on the listings page (list rendering)
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 })

    // ── Assert against the DB: the row persisted as a DRAFT for this vendor ─
    const created = await getExperienceByTitle(SEED_BUSINESS_VENDOR_ID, title)
    expect(created).not.toBeNull()
    expect(created!.status).toBe('draft')
    expect(created!.pricePerPerson_1_2).toBe(2500)
    expect(created!.vendorUserId).toBe(SEED_BUSINESS_VENDOR_ID)

    // The new listing's row carries the draft status badge (#75 A3 table:
    // the row is addressed by its stable testid and filtered by the title).
    const row = page
      .getByTestId('listing-row')
      .filter({ has: page.getByText(title) })
    await expect(row.getByTestId('listing-status')).toContainText(/draft/i)

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-create-listing.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 4. Edit listing — open a PUBLISHED listing → change price → save →
//    price survives reload (DB) AND re-indexes into Meilisearch (AC #1).
// ---------------------------------------------------------------------------
test.describe('Edit listing', () => {
  // A within-cap published listing owned by the business-tier vendor. A
  // business Vendor is unrestricted, so any new price is allowed; we pick a
  // value below the identity cap to keep the change unambiguous.
  const PUBLISHED_SLUG = 'goa-scuba-diving-padi-dsd'
  const NEW_PRICE = 4750

  test('change price on a published listing, verify it persists and re-indexes', async ({
    page,
  }) => {
    // Resolve the published experience id directly so the edit is deterministic.
    const target = await getPublishedExperienceForVendor(
      SEED_BUSINESS_VENDOR_ID,
      PUBLISHED_SLUG,
    )
    expect(target, `seed published experience ${PUBLISHED_SLUG} must exist`).not.toBeNull()
    const experienceId = target!.id
    // Guard against a stale value from a prior retry on the reused DB.
    expect(target!.pricePerPerson_1_2).not.toBe(NEW_PRICE)

    await page.goto(`/vendor/listings/${experienceId}/edit`)
    await expect(page.locator('h1')).toContainText('Edit experience')

    // ── #77 variant A "Guided Builder": the edit form is the SAME sectioned
    //    B5 stepper (Details → Pricing → Policy → Review). #title is on the
    //    opening Details section (pre-filled from the DB); the price brackets
    //    live on the Pricing section; the payment-mode controls live on the
    //    Policy section. We navigate via the sticky-footer "Continue" control,
    //    preserving every original assertion.

    // Details (step 1): #title is pre-filled from the database.
    await expect(page.locator('#title')).toHaveValue(/.+/)
    await page.getByRole('button', { name: 'Continue' }).click()

    // Pricing (step 2): the price fields are populated from the database.
    const priceInput = page.locator('#price12')
    await expect(priceInput).toBeVisible()
    const initialValue = await priceInput.inputValue()
    expect(Number(initialValue)).toBeGreaterThan(0)
    // Change the headline (1-2) price.
    await priceInput.fill(String(NEW_PRICE))
    await page.getByRole('button', { name: 'Continue' }).click()

    // ── Graceful degradation (Issue #112 / ADR-0002) — Policy & payment step ─
    // The vendor-facing payment-mode picker must offer ONLY the two shipped
    // modes (Full upfront / Partial pay). Reserve-now-pay-later is schema-
    // named but unbuilt, so it must NOT appear as a selectable control here.
    // The "Payment modes" section heading is present…
    await expect(
      page.getByText('Payment modes', { exact: true }),
    ).toBeVisible()
    // …and renders exactly the two shipped modes as checkbox labels.
    await expect(
      page.locator('label').filter({ hasText: 'Full upfront' }),
    ).toBeVisible()
    await expect(
      page.locator('label').filter({ hasText: 'Partial pay' }),
    ).toBeVisible()
    // No RNPL option / tile / badge anywhere in the form.
    const formText = (await page.locator('form').innerText()).toLowerCase()
    expect(formText, 'vendor edit must not offer RNPL').not.toContain(
      'reserve now',
    )
    expect(formText, 'vendor edit must not offer "pay later"').not.toContain(
      'pay later',
    )
    expect(formText, 'vendor edit must not surface the RNPL acronym').not.toContain(
      'rnpl',
    )

    // Save from the persistent footer submit (edit mode can save from any step).
    await page.locator('button[type="submit"]').click()

    // The form surfaces an inline success state on a persisted update.
    await expect(page.getByText('Experience updated.')).toBeVisible({ timeout: 15_000 })

    // ── Assert: price persisted in the DB ────────────────────────────────
    const afterSave = await getExperienceById(experienceId)
    expect(afterSave!.pricePerPerson_1_2).toBe(NEW_PRICE)
    expect(afterSave!.status).toBe('published')

    // ── Assert: price SURVIVES RELOAD (form re-populates from the DB) ─────
    // The numeric column round-trips as e.g. "4750.00"; compare the value
    // rather than the exact string format. After reload the stepper opens on
    // Details; advance to the Pricing section to read the persisted #price12.
    await page.reload()
    await page.getByRole('button', { name: 'Continue' }).click()
    const reloadedValue = await page.locator('#price12').inputValue()
    expect(Number(reloadedValue)).toBe(NEW_PRICE)

    // ── Assert: the published listing RE-INDEXED into Meilisearch ────────
    // ADR-0013: the canonical search row reflects the edited facet price.
    const doc = await getIndexedExperience(experienceId)
    expect(doc, 'edited published experience must be (re)indexed in Meilisearch').not.toBeNull()
    expect(doc!.id).toBe(experienceId)
    expect(doc!.slug).toBe(PUBLISHED_SLUG)
    expect(doc!.pricePerPersonRupees).toBe(NEW_PRICE)

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-edit-listing.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 4b. Images — upload via the storage mock → media_assets row + on-disk file;
//     delete → row + file removed (AC #2).
// ---------------------------------------------------------------------------
test.describe('Listing images', () => {
  const PUBLISHED_SLUG = 'goa-scuba-diving-fun-dive-cert'

  test('upload an image to a listing then delete it (storage mock)', async ({
    page,
  }) => {
    const target = await getPublishedExperienceForVendor(
      SEED_BUSINESS_VENDOR_ID,
      PUBLISHED_SLUG,
    )
    expect(target).not.toBeNull()
    const experienceId = target!.id

    await page.goto(`/vendor/listings/${experienceId}/edit`)
    await expect(page.locator('h1')).toContainText('Edit experience')

    // A tiny but VALID 1x1 PNG so next/image's optimizer can fetch it without
    // emitting a 4xx (which the DevTools fixture would fail on).
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'e2e-listing-photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(pngBase64, 'base64'),
    })

    // The preview tile (with its Delete button) appears once the upload action
    // resolves and the client state updates.
    const deleteButton = page.getByRole('button', { name: 'Delete image' })
    await expect(deleteButton).toBeVisible({ timeout: 15_000 })

    // ── Assert: a media_assets row exists AND the file landed on the mock ─
    const assetsAfterUpload = await getMediaAssetsForExperience(experienceId)
    expect(assetsAfterUpload.length).toBeGreaterThanOrEqual(1)
    const asset = assetsAfterUpload[assetsAfterUpload.length - 1]
    expect(asset.url).toContain('/uploads/experiences/')
    expect(asset.uploadedBy).toBe(SEED_BUSINESS_VENDOR_ID)
    expect(storageFileExists(asset.storageKey)).toBe(true)

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-listing-image-uploaded.png',
      fullPage: true,
    })

    // ── Delete the image → row removed AND file removed from the mock ────
    await deleteButton.click()
    await expect(deleteButton).toBeHidden({ timeout: 15_000 })

    const assetsAfterDelete = await getMediaAssetsForExperience(experienceId)
    expect(assetsAfterDelete.find((a) => a.id === asset.id)).toBeUndefined()
    expect(storageFileExists(asset.storageKey)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4c. Over-cap publish rejection — an IDENTITY-tier Vendor editing a LIVE
//     (published) over-cap listing is rejected by the ADR-0007 guard from
//     #10 (AC #3). #21 runs the full tier-cap matrix; here we confirm the
//     edit path surfaces the rejection in the UI and does not persist.
// ---------------------------------------------------------------------------
const IDENTITY_VENDOR_STORAGE = path.resolve(
  __dirname,
  '../../.auth/identity-vendor-storage.json',
)
const IDENTITY_VENDOR_ID = 'u_seed_v_identity'

test.describe('Over-cap publish rejection (Identity tier, ADR-0007)', () => {
  test.use({ storageState: IDENTITY_VENDOR_STORAGE })

  test('rejects an over-cap edit of a published listing and does not persist', async ({
    page,
  }) => {
    // The seeded identity vendor's 5-day Hampta trek is published at
    // Rs.12,500/pp — already over the Rs.5,000 cap. Editing it live must be
    // rejected by the guard before any DB write.
    const target = await getPublishedExperienceForVendor(
      IDENTITY_VENDOR_ID,
      'manali-hampta-pass-trek-5d',
    )
    expect(target).not.toBeNull()
    const experienceId = target!.id
    const originalPrice = target!.pricePerPerson_1_2

    await page.goto(`/vendor/listings/${experienceId}/edit`)
    await expect(page.locator('h1')).toContainText('Edit experience')

    // #76/#77 stepper: the price brackets live on the Pricing section.
    await page.getByRole('button', { name: 'Continue' }).click()

    // Submit an edit that keeps the price over the cap (still Rs.9,000).
    await page.locator('#price12').fill('9000')
    await page.locator('#price35').fill('9000')
    await page.locator('#price6').fill('9000')
    await page.locator('button[type="submit"]').click()

    // The guard's rejection reason is surfaced inline (mentions the cap).
    await expect(page.getByText(/per person|Rs\.?\s*5000|5,?000/i)).toBeVisible({
      timeout: 15_000,
    })
    // The success banner must NOT appear.
    await expect(page.getByText('Experience updated.')).toHaveCount(0)

    // ── Assert: the over-cap price was NOT persisted ─────────────────────
    const after = await getExperienceById(experienceId)
    expect(after!.pricePerPerson_1_2).toBe(originalPrice)

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-overcap-rejected.png',
      fullPage: true,
    })
  })

  test('allows a within-cap edit of a published listing for an Identity Vendor', async ({
    page,
  }) => {
    // The identity vendor's beginner kayaking listing is published at
    // Rs.1,800/pp (within cap). A within-cap price change must succeed.
    const target = await getPublishedExperienceForVendor(
      IDENTITY_VENDOR_ID,
      'rishikesh-kayaking-introduction',
    )
    expect(target).not.toBeNull()
    const experienceId = target!.id
    const newPrice = 1900
    expect(target!.pricePerPerson_1_2).not.toBe(newPrice)

    await page.goto(`/vendor/listings/${experienceId}/edit`)
    await expect(page.locator('h1')).toContainText('Edit experience')

    // #76/#77 stepper: the price brackets live on the Pricing section.
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.locator('#price12').fill(String(newPrice))
    await page.locator('button[type="submit"]').click()

    await expect(page.getByText('Experience updated.')).toBeVisible({ timeout: 15_000 })

    const after = await getExperienceById(experienceId)
    expect(after!.pricePerPerson_1_2).toBe(newPrice)
  })
})

// ---------------------------------------------------------------------------
// 4d. KYC tier-cap FULL MATRIX (Identity tier, ADR-0007 / EPIC-K, #21).
//     #17 added a touch of over-cap PRICE publish coverage above; this block
//     runs the complete boundary matrix FROM THE UI:
//       PRICE     5001 blocked / 5000 allowed (exact boundary)
//       CAPACITY  9 blocked / 8 allowed (per-slot)
//       COMBO     is_combo blocked
//       MULTI-DAY a cross-calendar-day slot blocked
//     plus the booking-create re-check on a tier DOWNGRADE (covered in 4e).
//
//     The publish path exercised is the vendor edit action
//     (executeUpdateExperience), which runs the guard on a LIVE listing
//     against the PROPOSED price/combo + the Experience's materialised slots.
//     For the per-slot caps (capacity / multi-day) the test stages a single
//     over-cap slot, drives the edit, then deletes it — seed slots untouched.
// ---------------------------------------------------------------------------
test.describe('Tier-cap matrix — publish path (Identity tier, ADR-0007, #21)', () => {
  test.use({ storageState: IDENTITY_VENDOR_STORAGE })
  // Serial: the per-slot cases STAGE over-cap (capacity-9 / multi-day) slots on
  // identity listings and drive the edit-publish guard, which reads ALL of an
  // Experience's slots. Under parallel, a multi-day slot staged by one test
  // would leak into another's guard run (single-day is checked before
  // capacity), so the guard would return the wrong violation. Serial + a
  // DISTINCT Experience per slot-staging case keeps each guard run clean.
  test.describe.configure({ mode: 'serial' })

  // Identity listings that are within cap in the seed. PRICE/COMBO edit one
  // Experience (no slot staging); CAPACITY and MULTI-DAY each stage a slot on
  // their OWN Experience so the staged slots never cross-contaminate.
  const PRICE_SLUG = 'manali-solang-paragliding-tandem' // 3500/pp, single-day
  const COMBO_SLUG = 'manali-solang-paragliding-tandem'
  const CAPACITY_SLUG = 'rishikesh-kayaking-introduction' // 1800/pp
  const MULTI_DAY_SLUG = 'rishikesh-rafting-grade-iii' // 1500/pp

  // A far-future, distinct UTC hour avoids the unique (experience_id, start_at)
  // collision with the seed's T+7d 04:00 slot and the T-7d outside-policy slot.
  const STAGE_DAY = '2027-03-10'

  test('PRICE: editing to Rs.5,001/pp is BLOCKED; Rs.5,000/pp is ALLOWED', async ({
    page,
  }) => {
    const target = await getPublishedExperienceForVendor(IDENTITY_VENDOR_ID, PRICE_SLUG)
    expect(target, `seed ${PRICE_SLUG} must exist`).not.toBeNull()
    const experienceId = target!.id
    // Capture ALL THREE seed brackets so the finally restores every field the
    // test mutates (not just 1-2) — keeps the shared seed Experience
    // deterministic for parallel/repeat runs even if an assertion throws.
    const seedRow = (await getExperienceById(experienceId))!
    const orig12 = seedRow.pricePerPerson_1_2
    const orig35 = seedRow.pricePerPerson_3_5
    const orig6 = seedRow.pricePerPerson_6_plus

    try {
      await page.goto(`/vendor/listings/${experienceId}/edit`)
      await expect(page.locator('h1')).toContainText('Edit experience')
      // #76/#77 stepper: the price brackets live on the Pricing section.
      await page.getByRole('button', { name: 'Continue' }).click()

      // ── 5001 → BLOCKED. The per-person cap is on the HIGHEST bracket, so
      //    pushing the 1-2 bracket one rupee over the cap must trip PRICE_OVER_CAP.
      await page.locator('#price12').fill('5001')
      await page.locator('#price35').fill('4000')
      await page.locator('#price6').fill('4000')
      await page.locator('button[type="submit"]').click()

      await expect(page.getByText(/up to Rs\.?\s*5000 per person/i)).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByText('Experience updated.')).toHaveCount(0)

      // The over-cap price was NOT persisted (still the seed value).
      expect((await getExperienceById(experienceId))!.pricePerPerson_1_2).toBe(orig12)

      // ── 5000 → ALLOWED (exact boundary is inclusive). Persists.
      await page.locator('#price12').fill('5000')
      await page.locator('#price35').fill('4000')
      await page.locator('#price6').fill('4000')
      await page.locator('button[type="submit"]').click()

      await expect(page.getByText('Experience updated.')).toBeVisible({ timeout: 15_000 })
      expect((await getExperienceById(experienceId))!.pricePerPerson_1_2).toBe(5000)
    } finally {
      // Restore ALL THREE seed brackets so parallel/repeat runs stay deterministic.
      await page.goto(`/vendor/listings/${experienceId}/edit`)
      await page.getByRole('button', { name: 'Continue' }).click()
      await page.locator('#price12').fill(String(Number(orig12)))
      await page.locator('#price35').fill(String(Number(orig35)))
      await page.locator('#price6').fill(String(Number(orig6)))
      await page.locator('button[type="submit"]').click()
      await expect(page.getByText('Experience updated.')).toBeVisible({ timeout: 15_000 })
    }
  })

  test('COMBO: marking the Experience is_combo is BLOCKED for an Identity Vendor', async ({
    page,
  }) => {
    const target = await getPublishedExperienceForVendor(IDENTITY_VENDOR_ID, COMBO_SLUG)
    expect(target).not.toBeNull()
    const experienceId = target!.id
    expect(await getExperienceIsCombo(experienceId)).toBe(false)

    await page.goto(`/vendor/listings/${experienceId}/edit`)
    await expect(page.locator('h1')).toContainText('Edit experience')

    // #76/#77 stepper: the combo / settings controls live on the Policy &
    // settings section (Details → Pricing → Policy). Advance to it.
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Tick the "Combo experience" checkbox and save — the guard must reject.
    await page
      .getByRole('checkbox', { name: /Combo experience/i })
      .check()
    await page.locator('button[type="submit"]').click()

    await expect(page.getByText(/cannot publish Combo Experiences/i)).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText('Experience updated.')).toHaveCount(0)

    // is_combo was NOT flipped in the DB.
    expect(await getExperienceIsCombo(experienceId)).toBe(false)
  })

  test('CAPACITY: a 9-participant slot is BLOCKED; 8 is ALLOWED (per-slot cap)', async ({
    page,
  }) => {
    const target = await getPublishedExperienceForVendor(IDENTITY_VENDOR_ID, CAPACITY_SLUG)
    expect(target).not.toBeNull()
    const experienceId = target!.id

    // Stage a SINGLE-DAY, capacity-9 slot — the only over-cap fact is capacity.
    const overCapSlotId = await insertAvailabilitySlot({
      experienceId,
      startAt: `${STAGE_DAY}T05:00:00.000Z`,
      endAt: `${STAGE_DAY}T08:00:00.000Z`,
      capacity: 9,
    })

    try {
      await page.goto(`/vendor/listings/${experienceId}/edit`)
      await expect(page.locator('h1')).toContainText('Edit experience')

      // A no-op-price save still runs the guard, which reads ALL slots → the
      // capacity-9 slot trips CAPACITY_OVER_CAP.
      await page.locator('button[type="submit"]').click()
      await expect(page.getByText(/up to 8 participants per slot/i)).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByText('Experience updated.')).toHaveCount(0)
    } finally {
      await deleteAvailabilitySlot(overCapSlotId)
    }

    // ── 8 → ALLOWED. Replace with a capacity-8 single-day slot; the guard
    //    now sees only within-cap slots and the edit persists.
    const okSlotId = await insertAvailabilitySlot({
      experienceId,
      startAt: `${STAGE_DAY}T05:00:00.000Z`,
      endAt: `${STAGE_DAY}T08:00:00.000Z`,
      capacity: 8,
    })
    try {
      await page.goto(`/vendor/listings/${experienceId}/edit`)
      await expect(page.locator('h1')).toContainText('Edit experience')
      await page.locator('button[type="submit"]').click()
      await expect(page.getByText('Experience updated.')).toBeVisible({ timeout: 15_000 })
    } finally {
      await deleteAvailabilitySlot(okSlotId)
    }
  })

  test('MULTI-DAY: a cross-calendar-day slot is BLOCKED for an Identity Vendor', async ({
    page,
  }) => {
    const target = await getPublishedExperienceForVendor(IDENTITY_VENDOR_ID, MULTI_DAY_SLUG)
    expect(target).not.toBeNull()
    const experienceId = target!.id

    // Stage a slot that starts on STAGE_DAY and ends the NEXT calendar day
    // (UTC) — within cap on price + capacity, so MULTI_DAY is the only fact.
    const multiDaySlotId = await insertAvailabilitySlot({
      experienceId,
      startAt: `${STAGE_DAY}T20:00:00.000Z`,
      endAt: `2027-03-11T06:00:00.000Z`,
      capacity: 8,
    })

    try {
      await page.goto(`/vendor/listings/${experienceId}/edit`)
      await expect(page.locator('h1')).toContainText('Edit experience')

      await page.locator('button[type="submit"]').click()
      await expect(page.getByText(/only publish single-day Experiences/i)).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByText('Experience updated.')).toHaveCount(0)
    } finally {
      await deleteAvailabilitySlot(multiDaySlotId)
    }
  })
})

// ---------------------------------------------------------------------------
// 4e. Booking-create tier-cap RE-CHECK on a tier DOWNGRADE (ADR-0007, #21).
//     AC: "Booking-create rejects an over-cap Booking even if the Experience
//     pre-dates a tier downgrade." Driven FROM THE UI checkout as the CUSTOMER
//     (the actor at booking time): a Business-tier Vendor's over-cap-priced
//     Experience is published, the Vendor is downgraded to Identity, then the
//     Customer attempts to book — booking-create's re-check refuses it.
//     The Vendor tier is restored in a finally so other specs see the seed.
// ---------------------------------------------------------------------------
const CUSTOMER_STORAGE = path.resolve(__dirname, '../../.auth/customer-storage.json')
const SEED_CUSTOMER_ID = 'u_seed_customer'

test.describe('Tier-cap matrix — booking-create on downgrade (ADR-0007, #21)', () => {
  test.use({ storageState: CUSTOMER_STORAGE })
  // Serial: flips the shared business Vendor's tier within a try/finally. A
  // single serial test keeps the downgrade window scoped and restored.
  test.describe.configure({ mode: 'serial' })

  // The business Vendor's certified fun-dive is published at Rs.5,500/pp —
  // over the Identity Rs.5,000/pp cap. Published while Business (unrestricted),
  // so it models an Experience that PRE-DATES the downgrade.
  const OVER_CAP_PRICE_SLUG = 'goa-scuba-diving-fun-dive-cert'

  test('booking an over-cap slot after a downgrade is REJECTED (no Booking created)', async ({
    page,
  }) => {
    const target = await getPublishedExperienceForVendor(
      SEED_BUSINESS_VENDOR_ID,
      OVER_CAP_PRICE_SLUG,
    )
    expect(target, `seed ${OVER_CAP_PRICE_SLUG} must exist`).not.toBeNull()
    const experienceId = target!.id
    // Sanity: this Experience's headline price is genuinely over the cap.
    expect(target!.pricePerPerson_1_2).toBeGreaterThan(5000)

    // A dedicated open slot so the assertion never collides with seeded
    // bookings on this Experience's other slots.
    const slotId = await insertAvailabilitySlot({
      experienceId,
      startAt: `2027-04-12T05:00:00.000Z`,
      endAt: `2027-04-12T08:00:00.000Z`,
      capacity: 8,
    })

    const originalTier = await getVendorKycTier(SEED_BUSINESS_VENDOR_ID)
    expect(originalTier).toBe('business')
    const rejectedBefore = await countBookingTierCapRejectedAuditRows(experienceId)

    try {
      // ── Downgrade the Vendor Business → Identity (ADR-0007). The Experience
      //    was already published; only the booking-create re-check stands now.
      await setVendorKycTier(SEED_BUSINESS_VENDOR_ID, 'identity')

      // Drive the real UI checkout for this slot as the Customer.
      await page.goto(`/checkout?experienceId=${experienceId}&slotId=${slotId}&participants=2`)
      await expect(page.locator('h1')).toContainText('Checkout')

      // #70 guided-stepper: "Your details" loads first; advance to the Payment
      // step where the Pay button lives (the over-cap rejection surfaces there).
      await page.getByRole('button', { name: /continue to payment/i }).click()

      const payButton = page.locator('button:has-text("Pay")')
      await expect(payButton).toBeVisible()
      await payButton.click()

      // The checkout action surfaces the ADR-0007 reason inline (the per-person
      // cap message), and must NOT navigate to a confirmation page.
      await expect(page.getByText(/up to Rs\.?\s*5000 per person/i)).toBeVisible({
        timeout: 15_000,
      })
      await expect(page).not.toHaveURL(/\/bookings\/[^/]+\/confirmation/)

      // ── No Booking was created for this (slot, customer) — the txn rolled back.
      expect(
        await countBookingsForSlotAndCustomer(slotId, SEED_CUSTOMER_ID),
      ).toBe(0)

      // ── A booking.tier_cap_rejected audit row was written (survives rollback).
      expect(await countBookingTierCapRejectedAuditRows(experienceId)).toBe(
        rejectedBefore + 1,
      )

      await page.screenshot({
        path: 'tests/e2e/screenshots/vendor-booking-tiercap-downgrade.png',
        fullPage: true,
      })
    } finally {
      // Restore the seed tier + remove the staged slot for deterministic reruns.
      if (originalTier) {
        await setVendorKycTier(
          SEED_BUSINESS_VENDOR_ID,
          originalTier as 'phone' | 'identity' | 'business',
        )
      }
      await deleteAvailabilitySlot(slotId)
    }
  })
})

// ---------------------------------------------------------------------------
// 5. Availability management (#18) — patterns, slot materialisation,
//    block/unblock, region closure. Asserts UI behaviour AND the DB.
//
//    All tests run on the business-tier vendor's published Goa scuba listing
//    (region "goa") so the region-closure test can target the "goa" region.
//    Each test resets that Experience's availability up-front so reruns on a
//    reused CI database stay deterministic.
// ---------------------------------------------------------------------------
// Each availability test targets a DISTINCT seeded business-vendor published
// Experience so the suite is safe to run with Playwright's fullyParallel mode
// (no two tests clobber the same patterns/slots/closures). The closure test
// must use a "goa"-region Experience so the region closure it inserts applies.
const AVAIL_SLUG_PATTERN_CRUD = 'bir-billing-camping-mountain-stay' // bir-billing, no booking
const AVAIL_SLUG_MATERIALISE = 'bir-billing-paragliding-full-day' // bir-billing
const AVAIL_SLUG_BLOCK = 'goa-scuba-diving-padi-dsd' // goa
const AVAIL_SLUG_CLOSURE = 'goa-scuba-diving-fun-dive-cert' // goa, no booking

// 2026-07-15 is a Wednesday (UTC dayOfWeek = 3) — used by the block/unblock
// and closure assertions. It sits inside the materialiser's rolling 90-day
// window relative to the seed/run date.
const BLOCK_DATE = '2026-07-15'
const BLOCK_DOW = 3 // Wednesday

async function resolveAvailExperienceId(slug: string): Promise<string> {
  const target = await getPublishedExperienceForVendor(SEED_BUSINESS_VENDOR_ID, slug)
  expect(target, `seed published experience ${slug} must exist`).not.toBeNull()
  return target!.id
}

test.describe('Availability management', () => {
  // Serial: the region-closure test inserts a "goa" closure (removed in a
  // finally) that would otherwise race the goa-region block/unblock test's
  // materialise step under fullyParallel. Serial mode keeps the closure
  // scoped to its own test window. Distinct per-test Experiences additionally
  // isolate pattern/slot state.
  test.describe.configure({ mode: 'serial' })

  test('navigate to availability, add pattern, verify it appears', async ({
    page,
  }) => {
    // Navigate to listings to get a listing ID
    await page.goto('/vendor/listings')
    await expect(page.locator('h1')).toContainText('Listings')

    // Click the first listing's edit link to go to its edit page (#75 A3
    // table: the title is a row-cell link addressed via the row testid).
    const listingLink = page
      .getByTestId('listing-row')
      .first()
      .locator('a[href*="/vendor/listings/"]')
      .first()
    await listingLink.click()
    await page.waitForURL(/\/vendor\/listings\/([^/]+)\/edit/)

    // Extract the listing ID from the URL
    const editUrl = page.url()
    const listingIdMatch = editUrl.match(/\/vendor\/listings\/([^/]+)\/edit/)
    expect(listingIdMatch).toBeTruthy()
    const listingId = listingIdMatch![1]

    // Navigate to the availability page
    await page.goto(`/vendor/listings/${listingId}/availability`)
    await expect(page.locator('h1')).toContainText('Availability')

    // Click "Add Pattern" button
    const addPatternBtn = page.locator('button').filter({ hasText: 'Add Pattern' })
    await expect(addPatternBtn).toBeVisible()
    await addPatternBtn.click()

    // The form should appear with day, start time, end time, capacity fields
    await expect(page.locator('#startTime')).toBeVisible()
    await expect(page.locator('#endTime')).toBeVisible()
    await expect(page.locator('#capacity')).toBeVisible()

    // Fill the form — Wednesday, 10:00-14:00, capacity 8
    // Day select — pick Wednesday (value "3")
    const dayTrigger = page.locator('#dayOfWeek')
    await dayTrigger.click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Wednesday' }).click()

    await page.fill('#startTime', '10:00')
    await page.fill('#endTime', '14:00')
    await page.fill('#capacity', '8')

    // Click "Save Pattern"
    const savePatternBtn = page.locator('button').filter({ hasText: 'Save Pattern' })
    await savePatternBtn.click()

    // Verify at least one pattern with "Wednesday" appears in the list
    await expect(page.getByRole('main').getByText('Wednesday').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('main').getByText('8 spots').first()).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-availability.png',
      fullPage: true,
    })
  })

  // ── AC #1 — pattern CRUD persists; the calendar loads (no stuck spinner) ──
  test('pattern create + delete persists to the DB and the calendar renders', async ({
    page,
  }) => {
    const experienceId = await resolveAvailExperienceId(AVAIL_SLUG_PATTERN_CRUD)
    await clearAvailabilityForExperience(experienceId)

    await page.goto(`/vendor/listings/${experienceId}/availability`)
    await expect(page.locator('h1')).toContainText('Availability')

    // The calendar must finish loading — the spinner must NOT be stuck.
    // (Regression guard for the variant-synth #52 "infinite spinner".)
    const spinner = page.locator('.animate-spin')
    await expect(spinner).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByText('Calendar')).toBeVisible()

    // ── Create a pattern via the UI ──────────────────────────────────────
    await page.locator('button').filter({ hasText: 'Add Pattern' }).click()
    await page.locator('#dayOfWeek').click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Wednesday' }).click()
    await page.fill('#startTime', '09:00')
    await page.fill('#endTime', '12:00')
    await page.fill('#capacity', '12')
    await page.locator('button').filter({ hasText: 'Save Pattern' }).click()

    await expect(page.getByText('Pattern created.')).toBeVisible({ timeout: 10_000 })

    // ── Assert: the pattern persisted to availability_patterns ───────────
    let patterns = await getAvailabilityPatterns(experienceId)
    expect(patterns).toHaveLength(1)
    expect(patterns[0].dayOfWeek).toBe(BLOCK_DOW)
    expect(patterns[0].startTime).toBe('09:00')
    expect(patterns[0].endTime).toBe('12:00')
    expect(patterns[0].capacity).toBe(12)

    // ── Delete the pattern via the UI ────────────────────────────────────
    // The pattern row is the bordered flex container that holds the Wednesday
    // badge; its trailing destructive icon button removes the pattern.
    const patternRow = page
      .locator('div.rounded-lg.border')
      .filter({ has: page.getByText('Wednesday') })
      .first()
    await patternRow.locator('button').last().click()
    await expect(page.getByText('Pattern deleted.')).toBeVisible({ timeout: 10_000 })

    // ── Assert: the row is gone from the DB ──────────────────────────────
    patterns = await getAvailabilityPatterns(experienceId)
    expect(patterns).toHaveLength(0)
  })

  // ── AC #1 — materializeSlotsAction generates slots for the next 90 days ──
  test('Generate Slots materialises availability slots for the pattern', async ({
    page,
  }) => {
    const experienceId = await resolveAvailExperienceId(AVAIL_SLUG_MATERIALISE)
    await clearAvailabilityForExperience(experienceId)

    // Seed one weekly Wednesday pattern directly, then drive materialise.
    await page.goto(`/vendor/listings/${experienceId}/availability`)
    await expect(page.locator('.animate-spin')).toHaveCount(0, { timeout: 15_000 })

    await page.locator('button').filter({ hasText: 'Add Pattern' }).click()
    await page.locator('#dayOfWeek').click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Wednesday' }).click()
    await page.fill('#startTime', '06:00')
    await page.fill('#endTime', '09:00')
    await page.fill('#capacity', '10')
    await page.locator('button').filter({ hasText: 'Save Pattern' }).click()
    await expect(page.getByText('Pattern created.')).toBeVisible({ timeout: 10_000 })

    // Click "Generate Slots" (materializeSlotsAction).
    await page.locator('button').filter({ hasText: 'Generate Slots' }).click()
    await expect(page.getByText(/Slots generated:/)).toBeVisible({ timeout: 15_000 })

    // ── Assert: the target Wednesday (2026-07-15) now has exactly one slot ─
    const slots = await getSlotsForExperienceOnDate(experienceId, BLOCK_DATE)
    expect(slots, 'one slot should exist on the target Wednesday').toHaveLength(1)
    const slot = slots[0]
    expect(slot.capacity).toBe(10)
    expect(slot.status).toBe('open')
    // start_at = 06:00 UTC, end_at = 09:00 UTC on 2026-07-15.
    expect(slot.startAt.toISOString()).toBe('2026-07-15T06:00:00.000Z')
    expect(slot.endAt.toISOString()).toBe('2026-07-15T09:00:00.000Z')

    // ── Assert: only Wednesdays are materialised (a Monday has no slot) ────
    const mondaySlots = await getSlotsForExperienceOnDate(experienceId, '2026-07-13')
    expect(mondaySlots).toHaveLength(0)

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-availability-materialise.png',
      fullPage: true,
    })
  })

  // ── AC #2 — block 2026-07-15 removes the bookable slot; unblock restores ─
  test('block a date closes that day’s slot; unblock reopens it', async ({
    page,
  }) => {
    const experienceId = await resolveAvailExperienceId(AVAIL_SLUG_BLOCK)
    await clearAvailabilityForExperience(experienceId)

    // Seed + materialise a Wednesday pattern so 2026-07-15 has a slot.
    await page.goto(`/vendor/listings/${experienceId}/availability`)
    await expect(page.locator('.animate-spin')).toHaveCount(0, { timeout: 15_000 })
    await page.locator('button').filter({ hasText: 'Add Pattern' }).click()
    await page.locator('#dayOfWeek').click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Wednesday' }).click()
    await page.fill('#startTime', '06:00')
    await page.fill('#endTime', '09:00')
    await page.fill('#capacity', '10')
    await page.locator('button').filter({ hasText: 'Save Pattern' }).click()
    await expect(page.getByText('Pattern created.')).toBeVisible({ timeout: 10_000 })
    await page.locator('button').filter({ hasText: 'Generate Slots' }).click()
    await expect(page.getByText(/Slots generated:/)).toBeVisible({ timeout: 15_000 })

    // Pre-condition: an OPEN slot exists on the block date.
    let slots = await getSlotsForExperienceOnDate(experienceId, BLOCK_DATE)
    expect(slots).toHaveLength(1)
    expect(slots[0].status).toBe('open')

    // Navigate the calendar to July 2026 so the block date cell is visible,
    // then drive the Block control the UI exposes (the hover button invokes
    // blockDateAction). The rich calendar UX is the #78 redesign; here we
    // validate the FUNCTIONAL block/unblock path through the current UI.
    await gotoCalendarMonth(page, 'July', 2026)

    // The day-15 cell holds the slot + (on hover) the Block control. The
    // Block button carries title="Block date" but its accessible name is its
    // visible text "Block" (likewise "Unblock").
    const cell = page.locator(`div:has(> div > span:text-is("15"))`).first()
    await cell.scrollIntoViewIfNeeded()
    await cell.hover()
    const blockBtn = cell.getByRole('button', { name: 'Block', exact: true })
    await expect(blockBtn).toBeVisible({ timeout: 10_000 })
    await blockBtn.click()
    await expect(page.getByText(/Blocked 2026-07-15/)).toBeVisible({ timeout: 10_000 })

    // ── Assert: the slot on the block date is now CLOSED (not bookable) ───
    slots = await getSlotsForExperienceOnDate(experienceId, BLOCK_DATE)
    expect(slots).toHaveLength(1)
    expect(slots[0].status).toBe('closed')

    // ── Unblock via the calendar's Unblock control ───────────────────────
    await cell.hover()
    const unblockBtn = cell.getByRole('button', { name: 'Unblock', exact: true })
    await expect(unblockBtn).toBeVisible({ timeout: 10_000 })
    await unblockBtn.click()
    await expect(page.getByText(/Unblocked 2026-07-15/)).toBeVisible({ timeout: 10_000 })

    // ── Assert: the slot is OPEN (bookable) again ────────────────────────
    slots = await getSlotsForExperienceOnDate(experienceId, BLOCK_DATE)
    expect(slots).toHaveLength(1)
    expect(slots[0].status).toBe('open')
  })

  // ── AC #3 — an active region closure hides slots + is shown inline ───────
  test('an active region closure skips slot generation and is shown inline', async ({
    page,
  }) => {
    const experienceId = await resolveAvailExperienceId(AVAIL_SLUG_CLOSURE)
    await clearAvailabilityForExperience(experienceId)

    // Insert an admin monsoon closure over the whole of July 2026 for "goa"
    // (the region of the AVAIL_SLUG experience). Cleaned up in a finally.
    const closureId = await insertRegionClosure({
      regionSlug: 'goa',
      startAt: '2026-07-01T00:00:00.000Z',
      endAt: '2026-08-01T00:00:00.000Z',
      reason: 'Closed for monsoon — reopens August',
      source: 'admin',
    })

    try {
      // Seed a Wednesday pattern, then materialise.
      await page.goto(`/vendor/listings/${experienceId}/availability`)
      await expect(page.locator('.animate-spin')).toHaveCount(0, { timeout: 15_000 })
      await page.locator('button').filter({ hasText: 'Add Pattern' }).click()
      await page.locator('#dayOfWeek').click()
      await page.locator('[data-slot="select-item"]').filter({ hasText: 'Wednesday' }).click()
      await page.fill('#startTime', '06:00')
      await page.fill('#endTime', '09:00')
      await page.fill('#capacity', '10')
      await page.locator('button').filter({ hasText: 'Save Pattern' }).click()
      await expect(page.getByText('Pattern created.')).toBeVisible({ timeout: 10_000 })
      await page.locator('button').filter({ hasText: 'Generate Slots' }).click()
      await expect(page.getByText(/Slots generated:/)).toBeVisible({ timeout: 15_000 })

      // ── Assert: NO slots were materialised inside the July closure ───────
      const julyCount = await countSlotsForExperienceInRange(
        experienceId,
        '2026-07-01',
        '2026-08-01',
      )
      expect(julyCount, 'closure window must have zero materialised slots').toBe(0)
      const onClosedWed = await getSlotsForExperienceOnDate(experienceId, BLOCK_DATE)
      expect(onClosedWed).toHaveLength(0)

      // ── Assert: the closure is shown inline on the vendor calendar ───────
      await gotoCalendarMonth(page, 'July', 2026)
      await expect(
        page.getByText('Closed for monsoon — reopens August').first(),
      ).toBeVisible({ timeout: 10_000 })

      // ── Assert: the closure is shown inline on the CUSTOMER experience ───
      // page (ADR-0011: customers see "closed for monsoon — reopens X").
      await page.goto(`/experience/${AVAIL_SLUG_CLOSURE}`)
      await expect(
        page.getByText(/Closed for monsoon|reopens|monsoon/i).first(),
      ).toBeVisible({ timeout: 10_000 })

      await page.screenshot({
        path: 'tests/e2e/screenshots/vendor-availability-closure.png',
        fullPage: true,
      })
    } finally {
      await deleteRegionClosure(closureId)
    }
  })

  // ── #78 — variant A "calendar-first cockpit": the Calendar | Manifest
  //    toggle (B6) is present and switches views, and the calendar renders an
  //    in-grid semantic status badge for materialised slots. New behaviour
  //    over the #18 functional pass — does not restate pattern/slot coverage.
  test('exposes the Calendar | Manifest toggle and an in-grid status badge', async ({
    page,
  }) => {
    const experienceId = await resolveAvailExperienceId(AVAIL_SLUG_PATTERN_CRUD)
    await clearAvailabilityForExperience(experienceId)

    await page.goto(`/vendor/listings/${experienceId}/availability`)
    await expect(page.locator('.animate-spin')).toHaveCount(0, { timeout: 15_000 })

    // The B6 calendar ⇄ manifest toggle exists with both view tabs.
    const toggle = page.getByTestId('availability-view-toggle')
    await expect(toggle).toBeVisible()
    await expect(page.getByTestId('view-tab-calendar')).toBeVisible()
    await expect(page.getByTestId('view-tab-manifest')).toBeVisible()

    // Seed + materialise a Wednesday pattern so July 2026 has open slots.
    // (The weekly-pattern rule editor is open by default, demoted below the
    //  calendar; the manage-rules toggle collapses/expands it.)
    await page.locator('button').filter({ hasText: 'Add Pattern' }).click()
    await page.locator('#dayOfWeek').click()
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Wednesday' }).click()
    await page.fill('#startTime', '06:00')
    await page.fill('#endTime', '09:00')
    await page.fill('#capacity', '10')
    await page.locator('button').filter({ hasText: 'Save Pattern' }).click()
    await expect(page.getByText('Pattern created.')).toBeVisible({ timeout: 10_000 })
    await page.locator('button').filter({ hasText: 'Generate Slots' }).click()
    await expect(page.getByText(/Slots generated:/)).toBeVisible({ timeout: 15_000 })

    // In-grid status badge — the materialised, unbooked Wednesday reads "Open"
    // with a remaining-spots count in its day cell (semantic status, not bare
    // text). Navigate to July 2026 where the slot lives.
    await gotoCalendarMonth(page, 'July', 2026)
    const blockCell = page.getByTestId(`calendar-day-${BLOCK_DATE}`)
    await blockCell.scrollIntoViewIfNeeded()
    await expect(blockCell.getByText(/spots/i)).toBeVisible({ timeout: 10_000 })

    // Switch to the Manifest / Roster view — the toggle changes the surface.
    await page.getByTestId('view-tab-manifest').click()
    await expect(page.getByTestId('manifest-view')).toBeVisible({ timeout: 10_000 })

    // And back to Calendar.
    await page.getByTestId('view-tab-calendar').click()
    await expect(page.getByText(/Month view/i)).toBeVisible({ timeout: 10_000 })
  })
})

/** Navigate the availability calendar to a specific month + year. */
async function gotoCalendarMonth(
  page: import('@playwright/test').Page,
  monthName: string,
  year: number,
): Promise<void> {
  const MONTH_LABEL =
    /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/
  // The month label is the only span matching "<Month> <Year>". The two
  // calendar-nav icon buttons sit immediately before/after it; "next" is the
  // last icon-sm button in the Calendar card header.
  const label = page.locator('span').filter({ hasText: MONTH_LABEL }).first()
  await expect(label).toBeVisible({ timeout: 10_000 })
  const next = page
    .locator('button')
    .filter({ has: page.locator('svg.lucide-chevron-right') })
    .first()

  // Click forward until the label matches the target (guard against runaway).
  for (let i = 0; i < 24; i++) {
    const current = (await label.textContent())?.trim() ?? ''
    if (current === `${monthName} ${year}`) return
    await next.click()
    // Allow the month-change transition + data load to settle.
    await expect(page.locator('.animate-spin')).toHaveCount(0, { timeout: 10_000 })
  }
  throw new Error(`Could not navigate calendar to ${monthName} ${year}`)
}

// ---------------------------------------------------------------------------
// 6. Bookings page — smoke test
// ---------------------------------------------------------------------------
test.describe('Vendor bookings', () => {
  test('loads bookings page with heading and table structure', async ({
    page,
  }) => {
    const response = await page.goto('/vendor/bookings')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Bookings')

    // Count subtitle is visible
    await expect(page.getByText(/\d+ booking/)).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-bookings.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 7. Payouts page — smoke test
// ---------------------------------------------------------------------------
test.describe('Vendor payouts', () => {
  test('loads payouts page with earnings summary', async ({ page }) => {
    const response = await page.goto('/vendor/payouts')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Payouts')

    // Earnings summary cards are visible. "Gross earnings" / "Net payout"
    // appear both as a headline card and as a breakdown line, so match the
    // first occurrence.
    await expect(page.getByText('Gross earnings').first()).toBeVisible()
    await expect(page.getByText('Commission', { exact: true })).toBeVisible()
    await expect(page.getByText('Net payout').first()).toBeVisible()

    // Payout method section
    await expect(page.getByText('Payout method')).toBeVisible()

    // How payouts work section
    await expect(page.getByText('How payouts work')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-payouts.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 8. Reviews page — smoke test
// ---------------------------------------------------------------------------
test.describe('Vendor reviews', () => {
  test('loads reviews page with heading', async ({ page }) => {
    const response = await page.goto('/vendor/reviews')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Reviews')

    // Either the empty state or the review list is visible
    const hasReviews = await page.getByText(/\d+ review/).isVisible().catch(() => false)
    if (!hasReviews) {
      await expect(page.getByText('No reviews yet')).toBeVisible()
    }

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-reviews.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 9. Messages page — smoke test
// ---------------------------------------------------------------------------
test.describe('Vendor messages', () => {
  test('loads messages page with heading', async ({ page }) => {
    const response = await page.goto('/vendor/messages')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Messages')

    // The seed (#20) provides one Conversation, so the inbox lists it rather
    // than the static "No messages yet" empty state (variant-synth #55).
    await expect(page.getByText('No messages yet')).toHaveCount(0)
    await expect(
      page.getByText('Question about the Bir-Billing flight window'),
    ).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-messages.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 10. Settings page — smoke test
// ---------------------------------------------------------------------------
test.describe('Vendor settings', () => {
  test('loads settings page with tabs', async ({ page }) => {
    const response = await page.goto('/vendor/settings')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Settings')

    // Tabs are visible — Business details, Payout method, KYC documents
    await expect(page.getByRole('tab', { name: 'Business details' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Payout method' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'KYC documents' })).toBeVisible()

    // Default tab (business) content is visible
    await expect(page.getByRole('tabpanel')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-settings.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 11. Vendor booking management (#19) — mark-complete, vendor-cancel, booking
//     detail (payment timeline + commission), dashboard stats. Drives the
//     real UI controls and asserts against the E2E database.
//
//     The business-tier Vendor (u_seed_v_business — this project's session)
//     owns three seeded manageable Bookings (db/seed.ts, owned by the
//     dedicated u_seed_customer_biz):
//       - awaiting_completion on goa-scuba-diving-fun-dive-cert (partial_pay)
//       - confirmed           on bir-billing-camping-mountain-stay (full_upfront)
//       - disputed            on goa-scuba-diving-padi-dsd (partial_pay)
//
//     Serial: the vendor-cancel test DECREASES the shared Vendor's
//     Response-time SLA score, so these tests run in a fixed order and the
//     dashboard test reads its SLA value live from the DB rather than
//     hard-coding it.
// ---------------------------------------------------------------------------
const FUN_DIVE_SLUG = 'goa-scuba-diving-fun-dive-cert'
const CAMPING_SLUG = 'bir-billing-camping-mountain-stay'
const PADI_DSD_SLUG = 'goa-scuba-diving-padi-dsd'
const SLA_CANCEL_PENALTY = 5

test.describe('Vendor booking management (#19)', () => {
  test.describe.configure({ mode: 'serial' })

  // ── AC#1 — mark-complete after start_at → completed + Payout countdown ────
  test('mark-complete transitions awaiting_completion → completed and starts the Payout countdown', async ({
    page,
  }) => {
    const booking = await getVendorBookingByStateAndSlug(
      SEED_BUSINESS_VENDOR_ID,
      FUN_DIVE_SLUG,
      'awaiting_completion',
    )
    expect(
      booking,
      'seed must provide an awaiting_completion business-vendor booking',
    ).not.toBeNull()
    const bookingId = booking!.id

    // Pre-condition: not yet completed; payout still pending (no countdown).
    const before = await getBookingLifecycle(bookingId)
    expect(before!.state).toBe('awaiting_completion')
    expect(before!.completedAt).toBeNull()

    await page.goto(`/vendor/bookings/${bookingId}`)
    await expect(page.locator('h1')).toContainText('Booking Detail')

    // The detail page offers the Mark Complete control for this state.
    const markCompleteBtn = page.getByRole('button', { name: 'Mark Complete' })
    await expect(markCompleteBtn).toBeVisible()
    await markCompleteBtn.click()

    // The badge flips to "completed" once the action resolves + page refreshes.
    await expect(page.getByText('completed', { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    })

    // ── Assert: state machine advanced + completion timestamp set ─────────
    const after = await getBookingLifecycle(bookingId)
    expect(after!.state).toBe('completed')
    expect(after!.completedAt, 'completedAt anchors the T+7 Payout countdown').not.toBeNull()
    // ADR-0016: the Payout countdown is T+7 from Completion; payout is still
    // pending admin processing (the countdown just started).
    expect(after!.payoutState).toBe('pending')
    expect(after!.autoCompleted).toBe(false)

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-mark-complete.png',
      fullPage: true,
    })
  })

  // ── AC#1 — mark-complete is BLOCKED while a Dispute is open (ADR-0003) ────
  test('mark-complete is blocked for a disputed booking (no completion control, no transition)', async ({
    page,
  }) => {
    const booking = await getVendorBookingByStateAndSlug(
      SEED_BUSINESS_VENDOR_ID,
      PADI_DSD_SLUG,
      'disputed',
    )
    expect(booking, 'seed must provide a disputed business-vendor booking').not.toBeNull()
    const bookingId = booking!.id

    await page.goto(`/vendor/bookings/${bookingId}`)
    await expect(page.locator('h1')).toContainText('Booking Detail')

    // The dispute state is surfaced on the detail page.
    await expect(page.getByText('disputed', { exact: false }).first()).toBeVisible()

    // ADR-0003: an open Dispute BLOCKS completion — the Mark Complete control
    // must NOT be offered for a disputed Booking.
    await expect(page.getByRole('button', { name: 'Mark Complete' })).toHaveCount(0)

    // ── Assert: the Booking is still disputed (no transition occurred) ────
    const after = await getBookingLifecycle(bookingId)
    expect(after!.state).toBe('disputed')
    expect(after!.completedAt).toBeNull()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-mark-complete-blocked.png',
      fullPage: true,
    })
  })

  // ── AC#2 — vendor-cancel: reason required + full refund + SLA score drop ──
  test('vendor-cancel requires a reason, issues a full refund, and drops the SLA score', async ({
    page,
  }) => {
    const booking = await getVendorBookingByStateAndSlug(
      SEED_BUSINESS_VENDOR_ID,
      CAMPING_SLUG,
      'confirmed',
    )
    expect(booking, 'seed must provide a confirmed business-vendor booking').not.toBeNull()
    const bookingId = booking!.id
    const grossRupees = booking!.grossRupees
    const customerUserId = booking!.customerUserId

    const slaBefore = await getVendorSlaScore(SEED_BUSINESS_VENDOR_ID)
    expect(Number.isFinite(slaBefore)).toBe(true)

    await page.goto(`/vendor/bookings/${bookingId}`)
    await expect(page.locator('h1')).toContainText('Booking Detail')

    // Open the cancel form.
    await page.getByRole('button', { name: 'Cancel Booking' }).click()
    const reasonField = page.getByPlaceholder(/Reason for cancellation/i)
    await expect(reasonField).toBeVisible()

    // A reason is REQUIRED — confirming with an empty reason surfaces the
    // inline validation error and does NOT cancel.
    await page.getByRole('button', { name: 'Confirm Cancellation' }).click()
    await expect(page.getByText(/cancellation reason is required/i)).toBeVisible()

    // Still confirmed — the empty submit was rejected client-side.
    expect((await getBookingLifecycle(bookingId))!.state).toBe('confirmed')

    // Now supply a reason and confirm.
    const reason = 'Guide injured — cannot run this date safely'
    await reasonField.fill(reason)
    await page.getByRole('button', { name: 'Confirm Cancellation' }).click()

    // The badge flips to the vendor-cancelled state once the action resolves.
    await expect(
      page.getByText('cancelled by vendor', { exact: false }).first(),
    ).toBeVisible({ timeout: 15_000 })

    // ── Assert: state transition + reason persisted ──────────────────────
    const after = await getBookingLifecycle(bookingId)
    expect(after!.state).toBe('cancelled_by_vendor')
    expect(after!.cancelledAt).not.toBeNull()
    expect(after!.cancellationReason).toBe(reason)

    // ── Assert: FULL refund regardless of preset (ADR-0005) ──────────────
    // The cancellation preset is "flexible", but vendor-cancel always
    // full-refunds the gross. Assert via the credited refund_requests row +
    // the immutable wallet-credit audit (race-free proof of the bucket).
    const refundReq = await getRefundRequestForBooking(bookingId)
    expect(refundReq).not.toBeNull()
    expect(refundReq!.state).toBe('credited')
    expect(refundReq!.destination).toBe('refund_balance')
    expect(refundReq!.reason).toBe('vendor_cancelled')
    expect(refundReq!.policyWindowBasisSnapshot).toBe('vendor_cancelled')
    expect(refundReq!.amount, 'full gross refunded regardless of preset').toBe(grossRupees)

    const creditAudit = await getRefundBalanceCreditAuditForBooking(bookingId)
    expect(creditAudit).not.toBeNull()
    expect(creditAudit!.amountRupees).toBe(grossRupees)
    expect(creditAudit!.userId).toBe(customerUserId)

    // ── Assert: the Vendor's Response-time SLA score DROPPED ──────────────
    const slaAfter = await getVendorSlaScore(SEED_BUSINESS_VENDOR_ID)
    expect(slaAfter).toBeLessThan(slaBefore)
    expect(slaAfter).toBeCloseTo(Math.max(slaBefore - SLA_CANCEL_PENALTY, 0), 2)

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-cancel.png',
      fullPage: true,
    })
  })

  // ── AC#3 — booking detail shows the payment timeline + Commission ────────
  test('booking detail shows the partial-pay payment timeline and commission breakdown', async ({
    page,
  }) => {
    // The awaiting_completion fun-dive booking was marked complete by the
    // first test in this serial block, so resolve it by its current state.
    const booking = await getVendorBookingByStateAndSlug(
      SEED_BUSINESS_VENDOR_ID,
      FUN_DIVE_SLUG,
      'completed',
    )
    expect(
      booking,
      'the partial-pay fun-dive booking should exist (completed after mark-complete)',
    ).not.toBeNull()
    const bookingId = booking!.id
    const grossRupees = booking!.grossRupees

    // Sanity: the seed funded this Booking with a REAL partial-pay schedule
    // (Advance at booking-create + balance at T-24h), so the timeline panel
    // must render those events — not the dead "No payments recorded yet"
    // empty state flagged by variant-synth #53.
    const payments = await getPaymentsForBooking(bookingId)
    expect(payments.length, 'seeded partial-pay funding timeline').toBe(2)
    expect(payments.map((p) => p.captureTrigger)).toEqual([
      'booking_create',
      'auto_capture_t_minus_24h',
    ])
    expect(payments[0].amountRupees + payments[1].amountRupees).toBe(grossRupees)

    await page.goto(`/vendor/bookings/${bookingId}`)
    await expect(page.locator('h1')).toContainText('Booking Detail')

    // ── Payment Timeline panel shows the REAL events (not the empty state) ─
    const timeline = page
      .locator('div')
      .filter({ has: page.getByText('Payment Timeline') })
      .first()
    await expect(page.getByText('Payment Timeline')).toBeVisible()
    await expect(page.getByText('No payments recorded yet.')).toHaveCount(0)
    // The Advance (booking-create) and the T-24h balance capture both render.
    await expect(page.getByText('Initial capture')).toBeVisible()
    await expect(page.getByText('T-24h auto-capture')).toBeVisible()
    // Both capture amounts appear (formatted with the ₹ + thousands sep).
    await expect(
      timeline.getByText(`₹${payments[0].amountRupees.toLocaleString('en-IN')}`),
    ).toBeVisible()
    await expect(
      timeline.getByText(`₹${payments[1].amountRupees.toLocaleString('en-IN')}`),
    ).toBeVisible()

    // ── Commission breakdown panel ───────────────────────────────────────
    await expect(page.getByText('Commission Breakdown')).toBeVisible()
    await expect(page.getByText('Gross Total')).toBeVisible()
    // 20% commission on the gross is surfaced as a negative line item.
    const commissionRupees = Math.floor(grossRupees * 0.2)
    await expect(page.getByText('Commission (20%)')).toBeVisible()
    await expect(
      page.getByText(`-₹${commissionRupees.toLocaleString('en-IN')}`),
    ).toBeVisible()
    await expect(page.getByText('Estimated Vendor Payout')).toBeVisible()

    // ── #79 direction A — canonical Money-State Timeline rail ─────────────
    // The Lifecycle + Payments are collapsed into ONE chronological vertical
    // rail. For this completed partial-pay Booking the rail must carry the
    // Created → Confirmed → Advance captured → balance auto-captured at T-24h
    // → Completed nodes, each on a stable data-testid, driven by REAL data.
    const rail = page.getByTestId('booking-timeline')
    await expect(rail).toBeVisible()
    await expect(rail.getByTestId('timeline-node-created')).toBeVisible()
    await expect(rail.getByTestId('timeline-node-confirmed')).toBeVisible()
    // The Partial-pay Advance + T-24h balance both render as money nodes
    // (fixes the dead empty state the as-is page showed).
    const advanceNode = rail.getByTestId('timeline-node-payment-advance')
    const balanceNode = rail.getByTestId('timeline-node-payment-balance')
    await expect(advanceNode).toBeVisible()
    await expect(balanceNode).toBeVisible()
    await expect(
      advanceNode.getByText(`₹${payments[0].amountRupees.toLocaleString('en-IN')}`),
    ).toBeVisible()
    await expect(
      balanceNode.getByText(`₹${payments[1].amountRupees.toLocaleString('en-IN')}`),
    ).toBeVisible()
    await expect(rail.getByTestId('timeline-node-completed')).toBeVisible()

    // The Advance node sits above the balance node in the DOM (chronology).
    const advanceBox = await advanceNode.boundingBox()
    const balanceBox = await balanceNode.boundingBox()
    expect(advanceBox).not.toBeNull()
    expect(balanceBox).not.toBeNull()
    expect(advanceBox!.y).toBeLessThan(balanceBox!.y)

    // ── #79 direction A — payout-hero sticky rail ────────────────────────
    // Estimated Vendor Payout is the visual HERO, showing the full
    // Gross → Commission → GST → TDS → TCS → Net Payout waterfall the payout
    // calculator returns. The Net Payout figure renders prominently as the
    // hero, in tabular numerics.
    const hero = page.getByTestId('net-payout-hero')
    await expect(hero).toBeVisible()
    // Net Payout = gross − commission − GST(18% on commission) − TDS − TCS,
    // matching computeVendorNetPayout over the snapshot columns (db/seed.ts
    // sets TDS = floor(0.1% of gross); TCS defaults to 0 for these seeds).
    const gstOnCommission = Math.floor(commissionRupees * 0.18)
    const tdsRupees = Math.floor(grossRupees * 0.001)
    const netPayout = grossRupees - commissionRupees - gstOnCommission - tdsRupees
    await expect(hero.getByText(`₹${netPayout.toLocaleString('en-IN')}`)).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-booking-detail.png',
      fullPage: true,
    })
  })

  // ── AC#4 — dashboard stats reflect the seeded business-vendor bookings ───
  test('dashboard stats reflect the business-vendor bookings and live SLA score', async ({
    page,
  }) => {
    await page.goto('/vendor/dashboard')
    await expect(page.locator('h1')).toContainText('Dashboard')

    // The "total all time" booking count must reflect the seeded + mutated
    // business-vendor bookings. Count them live from the DB for a race-free
    // assertion (other serial tests above mutate states, not counts).
    const totalBookings = await countBusinessVendorBookings()
    expect(totalBookings).toBeGreaterThanOrEqual(5)
    await expect(
      page.getByText(new RegExp(`${totalBookings} total all time`)),
    ).toBeVisible()

    // Revenue cards render real rupee figures (non-empty), reflecting the
    // seeded gross + captured payments.
    await expect(page.getByText("This month's revenue")).toBeVisible()
    await expect(page.getByText('SLA score')).toBeVisible()

    // The SLA score card shows the LIVE score (dropped by the vendor-cancel
    // test earlier in this serial block).
    const slaScore = await getVendorSlaScore(SEED_BUSINESS_VENDOR_ID)
    await expect(
      page.getByText(new RegExp(`${slaScore.toFixed(1)}%`)),
    ).toBeVisible()

    // ── C "Insight-First Growth Hub" rail (#74) — REAL-data insights ──────
    // A1: the business verified-Vendor badge surfaces (business KYC tier).
    await expect(page.getByTestId('verified-vendor-badge')).toBeVisible()

    // C: the ranked Insights rail renders with at least the top-performer
    // insight — the business Vendor owns ≥5 Bookings across Experiences, so a
    // most-booked Experience is always derivable (no fabrication).
    await expect(page.getByTestId('insights-rail')).toBeVisible()
    await expect(page.getByTestId('insight-top_performer')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-dashboard-stats.png',
      fullPage: true,
    })
  })
})

/** Count all Bookings owned by the business-tier seed Vendor. */
async function countBusinessVendorBookings(): Promise<number> {
  const sql = postgres(e2eDbUrl(), { max: 1 })
  try {
    const rows = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n
      FROM bookings b
      JOIN experiences e ON b.experience_id = e.id
      WHERE e.vendor_user_id = ${SEED_BUSINESS_VENDOR_ID}
    `
    return Number(rows[0]?.n ?? '0')
  } finally {
    await sql.end()
  }
}

// ---------------------------------------------------------------------------
// 12. Vendor reviews — respond functionally (#20)
//
//     The business Vendor owns one seeded published Review with no response
//     yet (db/seed.ts, on goa-scuba-diving-fun-dive-cert). Submitting a
//     response persists it; a SECOND response must be rejected — exactly one
//     public response per Review (executeSubmitVendorResponse guard). After
//     a response exists the UI no longer offers any compose control, so the
//     single-response invariant holds end-to-end.
// ---------------------------------------------------------------------------
test.describe('Vendor review responses (#20)', () => {
  test('submit one response → persists; the compose control then disappears (exactly one)', async ({
    page,
  }) => {
    const review = await getVendorReviewAwaitingResponse(SEED_BUSINESS_VENDOR_ID)
    expect(
      review,
      'seed must provide a business-vendor review awaiting a response',
    ).not.toBeNull()
    const reviewId = review!.id

    // Pre-condition: no response yet.
    const before = await getReviewResponse(reviewId)
    expect(before!.vendorResponse).toBeNull()

    await page.goto('/vendor/reviews')
    await expect(page.locator('h1')).toContainText('Reviews')

    // The Review card is in the list (data, not the dead empty state #54).
    await expect(page.getByText('No reviews yet')).toHaveCount(0)
    await expect(page.getByText('Best dive of the trip')).toBeVisible()

    // Open the compose form for the (single) un-responded Review and submit.
    const responseText = 'Thank you so much — it was a pleasure diving with you. See you next season!'
    await page.getByRole('button', { name: 'Respond' }).first().click()
    await page.getByPlaceholder('Write your response...').fill(responseText)
    await page.getByRole('button', { name: 'Submit Response' }).click()

    // The response renders inline once the action resolves.
    await expect(page.getByText(responseText)).toBeVisible({ timeout: 15_000 })

    // ── Assert: the response persisted exactly once ──────────────────────
    // Poll the DB to absorb any cross-connection commit-visibility lag
    // between the client transition resolving and the row being readable.
    await expect
      .poll(async () => (await getReviewResponse(reviewId))!.vendorResponse, {
        timeout: 10_000,
      })
      .toBe(responseText)
    const after = await getReviewResponse(reviewId)
    expect(after!.respondedAt).not.toBeNull()

    // ── Reload → the stored response is shown and there is NO compose
    //     control any more (the UI enforces a single public response). ─────
    await page.reload()
    await expect(page.getByText(responseText)).toBeVisible()
    await expect(page.getByText('Your response')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Respond' })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Submit Response' }),
    ).toHaveCount(0)

    // ── Assert: the DB still holds exactly one non-null response for it ───
    const stillOne = await getReviewResponse(reviewId)
    expect(stillOne!.vendorResponse).toBe(responseText)

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-review-response.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 13. Vendor payouts — the ADR-0016 deduction breakdown (#20)
//
//     The payouts view must surface the full waterfall:
//       gross − Commission − GST(18% on commission) − TDS(0.1% Sec 194-O)
//             − GST TCS(0.5% Sec 52) = net
//     The seed funds a completed Booking with round worked-example math
//     (gross ₹100,000 → net ₹75,800). We assert (a) the worked example is
//     exact and (b) the page's displayed totals equal the sum over all of
//     the Vendor's earning Bookings via computeVendorNetPayout.
// ---------------------------------------------------------------------------
test.describe('Vendor payouts breakdown (#20)', () => {
  test('shows gross − commission − GST − TDS − TCS = net matching a worked example', async ({
    page,
  }) => {
    // ── The worked example (the seeded ₹100,000 Booking, ADR-0016) ───────
    const worked = computeVendorNetPayout({
      grossRupees: 100_000,
      commissionRatePercent: '20.00',
      gstRateOnCommissionPercent: '18.00',
      tdsRupees: 100, // 0.1% of 100,000
      tcsRupees: 500, // 0.5% of 100,000
    })
    expect(worked.commissionRupees).toBe(20_000)
    expect(worked.gstOnCommissionRupees).toBe(3_600)
    expect(worked.netPayoutRupees).toBe(75_800)

    // ── Expected page TOTALS: sum the breakdown over every earning Booking.
    //     Robust to the #19 serial mutations (state stays in the earning set)
    //     and to whatever else the seed leaves completed/awaiting. ─────────
    const earning = await getVendorEarningBookings(SEED_BUSINESS_VENDOR_ID)
    expect(
      earning.length,
      'business vendor must have at least the seeded earning bookings',
    ).toBeGreaterThanOrEqual(1)

    const totals = earning.reduce(
      (acc, b) => {
        const bd = computeVendorNetPayout(b)
        return {
          gross: acc.gross + bd.grossRupees,
          commission: acc.commission + bd.commissionRupees,
          gst: acc.gst + bd.gstOnCommissionRupees,
          tds: acc.tds + bd.tdsRupees,
          tcs: acc.tcs + bd.tcsRupees,
          net: acc.net + bd.netPayoutRupees,
        }
      },
      { gross: 0, commission: 0, gst: 0, tds: 0, tcs: 0, net: 0 },
    )
    // The waterfall must reconcile: gross − all deductions === net.
    expect(
      totals.gross - totals.commission - totals.gst - totals.tds - totals.tcs,
    ).toBe(totals.net)

    await page.goto('/vendor/payouts')
    await expect(page.locator('h1')).toContainText('Payouts')

    // The breakdown block is present (regression guard for the "reconcile
    // nothing" variant-synth flag #54 — the page now surfaces every line).
    await expect(
      page.getByText('Payout breakdown', { exact: true }),
    ).toBeVisible()

    const breakdown = page
      .locator('dl')
      .filter({ has: page.getByText('GST on commission (18%)') })
      .first()

    // Each deduction LINE is present and shows the summed amount.
    const inr = (n: number) => n.toLocaleString('en-IN')
    await expect(
      breakdown.getByText(`₹${inr(totals.gross)}`),
    ).toBeVisible()
    await expect(
      breakdown.getByText(`-₹${inr(totals.commission)}`),
    ).toBeVisible()
    await expect(page.getByText('GST on commission (18%)')).toBeVisible()
    await expect(
      breakdown.getByText(`-₹${inr(totals.gst)}`),
    ).toBeVisible()
    await expect(page.getByText('TDS (0.1%, Sec 194-O)')).toBeVisible()
    await expect(
      breakdown.getByText(`-₹${inr(totals.tds)}`),
    ).toBeVisible()
    await expect(page.getByText('GST TCS (0.5%, Sec 52)')).toBeVisible()
    await expect(
      breakdown.getByText(`-₹${inr(totals.tcs)}`),
    ).toBeVisible()
    // Net payout appears as the breakdown footer AND the headline card.
    await expect(
      page.getByText(`₹${inr(totals.net)}`).first(),
    ).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-payouts-breakdown.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 14. Vendor settings — business details + payout method persist (#20)
// ---------------------------------------------------------------------------
test.describe('Vendor settings persistence (#20)', () => {
  test('update business details → persists across reload (DB + form)', async ({
    page,
  }) => {
    // Deterministic new values. The slug stays the seed slug so we never
    // collide with another vendor's unique slug; we mutate name + about.
    const before = await getVendorProfileSettings(SEED_BUSINESS_VENDOR_ID)
    expect(before).not.toBeNull()
    const newAbout = `Goa's longest-running PADI dive center. Updated ${Date.now()}.`

    await page.goto('/vendor/settings')
    await expect(page.locator('h1')).toContainText('Settings')

    // Business tab is the default; update the About field and save.
    await page.locator('#about').fill(newAbout)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Business details updated.')).toBeVisible({
      timeout: 15_000,
    })

    // ── Assert: persisted to the DB ──────────────────────────────────────
    const afterSave = await getVendorProfileSettings(SEED_BUSINESS_VENDOR_ID)
    expect(afterSave!.about).toBe(newAbout)
    expect(afterSave!.slug).toBe(before!.slug)

    // ── Assert: survives reload (the form re-populates from the DB) ──────
    await page.reload()
    await expect(page.locator('#about')).toHaveValue(newAbout)
  })

  test('update payout method → persists + 7-day cooling-off notice (ADR-0016)', async ({
    page,
  }) => {
    // Switch to a UPI destination with a deterministic VPA, then assert it
    // persists and the cooling-off notice (destination changed < 7 days ago)
    // is shown.
    const newVpa = `goadive${Date.now()}@okhdfcbank`

    await page.goto('/vendor/settings')
    await expect(page.locator('h1')).toContainText('Settings')

    // Open the Payout method tab.
    await page.getByRole('tab', { name: 'Payout method' }).click()

    // Choose UPI and fill the VPA.
    await page.getByRole('radio', { name: 'UPI VPA' }).click()
    await page.locator('#vpa').fill(newVpa)
    await page.getByRole('button', { name: 'Update payout method' }).click()

    // Success banner mentions the 7-day cooling-off (ADR-0016).
    await expect(page.getByText(/7-day cooling-off/i)).toBeVisible({
      timeout: 15_000,
    })

    // ── Assert: persisted to the DB with a fresh changed-at timestamp ────
    const afterSave = await getVendorProfileSettings(SEED_BUSINESS_VENDOR_ID)
    expect(afterSave!.payoutMethod).toBe('upi')
    expect((afterSave!.payoutDestination as { vpa?: string }).vpa).toBe(newVpa)
    expect(afterSave!.payoutDestinationChangedAt).not.toBeNull()
    // The change just happened, so the cooling-off window is active.
    const changedMsAgo =
      Date.now() - new Date(afterSave!.payoutDestinationChangedAt!).getTime()
    expect(changedMsAgo).toBeLessThan(7 * 24 * 60 * 60 * 1000)

    // ── Assert: the persisted VPA + cooling-off notice survive a reload ──
    await page.reload()
    await page.getByRole('tab', { name: 'Payout method' }).click()
    await expect(page.locator('#vpa')).toHaveValue(newVpa)
    await expect(page.getByText(/cooling-off period/i)).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-settings-payout.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 15. Vendor messages — list + thread render real content (#20)
//
//     The seed adds one active Conversation with two messages. The inbox must
//     list it (not the static "No messages yet" empty state #55), and the
//     thread must render both messages.
// ---------------------------------------------------------------------------
test.describe('Vendor messages (#20)', () => {
  const SEED_CONVERSATION_SUBJECT =
    'Question about the Bir-Billing flight window'

  test('inbox lists the seeded conversation and the thread renders its messages', async ({
    page,
  }) => {
    const convo = await getVendorConversationBySubject(
      SEED_BUSINESS_VENDOR_ID,
      SEED_CONVERSATION_SUBJECT,
    )
    expect(convo, 'seed must provide a business-vendor conversation').not.toBeNull()
    expect(convo!.messageCount).toBe(2)

    // ── Inbox: the conversation is listed (NOT the empty state) ──────────
    await page.goto('/vendor/messages')
    await expect(page.locator('h1')).toContainText('Messages')
    await expect(page.getByText('No messages yet')).toHaveCount(0)
    await expect(page.getByText(SEED_CONVERSATION_SUBJECT)).toBeVisible()

    // Open the thread by clicking the conversation card.
    await page.getByText(SEED_CONVERSATION_SUBJECT).click()
    await page.waitForURL(new RegExp(`/vendor/messages/${convo!.id}`))

    // ── Thread: both seeded messages render (not the dead empty state) ───
    await expect(
      page.getByText('No messages in this conversation yet.'),
    ).toHaveCount(0)
    await expect(
      page.getByText(/what time window gives the best thermals/i),
    ).toBeVisible()
    await expect(
      page.getByText(/Late morning, around 10:30–12:00/i),
    ).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-messages-thread.png',
      fullPage: true,
    })
  })
})
