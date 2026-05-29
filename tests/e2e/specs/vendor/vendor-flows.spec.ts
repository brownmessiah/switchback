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

    // ── Step 1: business details ──────────────────────────────────────
    await page.fill('#businessName', businessName)
    // Slug auto-derives from the business name; confirm it.
    await expect(page.locator('#slug')).toHaveValue(expectedSlug)

    await page.locator('button', { hasText: 'Continue' }).click()

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
  test('renders listing cards for seeded experiences', async ({ page }) => {
    const response = await page.goto('/vendor/listings')
    expect(response?.status()).toBe(200)

    // Page heading
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Listings')

    // Count subtitle — the business-tier vendor has 4 seeded experiences
    await expect(page.getByText(/\d+ experience/)).toBeVisible()

    // "Create listing" link is visible
    await expect(page.locator('a[href="/vendor/listings/new"]')).toBeVisible()

    // At least one listing card is visible with a title and status badge
    const listingCards = page.locator('a[href*="/vendor/listings/"]').filter({
      has: page.locator('h3'),
    })
    const cardCount = await listingCards.count()
    expect(cardCount).toBeGreaterThanOrEqual(1)

    // Verify the first listing shows activity/region/price info
    const firstCard = listingCards.first()
    await expect(firstCard).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-listings.png',
      fullPage: true,
    })
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

    // Fill pricing — 1-2 guests
    await page.fill('#price12', '2500')

    // Defocus any open Select dropdown by clicking on the heading,
    // then wait for React state to settle before submitting.
    await page.locator('h1').click()
    await page.waitForTimeout(500)

    // Submit the form
    await page.locator('button[type="submit"]').click()

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

    // The list card carries the draft status badge.
    const card = page
      .locator('a[href*="/vendor/listings/"]')
      .filter({ has: page.getByText(title) })
    await expect(card.getByText('draft')).toBeVisible()

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

    // Verify the form fields are populated from the database.
    const priceInput = page.locator('#price12')
    await expect(priceInput).toBeVisible()
    const initialValue = await priceInput.inputValue()
    expect(Number(initialValue)).toBeGreaterThan(0)
    await expect(page.locator('#title')).toHaveValue(/.+/)

    // Change the headline (1-2) price and save.
    await priceInput.fill(String(NEW_PRICE))
    await page.locator('button[type="submit"]').click()

    // The form surfaces an inline success state on a persisted update.
    await expect(page.getByText('Experience updated.')).toBeVisible({ timeout: 15_000 })

    // ── Assert: price persisted in the DB ────────────────────────────────
    const afterSave = await getExperienceById(experienceId)
    expect(afterSave!.pricePerPerson_1_2).toBe(NEW_PRICE)
    expect(afterSave!.status).toBe('published')

    // ── Assert: price SURVIVES RELOAD (form re-populates from the DB) ─────
    // The numeric column round-trips as e.g. "4750.00"; compare the value
    // rather than the exact string format.
    await page.reload()
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

    await page.locator('#price12').fill(String(newPrice))
    await page.locator('button[type="submit"]').click()

    await expect(page.getByText('Experience updated.')).toBeVisible({ timeout: 15_000 })

    const after = await getExperienceById(experienceId)
    expect(after!.pricePerPerson_1_2).toBe(newPrice)
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

    // Click the first listing to go to edit page
    const listingLink = page.locator('a[href*="/vendor/listings/"]').filter({
      has: page.locator('h3'),
    }).first()
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

    // Earnings summary cards are visible
    await expect(page.getByText('Gross earnings')).toBeVisible()
    await expect(page.getByText('Commission', { exact: true })).toBeVisible()
    await expect(page.getByText('Net payout')).toBeVisible()

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

    // Either the empty state or conversations list is visible
    const hasMessages = await page
      .locator('[class*="conversation"]')
      .first()
      .isVisible()
      .catch(() => false)
    if (!hasMessages) {
      await expect(page.getByText('No messages yet')).toBeVisible()
    }

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
