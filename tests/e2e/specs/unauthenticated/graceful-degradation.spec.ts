/**
 * E2E hardening spec — graceful degradation of out-of-scope feature
 * entry-points (Issue #112).
 *
 * Outvers v1 ships a deliberately bounded surface. A set of features are
 * NAMED in the schema / ADRs but NOT implemented, and must therefore never
 * present a live, working-looking entry-point that leads to a 500, a console
 * error, or a dead link. Per the PRD + ADRs the out-of-scope set is:
 *
 *   - AI suite (ADR-0010): review summaries, listing drafts, inbox
 *     suggestions, trip planner
 *   - Safety / SOS stack (ADR-0015): trusted contact, check-in pings, SOS
 *     button, live location
 *   - WhatsApp transactional (MSG91)
 *   - TripGroups (ADR-0009): group convening / chat / itinerary
 *   - Channel manager (ADR-0014): Bokun / FareHarbor sync
 *   - Partner API
 *   - Gift experiences
 *   - RNPL — reserve-now-pay-later (ADR-0002): schema-named, booking flow
 *     REJECTS it; NEVER render an RNPL tile / badge in v1
 *   - UGC trip diaries
 *
 * This spec asserts that NONE of these surface a reachable entry-point on the
 * public (unauthenticated) routes, and that the public routes themselves
 * degrade gracefully (no 500, no console error, no dead link). The DevTools
 * fixture additionally gates console errors, uncaught exceptions, 4xx/5xx
 * network responses, and runs axe-core after every test.
 *
 * Authenticated payment-mode surfaces (checkout, vendor listing edit) carry
 * their own RNPL-absence assertions in the customer / vendor specs.
 */

import { test, expect } from '../../fixtures/devtools'
import type { Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Out-of-scope vocabulary.
//
// Tokens that, if they appeared as a *link target* or a *visible interactive
// control label*, would indicate a leaked entry-point to an unbuilt feature.
// These are matched against link hrefs and visible text — NOT raw HTML — so
// incidental SEO copy (e.g. an FAQ that says "your safety is our priority")
// does not trip the assertions.
// ---------------------------------------------------------------------------

/** URL fragments that must never appear as a link target on a public page. */
const FORBIDDEN_HREF_FRAGMENTS: readonly string[] = [
  'wishlist',
  'favourite',
  'favorite',
  '/gift',
  'gift-card',
  'gift-experience',
  'trip-group',
  'tripgroup',
  'trip-diary',
  'diary',
  '/sos',
  'trusted-contact',
  'check-in',
  'live-location',
  'partner-api',
  '/partners',
  'channel-manager',
  'bokun',
  'fareharbor',
  'ai-planner',
  'trip-planner',
  'reserve-now-pay-later',
  'pay-later',
  'rnpl',
]

/** The public routes that an unauthenticated visitor can reach. */
const PUBLIC_ROUTES: readonly { name: string; path: string }[] = [
  { name: 'home', path: '/' },
  { name: 'search (bare)', path: '/search' },
  { name: 'search (filtered)', path: '/search?activity=rafting' },
  { name: 'activity-city collection', path: '/adventure/rafting-in-rishikesh' },
  { name: 'experience detail', path: '/experience/rishikesh-rafting-grade-iii' },
  { name: 'vendor profile', path: '/vendor/himalayan-hikes-co' },
  { name: 'cancellation policy', path: '/cancellation-policy' },
  { name: 'sign-in', path: '/sign-in' },
]

/**
 * Navigate to a route, tolerating the Next.js dev server's first-hit cold
 * compilation. On a cold compile, many parallel workers can momentarily get a
 * 500 while the route is still building; a single retry after a short pause
 * lets the now-warm route serve normally. This does NOT mask a genuinely
 * broken route — a real 500 stays 500 on the retry and the caller's assertion
 * still fails. (In CI the route is pre-warmed and `retries: 2` covers the rest.)
 */
async function gotoWarm(
  page: Page,
  path: string,
): Promise<number | undefined> {
  let response = await page.goto(path)
  if (response?.status() === 500) {
    await page.waitForTimeout(1500)
    response = await page.goto(path)
  }
  return response?.status()
}

/**
 * Collect every in-app link target on the current page (excludes external
 * links, mailto:, tel:, and pure anchors). Returns lowercased hrefs.
 */
async function collectInternalHrefs(page: Page): Promise<string[]> {
  const hrefs = await page.locator('a[href]').evaluateAll((anchors) =>
    anchors
      .map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? '')
      .filter(Boolean),
  )
  return hrefs
    .map((h) => h.toLowerCase())
    .filter(
      (h) =>
        !h.startsWith('mailto:') &&
        !h.startsWith('tel:') &&
        !h.startsWith('http://') &&
        !h.startsWith('https://') &&
        h !== '#',
    )
}

// ---------------------------------------------------------------------------
// 1. No public route links to an out-of-scope feature.
//
//    Each route is loaded (DevTools fixture gates 500 / console / network),
//    then every internal link target is checked against the forbidden set.
//    A leaked entry-point would show up as a link to e.g. /wishlist or
//    /trip-groups that has no backing route — i.e. a dead link.
// ---------------------------------------------------------------------------
test.describe('Out-of-scope entry-points are absent from public routes', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.name}: no forbidden link targets, no 500/console error`, async ({
      page,
    }) => {
      const status = await gotoWarm(page, route.path)
      // Public routes must render (< 500) — never an Internal Server Error.
      expect(status, `${route.path} must not error`).toBeLessThan(500)

      const hrefs = await collectInternalHrefs(page)
      for (const href of hrefs) {
        for (const fragment of FORBIDDEN_HREF_FRAGMENTS) {
          expect(
            href.includes(fragment),
            `${route.path} links to out-of-scope target "${href}" (matched "${fragment}")`,
          ).toBe(false)
        }
      }
    })
  }
})

// ---------------------------------------------------------------------------
// 2. No dead links anywhere reachable from the public surface.
//
//    Crawl one hop out from the home page: every internal link target must
//    resolve to a non-5xx response. A 404 is acceptable ONLY for the
//    deliberately-absent error-page tests elsewhere; here, every link the UI
//    actually renders must resolve < 400 (no dead links that look functional).
// ---------------------------------------------------------------------------
test.describe('Public links are not dead', () => {
  test('every internal link on the home page resolves (no dead links)', async ({
    page,
    request,
  }) => {
    await gotoWarm(page, '/')
    const hrefs = await collectInternalHrefs(page)

    // De-duplicate and keep only root-relative paths we can resolve.
    //
    // EXCLUDE the `mod-pending-*` Experience links: these are E2E moderation
    // FIXTURES (db/seed.ts) whose publish/pause/archive lifecycle is owned by
    // the parallel admin moderation suite (#23). When the admin archive/pause
    // test runs concurrently it legitimately de-publishes the fixture → its
    // (transient) home-page link 404s mid-crawl. That is a cross-spec fixture
    // race, NOT a dead REAL product link, so skip these fixture slugs here.
    // (Real product routes are still fully asserted.)
    const unique = Array.from(
      new Set(hrefs.filter((h) => h.startsWith('/'))),
    ).filter((h) => !/\/experience\/mod-pending-/.test(h))
    expect(unique.length).toBeGreaterThan(0)

    for (const href of unique) {
      let res = await request.get(href)
      // Tolerate a single dev-server cold-compile 500 (see gotoWarm). A truly
      // dead link (404) or persistently-broken route (500) still fails below.
      if (res.status() === 500) {
        await page.waitForTimeout(1500)
        res = await request.get(href)
      }
      expect(
        res.status(),
        `home-page link "${href}" is dead (status ${res.status()})`,
      ).toBeLessThan(400)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. RNPL never renders a tile / badge / selectable option (ADR-0002).
//
//    The Experience detail page (PDP) is the public payment-mode surface. It
//    may advertise partial-pay (a shipped mode), but must NEVER render a
//    reserve-now-pay-later tile, badge, or "pay later" copy — shipping the
//    badge without the mechanic misleads Customers (ADR-0002).
// ---------------------------------------------------------------------------
test.describe('RNPL degrades gracefully — no tile / badge on the PDP', () => {
  test('experience detail shows partial-pay but never an RNPL tile/badge', async ({
    page,
  }) => {
    // Seeded partial-pay-capable Experience.
    const status = await gotoWarm(page, '/experience/rishikesh-rafting-grade-iii')
    expect(status).toBe(200)

    const bodyText = (await page.locator('body').innerText()).toLowerCase()

    // RNPL must NOT be advertised anywhere on the page.
    expect(bodyText, 'PDP must not mention "reserve now, pay later"').not.toContain(
      'reserve now',
    )
    expect(bodyText, 'PDP must not mention "reserve-now-pay-later"').not.toContain(
      'reserve-now-pay-later',
    )
    expect(bodyText, 'PDP must not show a "pay later" badge').not.toContain(
      'pay later',
    )
    expect(bodyText, 'PDP must not surface the RNPL acronym').not.toContain(
      'rnpl',
    )

    // No link / control points at an RNPL route either.
    const hrefs = await collectInternalHrefs(page)
    for (const href of hrefs) {
      expect(href).not.toContain('reserve-now-pay-later')
      expect(href).not.toContain('pay-later')
      expect(href).not.toContain('rnpl')
    }
  })
})

// ---------------------------------------------------------------------------
// 4. Footer affordances: built ones link.
//
//    Issue 07 SHIPPED /help + /contact, so Help centre / Contact us are now
//    REAL links (no "(soon)" suffix) that resolve 200. (The redesigned footer
//    no longer renders a "Vendor KYC (soon)" stub at all — owner-approved:
//    omitting an unbuilt affordance is itself a valid graceful degradation, so
//    there is nothing to assert about it.)
//
//    "Contact us" appears twice — under the Support column inside the footer
//    nav AND in the standalone Contact column (components/site-footer.tsx) — so
//    the link assertion is scoped to the footer navigation landmark + .first().
// ---------------------------------------------------------------------------
test.describe('Footer affordances degrade gracefully', () => {
  test('Help centre / Contact us are live links to /help and /contact', async ({
    page,
  }) => {
    await gotoWarm(page, '/')
    const footer = page.locator('footer')
    await expect(footer).toBeVisible()
    const footerNav = footer.getByRole('navigation', {
      name: 'Footer navigation',
    })

    // Help centre + Contact us are now built — real links to /help and /contact,
    // with the "(soon)" suffix dropped.
    const helpLink = footerNav
      .getByRole('link', { name: 'Help centre', exact: true })
      .first()
    const contactLink = footerNav
      .getByRole('link', { name: 'Contact us', exact: true })
      .first()
    await expect(helpLink).toBeVisible()
    await expect(contactLink).toBeVisible()
    await expect(helpLink).toHaveAttribute('href', /\/help$/)
    await expect(contactLink).toHaveAttribute('href', /\/contact$/)
  })
})

// ---------------------------------------------------------------------------
// 5. Out-of-scope feature words do not appear as interactive controls.
//
//    Scan the home page and PDP for buttons / links whose accessible name
//    matches an out-of-scope feature (wishlist, gift, SOS, trip group, AI
//    planner, trip diary). Incidental prose is allowed; an actionable control
//    is not.
// ---------------------------------------------------------------------------
test.describe('No interactive controls for out-of-scope features', () => {
  const FORBIDDEN_CONTROL_NAMES: readonly RegExp[] = [
    /gift this/i,
    /send as a gift/i,
    /\bsos\b/i,
    /trusted contact/i,
    /share live location/i,
    /create trip group/i,
    /plan my trip/i,
    /ai trip planner/i,
    /generate with ai/i,
    /write a trip diary/i,
    /reserve now, pay later/i,
  ]

  for (const path of ['/', '/experience/rishikesh-rafting-grade-iii']) {
    test(`${path}: no actionable control for an out-of-scope feature`, async ({
      page,
    }) => {
      await gotoWarm(page, path)
      const controls = page.locator('a, button, [role="button"], [role="switch"]')
      const count = await controls.count()
      for (let i = 0; i < count; i++) {
        const name = (await controls.nth(i).innerText().catch(() => '')) || ''
        const aria =
          (await controls.nth(i).getAttribute('aria-label').catch(() => '')) || ''
        const haystack = `${name} ${aria}`
        for (const pattern of FORBIDDEN_CONTROL_NAMES) {
          expect(
            pattern.test(haystack),
            `${path} renders an out-of-scope control matching ${pattern} ("${haystack.trim()}")`,
          ).toBe(false)
        }
      }
    })
  }
})
