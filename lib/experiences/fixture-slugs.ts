/**
 * Admin / E2E **fixture** Experience slugs — single source of truth.
 *
 * These Experiences exist ONLY to drive the Playwright suite (the refund-queue,
 * payout-queue, payout-gate, commission-scope, review-moderation, experience-
 * moderation and cross-surface-search fixtures). They must never appear on any
 * human-facing list: the customer dashboard and the admin "All bookings" demo
 * were both dominated by rows like "Commission Scope Fixture — Bir Billing
 * (admin #26)" and "Review Moderation Fixture (admin #27)" (visual critique A0).
 *
 * The seed keeps inserting these rows (the E2E specs read them by slug), so the
 * exclusion lives at the LIST-QUERY level — robust against any future seed that
 * attaches more fixture bookings to a demo customer.
 */

/**
 * PUBLISHED fixture Experiences the catalog enrichment archives so they leave
 * the public Featured / search surfaces (db/seed-extras.ts). Kept as a distinct
 * list because the `pending_review` moderation fixtures below are never
 * published and so were never on those surfaces to begin with.
 */
export const PUBLISHED_FIXTURE_SLUGS: string[] = [
  'refund-queue-fixture-rishikesh',
  'payout-queue-fixture-bir-billing',
  'payout-gate-fixture-bir-billing',
  'commission-scope-fixture-bir-billing',
]

/**
 * Every fixture Experience slug — the union the human-facing booking lists
 * exclude. Includes the published fixtures above plus the review-moderation,
 * experience-moderation (`mod-pending-*`) and cross-surface-search fixtures.
 */
export const FIXTURE_EXPERIENCE_SLUGS: string[] = [
  ...PUBLISHED_FIXTURE_SLUGS,
  'review-moderation-fixture-rishikesh',
  'mod-pending-approve-within-cap',
  'mod-pending-reject',
  'mod-pending-pause',
  'mod-pending-archive',
  'mod-pending-overcap',
  'xsurface-approve-search-rishikesh',
]

/** True if a slug is an admin/E2E fixture that must stay off human surfaces. */
export function isFixtureExperienceSlug(slug: string): boolean {
  return FIXTURE_EXPERIENCE_SLUGS.includes(slug)
}
