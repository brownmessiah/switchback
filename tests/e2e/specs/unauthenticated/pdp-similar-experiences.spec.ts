/**
 * E2E — PDP "Similar experiences" section (issue 16).
 *
 * The bottom of the Experience detail page carries a "Similar experiences"
 * section sourced by a query that BLENDS three intents, every group gated
 * through `lib/experiences/public-filter` (no fixture / unpublished leak):
 *
 *   (a) SAME activity in nearby (same-state) / other regions,
 *   (b) DIFFERENT activities in the SAME region,
 *   (c) popular beginner-friendly (easy) alternatives.
 *
 * Asserted on the seeded Rishikesh rafting PDP (`rishikesh-rafting-grade-iii`,
 * db/seed.ts). The e2e catalog (db/seed-extras.ts) gives Rishikesh rafting +
 * bungee + camping + kayaking, and Leh-Ladakh has its own rafting listing
 * (`leh-ladakh-rafting-zanskar-grade-iv`) — so the rafting PDP shows BOTH a
 * same-region different-activity card AND the same-activity-different-region
 * (Zanskar rafting) card, matching the acceptance criterion.
 *
 * Empty-safety (section hidden when the loader returns no candidate) is pinned
 * deterministically in the loader unit test (lib/experiences/similar.test.ts:
 * "returns [] when there are no other published Experiences"); the demo seed
 * gives every region ≥3 listings, so there is no naturally-empty PDP to assert
 * it against here. Uses the DevTools fixture for console-error + axe-core
 * checks (axe clean is an acceptance criterion).
 */

import { test, expect } from '../../fixtures/devtools'

// The seeded Rishikesh rafting Experience (db/seed.ts).
const PDP = '/experience/rishikesh-rafting-grade-iii'

test.describe('PDP "Similar experiences" (issue 16)', () => {
  test('renders the section with a heading and at least one card', async ({
    page,
  }) => {
    const response = await page.goto(PDP)
    expect(response?.status()).toBe(200)

    const section = page.locator('[data-testid="similar-experiences"]')
    await expect(section).toBeVisible()
    await expect(
      section.getByRole('heading', { name: /similar experiences/i }),
    ).toBeVisible()

    // The section renders shared experience cards (anchors to /experience/...).
    const cards = section.locator('a[href^="/experience/"]')
    expect(await cards.count()).toBeGreaterThan(0)
  })

  test('surfaces the three intents: same-activity-other-region, same-region-other-activity, and never the current Experience', async ({
    page,
  }) => {
    await page.goto(PDP)
    const section = page.locator('[data-testid="similar-experiences"]')
    await expect(section).toBeVisible()

    // (a) same activity (rafting), different region — Zanskar rafting (Leh-Ladakh).
    await expect(
      section.locator(
        'a[href="/experience/leh-ladakh-rafting-zanskar-grade-iv"]',
      ),
    ).toBeVisible()

    // (b) same region (Rishikesh), different activity — a non-rafting Rishikesh card.
    const sameRegionDifferentActivity = section
      .locator('a[href^="/experience/rishikesh-"]')
      .filter({ hasText: /kayak|bungee|camping/i })
    expect(await sameRegionDifferentActivity.count()).toBeGreaterThan(0)

    // The current Experience is NEVER recommended to itself.
    await expect(
      section.locator('a[href="/experience/rishikesh-rafting-grade-iii"]'),
    ).toHaveCount(0)
  })

  test('never leaks a fixture / unpublished Experience into the section', async ({
    page,
  }) => {
    await page.goto(PDP)
    const section = page.locator('[data-testid="similar-experiences"]')
    await expect(section).toBeVisible()

    // A published Rishikesh rafting FIXTURE exists in the seed; it must never
    // appear on this public surface (guardrail D0).
    await expect(
      section.locator('a[href*="refund-queue-fixture-rishikesh"]'),
    ).toHaveCount(0)
    await expect(section.getByText(/fixture/i)).toHaveCount(0)
  })
})
