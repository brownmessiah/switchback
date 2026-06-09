/**
 * Cross-surface E2E: Review photo upload → admin moderation → PDP render
 * (issue 19, DECISION D0/D5). @cross-surface
 *
 * Proves the end-to-end claim:
 *   Customer attaches a photo to their completed-Booking Review (status
 *   'pending')  ──►  Admin approves it in the existing /admin/reviews queue
 *   ──►  the photo renders on the public Experience page; the "With photos"
 *   review filter surfaces the review. Admin REJECT instead → the photo never
 *   renders publicly (no unmoderated user image is ever public).
 *
 * The default cross-surface `page` carries the ADMIN session (it drives the
 * admin moderation queue) and also views the public PDP. The Review + photo
 * are seeded directly via SQL against a seeded published Experience — the
 * customer review-create UI is out of scope for this milestone, and the
 * owner-gated attach core is unit-tested separately (lib/reviews/photos.test).
 *
 * Cleanup: afterEach removes the seeded review_photos / reviews / bookings /
 * slots created by this spec, matched by a UNIQUE per-run marker.
 */

import postgres from 'postgres'

import { test, expect } from '../../fixtures/devtools'
import { e2eDbUrl } from '../../helpers/config'

// Seeded published flagship Experience (db/seed.ts) — reliably on the PDP.
const RAFTING_SLUG = 'rishikesh-rafting-grade-iii'

const MARKER = `e2e-rp-${Date.now()}`
const PHOTO_URL = `/uploads/reviews/${MARKER}.jpg`

interface SeededReview {
  reviewId: string
  photoId: string
  bookingId: string
  slotId: string
}

/**
 * Seed a completed Booking + published Review + a single PENDING review_photo
 * against the seeded rafting Experience, for the seeded demo customer/vendor.
 * Returns the ids so the test can target the photo and clean up after.
 */
async function seedPendingReviewPhoto(): Promise<SeededReview> {
  const sql = postgres(e2eDbUrl(), { max: 1 })
  try {
    const [exp] = await sql<{ id: string; vendor_user_id: string }[]>`
      SELECT id, vendor_user_id FROM experiences WHERE slug = ${RAFTING_SLUG} LIMIT 1
    `
    if (!exp) throw new Error(`seed Experience ${RAFTING_SLUG} not found`)

    // Any existing user works as the review-owning Customer; pick the seeded
    // demo customer if present, else the first non-vendor user.
    const [customer] = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE id <> ${exp.vendor_user_id} ORDER BY created_at ASC LIMIT 1
    `
    if (!customer) throw new Error('no Customer user available to seed review')

    const startAt = new Date('2026-01-15T09:00:00Z')
    const endAt = new Date('2026-01-15T13:00:00Z')
    const [slot] = await sql<{ id: string }[]>`
      INSERT INTO availability_slots (experience_id, start_at, end_at, capacity)
      VALUES (${exp.id}, ${startAt.toISOString()}, ${endAt.toISOString()}, 8)
      RETURNING id
    `

    const [booking] = await sql<{ id: string }[]>`
      INSERT INTO bookings (
        customer_user_id, experience_id, slot_id, participant_count, payment_mode,
        state, gross_total_snapshot, price_per_participant_snapshot,
        pricing_basis_snapshot, commission_rate_snapshot, commission_basis_snapshot,
        cancellation_preset_snapshot, tds_amount_snapshot, gst_rate_on_commission_snapshot,
        vendor_is_resident_snapshot, payout_method_snapshot, payout_destination_snapshot
      ) VALUES (
        ${customer.id}, ${exp.id}, ${slot!.id}, 2, 'full_upfront',
        'completed', '1000.00', '500.00',
        'experience_bracket:1_2', '20.00', 'vendor_default',
        'flexible', '10.00', '18.00',
        true, 'upi', ${sql.json({ vpa: 'vendor@upi' })}
      ) RETURNING id
    `

    const [review] = await sql<{ id: string }[]>`
      INSERT INTO reviews (
        booking_id, customer_user_id, experience_id, vendor_user_id, rating, title, status
      ) VALUES (
        ${booking!.id}, ${customer.id}, ${exp.id}, ${exp.vendor_user_id}, 5, ${MARKER}, 'published'
      ) RETURNING id
    `

    const [photo] = await sql<{ id: string }[]>`
      INSERT INTO review_photos (review_id, uploaded_by_user_id, storage_key, url, status, alt_text)
      VALUES (${review!.id}, ${customer.id}, ${MARKER + '.jpg'}, ${PHOTO_URL}, 'pending', ${MARKER})
      RETURNING id
    `

    return {
      reviewId: review!.id,
      photoId: photo!.id,
      bookingId: booking!.id,
      slotId: slot!.id,
    }
  } finally {
    await sql.end()
  }
}

async function cleanupSeed(): Promise<void> {
  const sql = postgres(e2eDbUrl(), { max: 1 })
  try {
    // review_photos cascade-delete on the review FK; deleting the review +
    // booking + slot tagged with this run's marker is sufficient.
    await sql`DELETE FROM reviews WHERE title = ${MARKER}`
    await sql`DELETE FROM bookings WHERE id IN (
      SELECT b.id FROM bookings b
      JOIN availability_slots s ON b.slot_id = s.id
      WHERE s.start_at = '2026-01-15T09:00:00Z'
        AND b.experience_id = (SELECT id FROM experiences WHERE slug = ${RAFTING_SLUG})
    )`
    await sql`DELETE FROM availability_slots
      WHERE start_at = '2026-01-15T09:00:00Z'
        AND experience_id = (SELECT id FROM experiences WHERE slug = ${RAFTING_SLUG})`
  } finally {
    await sql.end()
  }
}

async function photoStatus(photoId: string): Promise<string | null> {
  const sql = postgres(e2eDbUrl(), { max: 1 })
  try {
    const [row] = await sql<{ status: string }[]>`
      SELECT status FROM review_photos WHERE id = ${photoId} LIMIT 1
    `
    return row?.status ?? null
  } finally {
    await sql.end()
  }
}

test.describe('Cross-surface: review photo → admin moderation → PDP render @cross-surface', () => {
  test.describe.configure({ mode: 'serial' })

  test.afterEach(async () => {
    await cleanupSeed()
  })

  test('admin APPROVES a pending photo → it renders on the PDP and feeds the With-photos filter', async ({
    page,
  }) => {
    const { photoId } = await seedPendingReviewPhoto()

    // ── Precondition: a pending photo is NOT yet public on the PDP ────────
    await page.goto(`/experience/${RAFTING_SLUG}`)
    await expect(
      page.locator(`img[src*="${MARKER}"]`),
      'a pending (unmoderated) photo must NOT render publicly',
    ).toHaveCount(0)

    // ── Admin (UI): approve the pending photo in the moderation queue ─────
    await page.goto('/admin/reviews')
    const queueItem = page
      .getByTestId('review-photo-queue-item')
      .filter({ has: page.locator(`[data-photo-id="${photoId}"]`) })
      .or(page.locator(`[data-photo-id="${photoId}"]`))
    await expect(queueItem.first()).toBeVisible()
    await queueItem.first().getByTestId('review-photo-approve').click()

    // ── Side effect: status → approved ───────────────────────────────────
    await expect
      .poll(async () => photoStatus(photoId), { timeout: 15_000 })
      .toBe('approved')

    // ── Render: the approved photo now appears on the public PDP ─────────
    await page.goto(`/experience/${RAFTING_SLUG}`)
    await expect(
      page.locator(`img[src*="${MARKER}"]`).first(),
      'an approved photo must render on the public Experience page',
    ).toBeVisible()

    // ── Filter: "With photos" surfaces the review carrying the photo ─────
    const withPhotos = page.getByTestId('review-filter-with-photos')
    await expect(withPhotos).toBeVisible()
    await withPhotos.click()
    await expect(page.getByText(MARKER, { exact: false }).first()).toBeVisible()
  })

  test('admin REJECTS a pending photo → it never renders on the PDP', async ({
    page,
  }) => {
    const { photoId } = await seedPendingReviewPhoto()

    await page.goto('/admin/reviews')
    const queueItem = page.locator(`[data-photo-id="${photoId}"]`)
    await expect(queueItem.first()).toBeVisible()
    await queueItem.first().getByTestId('review-photo-reject').click()

    await expect
      .poll(async () => photoStatus(photoId), { timeout: 15_000 })
      .toBe('rejected')

    await page.goto(`/experience/${RAFTING_SLUG}`)
    await expect(
      page.locator(`img[src*="${MARKER}"]`),
      'a rejected photo must NEVER render publicly',
    ).toHaveCount(0)
  })
})
