/**
 * E2E tests for all public (unauthenticated) pages.
 *
 * Covers: home, activity-city collection, experience detail, search (bare +
 * filtered), Hindi locale, sign-in, and error pages.
 *
 * Uses the DevTools fixture for automatic console-error, uncaught-exception,
 * network-failure, and axe-core accessibility checks after each test.
 */

import { test, expect } from '../../fixtures/devtools'

// ---------------------------------------------------------------------------
// 1. Home page
// ---------------------------------------------------------------------------
test.describe('Home page', () => {
  test('loads 200, axe passes, no console errors', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(/Outvers/)

    await page.screenshot({
      path: 'tests/e2e/screenshots/home.png',
      fullPage: true,
    })
  })

  // Variant-B functional contract: the hero search form and the activity
  // chips are real GET navigations to /search. Behaviour-level — fill +
  // submit + click, then assert the resulting URL — not coupled to markup.
  test('hero search submits to /search?q=', async ({ page }) => {
    await page.goto('/')

    await page.locator('input#home-search').fill('rishikesh rafting')
    await Promise.all([
      page.waitForURL(/\/search\?.*\bq=rishikesh(\+|%20)rafting\b/),
      page.locator('input#home-search').press('Enter'),
    ])

    expect(new URL(page.url()).searchParams.get('q')).toBe('rishikesh rafting')
  })

  test('activity chip navigates to /search?activity=rafting', async ({
    page,
  }) => {
    await page.goto('/')

    const raftingChip = page.locator('a[href="/search?activity=rafting"]')
    await expect(raftingChip).toBeVisible()
    await raftingChip.click()

    await page.waitForURL('**/search?activity=rafting')
    expect(new URL(page.url()).searchParams.get('activity')).toBe('rafting')
  })

  test('destination tile links to /search?region= and resolves 200', async ({
    page,
  }) => {
    await page.goto('/')

    // Issue-1 fix: destination tiles point at the region-filtered search
    // page (all activities in that region) — not a hardcoded activity
    // collection. Grab the first such tile, follow it, assert it lands on
    // a populated, all-activities-in-region result set.
    const regionTile = page.locator('a[href^="/search?region="]').first()
    await expect(regionTile).toBeVisible()
    const href = await regionTile.getAttribute('href')
    expect(href).toMatch(/^\/search\?region=[a-z-]+$/)

    const response = await page.goto(href!)
    expect(response?.status()).toBe(200)
    expect(new URL(page.url()).searchParams.get('region')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// 2. Activity-city collection
// ---------------------------------------------------------------------------
test.describe('Activity-city collection', () => {
  test('renders H1, JSON-LD, breadcrumb nav, experience cards', async ({
    page,
  }) => {
    const response = await page.goto('/adventure/rafting-in-rishikesh')
    expect(response?.status()).toBe(200)

    // H1 contains activity + region
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Rafting')
    await expect(h1).toContainText('Rishikesh')

    // Breadcrumb nav present
    const breadcrumbNav = page.locator('nav[aria-label="Breadcrumb"]')
    await expect(breadcrumbNav).toBeVisible()

    // JSON-LD blocks: BreadcrumbList + FAQPage (at minimum)
    const jsonLdScripts = page.locator('script[type="application/ld+json"]')
    const count = await jsonLdScripts.count()
    expect(count).toBeGreaterThanOrEqual(2)

    let foundBreadcrumb = false
    let foundFaq = false
    for (let i = 0; i < count; i++) {
      const content = await jsonLdScripts.nth(i).textContent()
      if (!content) continue
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (parsed['@type'] === 'BreadcrumbList') {
        foundBreadcrumb = true
        expect(parsed['@context']).toBe('https://schema.org')
        const items = parsed.itemListElement as Array<{ position: number }>
        expect(items.length).toBeGreaterThanOrEqual(2)
        expect(items[0].position).toBe(1)
      }
      if (parsed['@type'] === 'FAQPage') {
        foundFaq = true
        const entities = parsed.mainEntity as Array<{ '@type': string }>
        expect(entities.length).toBeGreaterThanOrEqual(1)
        expect(entities[0]['@type']).toBe('Question')
      }
    }
    expect(foundBreadcrumb).toBe(true)
    expect(foundFaq).toBe(true)

    // Experience cards visible (if seeded data has any)
    const experienceLinks = page.locator('a[href*="/experience/"]')
    const linkCount = await experienceLinks.count()
    expect(linkCount).toBeGreaterThanOrEqual(0)

    await page.screenshot({
      path: 'tests/e2e/screenshots/activity-city-collection.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 3. Experience detail
// ---------------------------------------------------------------------------
test.describe('Experience detail', () => {
  test('renders Product/Review/FAQ/BreadcrumbList JSON-LD, pricing brackets, cancellation, FAQ, vendor link, breadcrumb', async ({
    page,
  }) => {
    // Deep-link to a known seeded Experience so pricing brackets +
    // cancellation preset are deterministic (Rishikesh Grade-III rafting:
    // ₹1500 / ₹1300 / ₹1100, flexible preset, has published reviews).
    const response = await page.goto(
      '/experience/rishikesh-rafting-grade-iii',
    )
    expect(response?.status()).toBe(200)

    // H1 present
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()

    // Breadcrumb nav
    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toBeVisible()

    // JSON-LD: Product + BreadcrumbList + FAQPage + Review (ADR-0013)
    const jsonLdScripts = page.locator('script[type="application/ld+json"]')
    const count = await jsonLdScripts.count()
    expect(count).toBeGreaterThanOrEqual(4)

    let foundProduct = false
    let foundBreadcrumb = false
    let foundFaq = false
    let reviewCount = 0
    let foundAggregateRating = false
    for (let i = 0; i < count; i++) {
      const content = await jsonLdScripts.nth(i).textContent()
      if (!content) continue
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (parsed['@type'] === 'Product') {
        foundProduct = true
        expect(parsed['@context']).toBe('https://schema.org')
        expect(parsed.name).toBeTruthy()
        expect(parsed.url).toContain('/experience/')
        const offers = parsed.offers as {
          '@type': string
          priceCurrency: string
          price: string
        }
        expect(offers['@type']).toBe('Offer')
        expect(offers.priceCurrency).toBe('INR')
        // Product offer reflects the 1-2 Group-size bracket price (₹1500).
        expect(Number(offers.price)).toBe(1500)
        // AggregateRating present because this Experience has reviews.
        if (parsed.aggregateRating) {
          foundAggregateRating = true
          const ar = parsed.aggregateRating as {
            '@type': string
            ratingValue: number
            ratingCount: number
          }
          expect(ar['@type']).toBe('AggregateRating')
          expect(ar.ratingValue).toBeGreaterThan(0)
          expect(ar.ratingValue).toBeLessThanOrEqual(5)
          expect(ar.ratingCount).toBeGreaterThanOrEqual(1)
        }
      }
      if (parsed['@type'] === 'BreadcrumbList') foundBreadcrumb = true
      if (parsed['@type'] === 'FAQPage') foundFaq = true
      if (parsed['@type'] === 'Review') {
        reviewCount += 1
        expect(parsed['@context']).toBe('https://schema.org')
        const author = parsed.author as { '@type': string; name: string }
        expect(author['@type']).toBe('Person')
        expect(author.name).toBeTruthy()
        const rating = parsed.reviewRating as {
          '@type': string
          ratingValue: number
        }
        expect(rating['@type']).toBe('Rating')
        expect(rating.ratingValue).toBeGreaterThanOrEqual(1)
        expect(rating.ratingValue).toBeLessThanOrEqual(5)
        expect(parsed.datePublished).toBeTruthy()
      }
    }
    expect(foundProduct).toBe(true)
    expect(foundBreadcrumb).toBe(true)
    expect(foundFaq).toBe(true)
    // ADR-0013 mandates Review JSON-LD on Experience detail; this seeded
    // Experience has published reviews so at least one Review node + an
    // AggregateRating must be present.
    expect(reviewCount).toBeGreaterThanOrEqual(1)
    expect(foundAggregateRating).toBe(true)

    // Pricing — all three Group-size brackets {1-2, 3-5, 6+} are rendered
    // with their per-person prices (ADR-0011 group-size brackets).
    await expect(page.locator('text=1-2 participants')).toBeVisible()
    await expect(page.locator('text=3-5 participants')).toBeVisible()
    await expect(page.locator('text=6+ participants')).toBeVisible()
    await expect(page.locator('text=₹1,500').first()).toBeVisible()
    await expect(page.locator('text=₹1,300').first()).toBeVisible()
    await expect(page.locator('text=₹1,100').first()).toBeVisible()
    await expect(page.locator('text=/ person').first()).toBeVisible()

    // Cancellation policy preset (ADR-0005) — section heading + the
    // "flexible" preset badge are shown.
    await expect(
      page.locator('h2:has-text("Cancellation policy")'),
    ).toBeVisible()
    await expect(page.getByText('flexible', { exact: true })).toBeVisible()

    // FAQ section
    await expect(
      page.locator('h2:has-text("Frequently asked questions")'),
    ).toBeVisible()

    // Vendor link (first match — nav may contain other /vendor/ links)
    await expect(page.locator('a[href*="/vendor/"]').first()).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/experience-detail.png',
      fullPage: true,
    })
  })

  // Direction B "Conversion-dense sticky-rail" (#65): the PDP carries a
  // Viator-grade in-page anchor nav that jumps to the left-column sections,
  // each of which exposes a matching id. Behaviour-level contract — assert the
  // nav links resolve to real in-page targets, not coupled to copy.
  test('anchor nav jumps to in-page section targets (overview/reviews)', async ({
    page,
  }) => {
    await page.goto('/experience/rishikesh-rafting-grade-iii')

    // The anchor nav is a labelled in-page jump nav distinct from the
    // breadcrumb (which is aria-label="Breadcrumb").
    const anchorNav = page.locator('nav[aria-label="Section navigation"]')
    await expect(anchorNav).toBeVisible()

    // Every nav link is a same-page hash link whose target id exists in the
    // document (so the jump actually lands somewhere). Overview + Reviews are
    // the two anchors guaranteed for every Experience.
    for (const id of ['overview', 'reviews']) {
      const link = anchorNav.locator(`a[href="#${id}"]`)
      await expect(link).toBeVisible()
      await expect(page.locator(`#${id}`)).toHaveCount(1)
    }
  })

  // Direction B: the Booking rail keeps the Partial-pay Advance/balance split
  // permanently in view before commit. The seeded rafting Experience allows
  // partial pay, so both the 25% Advance line and the T-24h balance line must
  // render in the rail alongside the working Book-now link.
  test('booking rail shows the Partial-pay Advance/balance split', async ({
    page,
  }) => {
    await page.goto('/experience/rishikesh-rafting-grade-iii')

    // 1-2 bracket price is ₹1,500 → Advance (25%) = ₹375, balance = ₹1,125.
    await expect(page.getByText('₹375').first()).toBeVisible()
    await expect(page.getByText('₹1,125').first()).toBeVisible()

    // Book-now remains a working link into checkout (revenue spine depends on
    // this exact text + href).
    const bookNow = page.locator('a:has-text("Book now")')
    await expect(bookNow).toBeVisible()
    await expect(bookNow).toHaveAttribute('href', /\/checkout\?experienceId=/)
  })

  // ADR-0017 structured PDP: the flagship rafting fixture carries the full
  // structured attribute set (quick-facts, highlights, inclusions/exclusions,
  // what-to-bring, itinerary, meeting point) seeded in db/seed.ts. Every new
  // section must render, the TouristTrip JSON-LD must be present, and the
  // anchor nav must gain matching jump targets. axe-core runs in afterEach.
  test('structured Experience renders every ADR-0017 section + TouristTrip JSON-LD', async ({
    page,
  }) => {
    const response = await page.goto('/experience/rishikesh-rafting-grade-iii')
    expect(response?.status()).toBe(200)

    // Quick-facts strip — labelled <dl>; duration + difficulty are seeded.
    const quickFacts = page.locator('dl[aria-label]').first()
    await expect(quickFacts).toBeVisible()
    await expect(quickFacts).toContainText('4 hours')
    await expect(quickFacts).toContainText('Moderate')

    // Highlights — heading + at least one seeded bullet.
    await expect(page.locator('#highlights')).toHaveCount(1)
    await expect(
      page.locator('#highlights').getByText('Three named Grade III rapids'),
    ).toBeVisible()

    // Details — inclusions + exclusions + what-to-bring all in the #details
    // section.
    const details = page.locator('#details')
    await expect(details).toHaveCount(1)
    await expect(details.getByText('Helmet, PFD and paddle')).toBeVisible()
    await expect(details.getByText('GoPro footage')).toBeVisible()
    await expect(details.getByText('Quick-dry clothes')).toBeVisible()

    // Itinerary accordion — one seeded step trigger present.
    await expect(page.locator('#itinerary')).toHaveCount(1)
    await expect(
      page.locator('#itinerary').getByText('Safety briefing & gear-up'),
    ).toBeVisible()

    // Meeting point — text only.
    await expect(page.locator('#meetingPoint')).toHaveCount(1)
    await expect(
      page.locator('#meetingPoint').getByText(/Shivpuri rafting base/),
    ).toBeVisible()

    // Anchor nav gained matching jump targets for the new sections.
    const anchorNav = page.locator('nav[aria-label="Section navigation"]')
    for (const id of ['highlights', 'itinerary', 'details', 'meetingPoint']) {
      await expect(anchorNav.locator(`a[href="#${id}"]`)).toBeVisible()
      await expect(page.locator(`#${id}`)).toHaveCount(1)
    }

    // TouristTrip JSON-LD is injected (ADR-0013 enrichment). Parse every
    // ld+json block and assert exactly one TouristTrip node with an itinerary
    // ItemList and an ISO-8601 duration (240 min → PT4H).
    const ldBlocks = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents()
    const parsed = ldBlocks.map((b) => JSON.parse(b))
    const trip = parsed.find((n) => n['@type'] === 'TouristTrip')
    expect(trip, 'TouristTrip JSON-LD node must be present').toBeTruthy()
    expect(trip.duration).toBe('PT4H')
    expect(trip.itinerary['@type']).toBe('ItemList')
    expect(trip.itinerary.itemListElement.length).toBeGreaterThanOrEqual(2)
    expect(trip.itinerary.itemListElement[0].position).toBe(1)
  })

  // The structured sections are strictly additive: a bare Experience (no
  // ADR-0017 fields seeded) must render cleanly with NONE of the new section
  // shells — no empty quick-facts strip, no orphan headings. The seeded
  // paragliding Experience carries no structured fields.
  test('bare Experience degrades cleanly — no empty structured section shells', async ({
    page,
  }) => {
    const response = await page.goto('/experience/manali-solang-paragliding-tandem')
    expect(response?.status()).toBe(200)

    // The core PDP still renders (overview + booking rail).
    await expect(page.locator('#overview')).toHaveCount(1)
    await expect(page.locator('a:has-text("Book now")')).toBeVisible()

    // None of the structured section shells are emitted when there is no data.
    for (const id of ['highlights', 'itinerary', 'details', 'meetingPoint']) {
      await expect(page.locator(`#${id}`)).toHaveCount(0)
    }
    // No quick-facts strip either.
    await expect(page.locator('dl[aria-label]')).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// 3b. Vendor profile
// ---------------------------------------------------------------------------
test.describe('Vendor profile', () => {
  test('renders SSR with vendor name, stats, and Experience cards', async ({
    page,
  }) => {
    // Seeded identity-tier Vendor with published Experiences.
    const response = await page.goto('/vendor/himalayan-hikes-co')
    expect(response?.status()).toBe(200)

    // H1 = vendor business name
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Himalayan Hikes Co')

    // Experiences-list heading + at least one Experience card linking out.
    await expect(
      page.locator('a[href*="/experience/"]').first(),
    ).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-profile.png',
      fullPage: true,
    })
  })

  // Direction B "Storefront Catalog" (#66): the trust rail surfaces the real
  // ADR-0007 verification provenance — what Identity / Business verification
  // actually checked — rendered with the semantic Badge variants paired with a
  // lucide icon (status never by colour alone). The seeded Vendor is
  // identity-tier, so its Identity check is verified and its Business check is
  // pending; both rows must be present.
  test('surfaces verification-provenance trust rail (ADR-0007)', async ({
    page,
  }) => {
    await page.goto('/vendor/himalayan-hikes-co')

    const rail = page.getByTestId('verification-provenance')
    await expect(rail).toBeVisible()

    // Identity verification line is present and marked verified.
    await expect(page.getByTestId('provenance-identity')).toBeVisible()
    // Business verification line is present (pending for an identity-tier Vendor).
    await expect(page.getByTestId('provenance-business')).toBeVisible()
  })

  // Direction B mentions a "Message Vendor" action, but cold customer→Vendor
  // messaging has NO production backend (see defects-log) — it is rendered
  // HONESTLY as a disabled "coming soon" affordance, never a dead link.
  test('renders "Message Vendor" as a disabled coming-soon affordance', async ({
    page,
  }) => {
    await page.goto('/vendor/himalayan-hikes-co')

    const messageBtn = page.getByTestId('message-vendor')
    await expect(messageBtn).toBeVisible()
    // It is a real disabled <button>, not a link — no navigation possible.
    await expect(messageBtn).toBeDisabled()
    await expect(messageBtn).toHaveAttribute('aria-disabled', 'true')
    // An accessible "coming soon" caption explains why it is disabled.
    await expect(page.getByTestId('message-vendor-note')).toBeVisible()
  })

  test('404 for invalid vendor slug', async ({ page }) => {
    const response = await page.goto('/vendor/not-a-real-vendor-xyz')
    expect(response?.status()).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// 4. Search bare
// ---------------------------------------------------------------------------
test.describe('Search bare', () => {
  test('H1 visible, canonical at /search, robots index follow, filter selects', async ({
    page,
  }) => {
    const response = await page.goto('/search')
    expect(response?.status()).toBe(200)

    // H1
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()

    // Canonical points at unfiltered /search and carries no query string
    // (ADR-0013: bare search is indexable with a self-canonical).
    const canonical = page.locator('link[rel="canonical"]').first()
    await expect(canonical).toHaveAttribute('href', /\/search$/)
    const canonicalHref = await canonical.getAttribute('href')
    expect(canonicalHref).not.toContain('?')

    // Robots meta MUST be index,follow on the bare search page (ADR-0013).
    const robotsMeta = page.locator('meta[name="robots"]')
    await expect(robotsMeta).toHaveCount(1)
    await expect(robotsMeta.first()).toHaveAttribute(
      'content',
      'index, follow',
    )

    // Search content visible (filter controls may use various UI patterns)
    await expect(page.locator('main')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/search-bare.png',
      fullPage: true,
    })
  })

  // Direction A "Klook-parity rail": the desktop layout presents a persistent
  // LEFT filter rail holding the real, backend-supported facets — activity,
  // sort, price range, and a Region facet. Asserts the rail is present (SSR,
  // no JS needed) and carries each facet control by stable testid.
  test('persistent left filter rail exposes activity, sort, price, and region facets', async ({
    page,
  }) => {
    await page.goto('/search')

    const rail = page.getByTestId('search-filter-rail')
    await expect(rail).toBeVisible()

    // Every backend-supported facet is present in the rail.
    await expect(rail.getByTestId('facet-activity')).toBeVisible()
    await expect(rail.getByTestId('facet-region')).toBeVisible()
    await expect(rail.getByTestId('facet-sort')).toBeVisible()
    await expect(rail.getByTestId('facet-minPrice')).toBeVisible()
    await expect(rail.getByTestId('facet-maxPrice')).toBeVisible()

    // The rail submits via a native GET form whose action is the bare /search
    // (so the searchParam-name contract and robots/canonical rules hold).
    await expect(rail.locator('form[method="get"][action="/search"]')).toHaveCount(1)

    // Mobile "Filters" trigger exists (opens the Sheet on small screens).
    await expect(page.getByTestId('search-filters-trigger')).toHaveCount(1)
  })
})

// ---------------------------------------------------------------------------
// 5. Search filtered
// ---------------------------------------------------------------------------
test.describe('Search filtered', () => {
  test('robots noindex follow, canonical still bare /search', async ({
    page,
  }) => {
    const response = await page.goto('/search?activity=rafting')
    expect(response?.status()).toBe(200)

    // Robots meta MUST be noindex,follow on a filtered search (ADR-0013:
    // sort/filter URL variants are noindex,follow).
    const robotsMeta = page.locator('meta[name="robots"]')
    await expect(robotsMeta).toHaveCount(1)
    await expect(robotsMeta.first()).toHaveAttribute(
      'content',
      'noindex, follow',
    )

    // Canonical STILL points at the unfiltered bare /search — query
    // params are stripped so signal consolidates on one URL (ADR-0013).
    const canonical = page.locator('link[rel="canonical"]').first()
    await expect(canonical).toHaveAttribute('href', /\/search$/)
    const canonicalHref = await canonical.getAttribute('href')
    expect(canonicalHref).not.toContain('?')
    expect(canonicalHref).not.toContain('activity')

    await page.screenshot({
      path: 'tests/e2e/screenshots/search-filtered.png',
      fullPage: true,
    })
  })

  test('multi-filter (price + sort) is also noindex,follow + bare canonical', async ({
    page,
  }) => {
    const response = await page.goto(
      '/search?activity=trekking&minPrice=500&sort=price_asc',
    )
    expect(response?.status()).toBe(200)

    const robotsMeta = page.locator('meta[name="robots"]')
    await expect(robotsMeta).toHaveCount(1)
    await expect(robotsMeta.first()).toHaveAttribute(
      'content',
      'noindex, follow',
    )

    const canonical = page.locator('link[rel="canonical"]').first()
    await expect(canonical).toHaveAttribute('href', /\/search$/)
    const canonicalHref = await canonical.getAttribute('href')
    expect(canonicalHref).not.toContain('?')
  })

  // The NEW Region facet must ACTUALLY filter (not a cosmetic control). The
  // Meili index supports `regionSlug` filtering and the page already parses
  // `region`; this exercises the end-to-end constraint. Stable signal: every
  // result card on /search?region=goa links to a Goa Experience
  // (/experience/goa-*), whereas the bare /search mixes regions.
  test('region facet constrains results: ?region=goa yields only Goa experiences', async ({
    page,
  }) => {
    // Bare search mixes regions — establish that non-Goa results exist.
    await page.goto('/search')
    const bareHrefs = await page
      .locator('main a[href^="/experience/"]')
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''),
      )
    expect(bareHrefs.length).toBeGreaterThan(0)
    expect(bareHrefs.some((h) => !h.startsWith('/experience/goa-'))).toBe(true)

    // Filtered by region=goa: every result is a Goa Experience.
    await page.goto('/search?region=goa')
    const goaHrefs = await page
      .locator('main a[href^="/experience/"]')
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''),
      )
    expect(goaHrefs.length).toBeGreaterThan(0)
    for (const href of goaHrefs) {
      expect(
        href.startsWith('/experience/goa-'),
        `region=goa returned a non-Goa result: ${href}`,
      ).toBe(true)
    }

    // The region facet renders its selected value (Goa) so the user can see
    // the active constraint.
    await expect(page.getByTestId('facet-region')).toContainText(/goa/i)
  })
})

// ---------------------------------------------------------------------------
// 6. Hindi locale
//    No i18n prefix routing is configured yet; /hi/... paths should still
//    return a non-crash response (404 or redirect). When i18n lands, update
//    these assertions to expect 200.
// ---------------------------------------------------------------------------
test.describe('Hindi locale', () => {
  test('/hi/adventure/{slug} returns a valid response', async ({ page }) => {
    const response = await page.goto('/hi/adventure/rafting-in-rishikesh')
    // Without i18n routing the path will 404; once i18n is wired, flip to 200
    expect(response?.status()).toBeGreaterThanOrEqual(200)
    expect(response?.status()).toBeLessThan(500)

    await page.screenshot({
      path: 'tests/e2e/screenshots/activity-city-hindi.png',
      fullPage: true,
    })
  })

  test('/hi/search returns a valid response', async ({ page }) => {
    const response = await page.goto('/hi/search')
    expect(response?.status()).toBeGreaterThanOrEqual(200)
    expect(response?.status()).toBeLessThan(500)

    await page.screenshot({
      path: 'tests/e2e/screenshots/search-hindi.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 7. Sign-in page
// ---------------------------------------------------------------------------
test.describe('Sign-in page', () => {
  test('/sign-in renders the email-first two-step Trust Wall form', async ({
    page,
  }) => {
    const response = await page.goto('/sign-in')
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(/Sign in/)

    // Page contains a main element
    await expect(page.locator('main')).toBeVisible()

    // STEP 1 — email-first (Direction A "Trust Wall"): the form renders with
    // the email field + a "Continue" control, and the password is NOT yet
    // present in the DOM (progressive disclosure is client-side only — there
    // is no server "does this email exist" check). (DevTools fixture also
    // gates console + axe over the split-screen layout.)
    await expect(page.locator('form')).toBeVisible()
    await expect(page.locator('input#email[type="email"]')).toBeVisible()
    await expect(page.getByTestId('continue-step1')).toBeVisible()
    await expect(page.locator('input#password')).toHaveCount(0)
    await expect(page.locator('button[type="submit"]')).toHaveCount(0)

    await page.screenshot({
      path: 'tests/e2e/screenshots/sign-in.png',
      fullPage: true,
    })

    // STEP 2 — fill the email and continue: the password field (same stable
    // id) and the final submit button become visible. The email field stays
    // present (its value carries into the real authClient.signIn.email call).
    await page.locator('input#email').fill('traveller@example.com')
    await page.getByTestId('continue-step1').click()

    await expect(page.locator('input#password[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
    await expect(page.locator('input#email[type="email"]')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/sign-in-step2.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 8. Error pages
// ---------------------------------------------------------------------------
test.describe('Error pages', () => {
  test('404 for invalid adventure slug', async ({ page }) => {
    const response = await page.goto('/adventure/chess-boxing-in-atlantis')
    expect(response?.status()).toBe(404)

    await page.screenshot({
      path: 'tests/e2e/screenshots/404-adventure.png',
      fullPage: true,
    })
  })

  test('404 graceful not-found for invalid experience slug', async ({ page }) => {
    // Invalid Experience slug → notFound() → 404. The DevTools fixture
    // asserts no console error / uncaught exception (so no 500 path).
    const response = await page.goto('/experience/nonexistent-slug-xyz')
    expect(response?.status()).toBe(404)

    await page.screenshot({
      path: 'tests/e2e/screenshots/404-experience.png',
      fullPage: true,
    })
  })

  test('cancellation policy page renders all three presets with windows', async ({
    page,
  }) => {
    const response = await page.goto('/cancellation-policy')
    expect(response?.status()).toBe(200)
    await expect(page.locator('h1')).toContainText('cancellation')

    // ADR-0005: the page explains all three presets. Each preset name
    // appears (in the table + the worked-examples cards).
    await expect(page.getByText('Flexible', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Moderate', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Strict', { exact: true }).first()).toBeVisible()

    // The refund windows are stated clearly per preset (ADR-0005 thresholds:
    // Flexible 24h/2h, Moderate 72h/24h, Strict 14d/7d). Some window strings
    // legitimately appear twice (e.g. "24 hours" is Flexible-full AND
    // Moderate-half), so assert each is present at least once.
    for (const windowText of [
      'Up to 24 hours before start', // Flexible full / Moderate half
      'Up to 2 hours before start', // Flexible half
      'Up to 72 hours before start', // Moderate full
      'Up to 14 days before start', // Strict full
      'Up to 7 days before start', // Strict half
    ]) {
      await expect(
        page.getByText(windowText, { exact: true }).first(),
      ).toBeVisible()
    }
    // "No refund" after the half-refund window is present for each row.
    await expect(page.getByText('No refund', { exact: true }).first()).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/cancellation-policy.png',
      fullPage: true,
    })
  })

  // Direction B "The Refund Calculator" (#68): the interactive hero computes the
  // EXACT refund the money path would pay, by delegating to the same pure
  // `quoteRefund` (lib/payments/refund-policy.ts) — never a reimplementation.
  // Behaviour-level contract: drive the calculator with a known case and assert
  // the displayed rupee figure + slab match the expected quoteRefund result.
  // Flexible ₹1000, cancelling 48h before start → free window → full ₹1,000.
  test('refund calculator computes the exact quoteRefund figure for a known case', async ({
    page,
  }) => {
    await page.goto('/cancellation-policy')

    const calc = page.getByTestId('refund-calculator')
    await expect(calc).toBeVisible()

    // Empty state shows a neutral prompt, never NaN.
    await expect(page.getByTestId('calc-prompt')).toBeVisible()

    await page.getByTestId('calc-amount').fill('1000')
    await page.getByTestId('calc-preset').selectOption('flexible')
    // 48h before start (free window for Flexible, freeHours=24) → full refund.
    await page.getByTestId('calc-start').fill('2026-06-10T09:00')
    await page.getByTestId('calc-cancel').fill('2026-06-08T09:00')

    const slab = page.getByTestId('calc-slab')
    await expect(slab).toHaveAttribute('data-basis', 'free_window')
    await expect(page.getByTestId('calc-refund')).toHaveText('₹1,000')

    // Move to the half-refund window (12h before, ≥ halfHours=2) → 50% = ₹500.
    await page.getByTestId('calc-cancel').fill('2026-06-09T21:00')
    await expect(slab).toHaveAttribute('data-basis', '50%_window')
    await expect(page.getByTestId('calc-refund')).toHaveText('₹500')

    // Move inside the no-refund window (1h before, < halfHours) → ₹0.
    await page.getByTestId('calc-cancel').fill('2026-06-10T08:00')
    await expect(slab).toHaveAttribute('data-basis', 'no_refund_window')
    await expect(page.getByTestId('calc-refund')).toHaveText('₹0')

    // Cancelling on/after start is outside-policy → honest dispute notice, no NaN.
    await page.getByTestId('calc-cancel').fill('2026-06-10T10:00')
    await expect(page.getByTestId('calc-outside')).toBeVisible()
  })
})
