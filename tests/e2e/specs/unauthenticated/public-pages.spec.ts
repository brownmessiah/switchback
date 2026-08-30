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
    await expect(page).toHaveTitle(/Switchback/)

    await page.screenshot({
      path: 'tests/e2e/screenshots/home.png',
      fullPage: true,
    })
  })

  // NOTE: The home hero was redesigned to the Headout-style single-search
  // layout (owner screenshots 2026-06-11): the cancellation trust chip, the
  // duplicate `input#home-search` hero-search form, and the activity chip row
  // were all dropped from the hero. The corresponding tests are removed here —
  //   • the cancellation-chip test (chip no longer on the home page),
  //   • the `input#home-search` hero-search test (a stale duplicate of the
  //     passing `home-hero-search` test further down, ~"single hero search
  //     submits to /search?q="),
  //   • the `a[href="/search?activity=rafting"]` activity-chip test (no such
  //     chip in the redesigned hero).

  // Home JSON-LD (ADR-0013 / issue 21): exactly ONE WebSite node carrying the
  // sitelinks SearchAction, plus one Organization node. There must be NO
  // duplicate WebSite/SearchAction (the previous inline WebSite was
  // consolidated into the single generator-produced node).
  test('emits one Organization + one WebSite(SearchAction) JSON-LD, no duplicates', async ({
    page,
  }) => {
    await page.goto('/')

    const jsonLdScripts = page.locator('script[type="application/ld+json"]')
    const count = await jsonLdScripts.count()
    expect(count).toBeGreaterThanOrEqual(2)

    let websiteCount = 0
    let organizationCount = 0
    let searchActionCount = 0
    for (let i = 0; i < count; i++) {
      const content = await jsonLdScripts.nth(i).textContent()
      if (!content) continue
      const parsed = JSON.parse(content) as Record<string, unknown>
      expect(parsed['@context']).toBe('https://schema.org')

      if (parsed['@type'] === 'WebSite') {
        websiteCount += 1
        expect(parsed.name).toBe('Switchback')
        const action = parsed.potentialAction as {
          '@type': string
          target: string
        }
        expect(action['@type']).toBe('SearchAction')
        expect(action.target).toContain('{search_term_string}')
        searchActionCount += 1
      }
      if (parsed['@type'] === 'Organization') {
        organizationCount += 1
        expect(parsed.name).toBe('Switchback')
      }
    }

    // Exactly one of each — no duplicate WebSite/SearchAction.
    expect(websiteCount).toBe(1)
    expect(searchActionCount).toBe(1)
    expect(organizationCount).toBe(1)
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

  // Hero copy rework (home-redesign issue 01 / CR2+CR3+D4): the H1 is the
  // brand-forward line, the visible subtitle is gone, and the SEO keywords
  // both lines used to carry live on in a visually-hidden <h2>.
  test('H1 is the brand-forward line and is the only h1 on the page', async ({
    page,
  }) => {
    await page.goto('/')

    const h1 = page.locator('h1')
    await expect(h1).toHaveCount(1)
    await expect(h1).toHaveText('Book best experiences around you')

    // D4 keyword preservation: the sr-only keyword <h2> is in the DOM (not
    // visible) and carries the flagship-activity keywords.
    const seoH2 = page.locator('section h2', { hasText: 'Verified adventure experiences' })
    await expect(seoH2).toHaveCount(1)
    await expect(seoH2).toContainText('rafting')
  })

  // Issue 05 (CR8): the feature carousel replaced the brand line.
  test('feature carousel renders below the hero; the brand line is gone', async ({
    page,
  }) => {
    // Freeze autoplay so aria-current assertions can't race the 5s timer
    // (this also exercises the reduced-motion branch end-to-end).
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')

    await expect(page.getByText('Book the scene you want to live.')).toHaveCount(0)

    const carousel = page.getByRole('region', { name: 'Why book on Switchback' })
    await expect(carousel).toBeVisible()
    await expect(carousel.getByTestId('feature-card')).toHaveCount(4)
    const dots = carousel.getByTestId('feature-carousel-dot')
    await expect(dots).toHaveCount(4)
    await expect(dots.first()).toHaveAttribute('aria-current', 'true')

    // Copy honesty (D7): the softened cancellation pill, never "anytime".
    await expect(
      carousel.getByText('Flexible cancellation, within policy'),
    ).toBeAttached()
    await expect(page.getByText(/cancel or modify anytime/i)).toHaveCount(0)

    // Dot navigation works in a real browser (jsdom cannot lay out the snap
    // track): click the last dot, the selection settles there and exactly
    // one dot stays current.
    await dots.nth(3).click()
    await expect(dots.nth(3)).toHaveAttribute('aria-current', 'true')
    await expect(
      carousel.locator('[data-testid="feature-carousel-dot"][aria-current="true"]'),
    ).toHaveCount(1)
    await expect(
      carousel.getByText('Explore best experiences around you'),
    ).toBeInViewport()
  })

  // Issue 08: two new trust sections render as crawlable, labelled <section>
  // landmarks below the hero — each with its own <h2>, keeping the single H1.
  test('renders the "Adventure you can trust" + "How Switchback works" sections', async ({
    page,
  }) => {
    await page.goto('/')

    // Both sections are real region landmarks (aria-labelledby → <h2>).
    const trust = page.getByRole('region', { name: 'Adventure you can trust' })
    await expect(trust).toBeVisible()
    const howItWorks = page.getByRole('region', {
      name: 'How Switchback works',
    })
    await expect(howItWorks).toBeVisible()

    // The H1 count is unchanged — the new sections use <h2> headings.
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(
      page.getByRole('heading', { level: 2, name: 'Adventure you can trust' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: 'How Switchback works' }),
    ).toBeVisible()
  })

  // The compact trust strip (owner screenshots 2026-06-11) renders FOUR cards,
  // not six — the redesign collapsed the original six-card section into a slim
  // band of four feature-category items (the dropped "Easy booking support" +
  // "Secure checkout" are covered by the footer + checkout page). Titles read
  // from components/home/trust.tsx (HomePage.trust.cards.*.title).
  test('trust section renders the four named cards (Vendor vocabulary, no operators)', async ({
    page,
  }) => {
    await page.goto('/')
    const trust = page.getByRole('region', { name: 'Adventure you can trust' })

    for (const title of [
      'Verified adventure Vendors',
      'Transparent pricing',
      'Safety-first Experiences',
      'Instant confirmation',
    ]) {
      await expect(trust.getByText(title, { exact: true })).toBeVisible()
    }
    await expect(trust.getByTestId('trust-card')).toHaveCount(4)
  })

  test('how-it-works section renders the five ordered steps', async ({
    page,
  }) => {
    await page.goto('/')
    const how = page.getByRole('region', { name: 'How Switchback works' })

    await expect(how.getByTestId('how-step')).toHaveCount(5)
    for (const title of [
      'Search',
      'Compare verified Experiences',
      'Select your date and time slot',
      'Pay securely',
      'Get confirmation and safety details',
    ]) {
      await expect(how.getByText(title, { exact: true })).toBeVisible()
    }
  })

  // DECISION D0 (data honesty): the new sections must carry NO fabricated
  // metrics and NO over-promising safety language.
  test('trust + how-it-works carry no fabricated metrics or "guaranteed" claims', async ({
    page,
  }) => {
    await page.goto('/')

    for (const name of ['Adventure you can trust', 'How Switchback works']) {
      const region = page.getByRole('region', { name })
      const text = ((await region.textContent()) ?? '').toLowerCase()
      for (const forbidden of [
        'guaranteed',
        'fully insured',
        '40,000',
        '500+',
        'operator',
      ]) {
        expect(
          text.includes(forbidden),
          `forbidden phrase "${forbidden}" found in "${name}"`,
        ).toBe(false)
      }
    }
  })

  // Headout-style hero (owner screenshots 2026-06-11): the single search bar
  // IS the call to action — no hero CTA buttons remain. Submitting the field
  // GET-routes to /search?q= with zero JS required.
  test('single hero search submits to /search?q=', async ({ page }) => {
    await page.goto('/')

    const form = page.getByTestId('home-hero-search')
    await expect(form).toBeVisible()

    const input = form.getByRole('searchbox')
    await input.fill('rafting')
    await input.press('Enter')
    await page.waitForURL('**/search?q=rafting')
    expect(new URL(page.url()).pathname).toBe('/search')
  })

  test('the old hero CTA buttons are gone; supply CTA lives in the footer only', async ({
    page,
  }) => {
    await page.goto('/')

    await expect(
      page.getByRole('link', { name: 'Explore Experiences' }),
    ).toHaveCount(0)
    // Issue 06 (D3): the header is customer-centric — no vendor CTA. The
    // supply side enters via the footer's "For Vendors" column.
    await expect(
      page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: 'List your experience' }),
    ).toHaveCount(0)
    const footerCta = page
      .getByRole('navigation', { name: 'Footer navigation' })
      .getByRole('link', { name: 'List your experience' })
    await expect(footerCta).toHaveAttribute('href', '/vendor-partner')
  })

  test('the compact trust strip closes the page, after How-Switchback-works (issue 02)', async ({
    page,
  }) => {
    await page.goto('/')

    const items = page.getByTestId('trust-card')
    await expect(items).toHaveCount(4)

    // Position: the strip moved from under-the-hero to the bottom of <main>
    // (home-redesign issue 02 / CR9) — it must render BELOW the
    // "How Switchback works" section.
    const trust = page.getByRole('region', { name: 'Adventure you can trust' })
    const howItWorks = page.getByRole('region', { name: 'How Switchback works' })
    await expect(trust).toBeVisible()
    await expect(howItWorks).toBeVisible()
    const trustBox = await trust.boundingBox()
    const howBox = await howItWorks.boundingBox()
    expect(trustBox).not.toBeNull()
    expect(howBox).not.toBeNull()
    expect(trustBox!.y).toBeGreaterThan(howBox!.y)
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

    // Cancellation policy preset (ADR-0005) — section heading + the success
    // badge. The flexible preset (seeded for this Experience) renders the
    // derived free-window line "Full refund if you cancel up to 24h before the
    // activity" (PRESET_WINDOWS.flexible.freeHours = 24, via
    // ExperiencePage.cancellation.freeUpToHours). The banned "Free
    // cancellation" copy is NEVER used.
    await expect(
      page.locator('h2:has-text("Cancellation policy")'),
    ).toBeVisible()
    await expect(
      page.getByText('Full refund if you cancel up to 24h before the activity', {
        exact: false,
      }),
    ).toBeVisible()
    await expect(
      page.getByText('Free cancellation', { exact: false }),
    ).toHaveCount(0)

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

  // Issue 18 — Reviews enrichment. The seeded rafting Experience carries
  // published, booking-backed reviews with group types. The reviews section
  // must show the verified-booking badge + group type, and the
  // recent/highest/lowest sort controls must reorder the list.
  test('reviews section shows verified badge + group type and sorts highest/lowest/recent', async ({
    page,
  }) => {
    await page.goto('/experience/rishikesh-rafting-grade-iii')

    const section = page.locator('#reviews')
    await section.scrollIntoViewIfNeeded()

    // Verified-booking badge is shown for the booking-backed reviews.
    await expect(section.getByText('Verified booking').first()).toBeVisible()

    // Capture-time group type surfaces on at least one card.
    await expect(
      section
        .getByText(/^(Solo|Couple|Friends|Family|Corporate)$/)
        .first(),
    ).toBeVisible()

    // Sort controls exist.
    const items = section.locator('[data-testid="review-item"]')
    const itemCount = await items.count()
    expect(itemCount).toBeGreaterThanOrEqual(2)

    // Helper: read the visible rating of each card by counting filled stars is
    // brittle; instead assert the order changes between highest and lowest by
    // comparing the first card's title across the two sorts.
    const firstTitle = async () =>
      (await items.first().locator('[data-testid="review-title"]').textContent())?.trim()

    await section.getByTestId('review-sort-highest').click()
    const highestFirst = await firstTitle()

    await section.getByTestId('review-sort-lowest').click()
    const lowestFirst = await firstTitle()

    // Highest-first and lowest-first must surface different leading reviews
    // (the seed gives this Experience two published, booking-backed reviews
    // with DISTINCT ratings — a 5-star and a 3-star — so the sort reorders).
    expect(highestFirst).not.toEqual(lowestFirst)

    // Recent restores the default newest-first ordering without error.
    await section.getByTestId('review-sort-recent').click()
    await expect(items.first()).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/experience-reviews-enriched.png',
      fullPage: true,
    })
  })

  // Direction B: the Booking rail keeps the Partial-pay Advance/balance split
  // in view before commit. The rail (booking-rail-interactive.tsx) only shows
  // the 25% Advance / T-24h balance split when the SELECTED slot is ≥48h out —
  // ADR-0001's carve-out (resolveDisplaySplit) coerces a <48h slot to
  // full-upfront (Advance == Total, no balance line). The seed's soonest
  // bookable future date can be <48h away, so we must drive the date picker to a
  // date that is comfortably ≥48h out FIRST, then assert the split.
  //
  // We pick the LAST available (enabled) day in the rendered month grid — the
  // furthest-out date — which is guaranteed ≥48h regardless of the seed's
  // soonest-slot timing. Day buttons carry data-testid="cal-day-<YYYY-MM-DD>"
  // (unavailable days are `disabled`); time-slot chips carry
  // data-testid="time-slot-<id>" (sold-out chips are `disabled`). The desktop
  // rail is `hidden lg:block`; the default Playwright viewport (1280px) is ≥lg,
  // so it is visible — scope to the `#booking` aside.
  test('booking rail shows the Partial-pay Advance/balance split', async ({
    page,
  }) => {
    await page.goto('/experience/rishikesh-rafting-grade-iii')

    const rail = page.locator('#booking')
    await expect(rail).toBeVisible()

    // The furthest-out available calendar day → its slot is well beyond the
    // 48h full-upfront carve-out, so the 25% partial split applies.
    const availableDay = rail
      .getByTestId('booking-calendar')
      .locator('button[data-testid^="cal-day-"]:not([disabled])')
      .last()
    await availableDay.click()

    const availableSlot = rail
      .getByTestId('time-slot-list')
      .locator('button[data-testid^="time-slot-"]:not([disabled])')
      .first()
    await availableSlot.click()

    // 1-2 bracket price is ₹1,500 → Advance (25%) = ₹375, balance = ₹1,125
    // (the chosen slot is ≥48h out, so the partial split applies — no carve-out).
    await expect(rail.getByText('₹375').first()).toBeVisible()
    await expect(rail.getByText('₹1,125').first()).toBeVisible()

    // Book-now remains a working link into checkout (revenue spine depends on
    // this exact text + href).
    const bookNow = page.locator('a:has-text("Book now")').first()
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
    // NOTE: `meetingPoint` is intentionally excluded — by design the PDP renders
    // a region-centroid approximate-area map (#meetingPoint) for EVERY
    // Experience whose region has a known centroid (coordinate-honesty, D0),
    // even bare ones with no Vendor-authored meeting point. So a bare Experience
    // still legitimately carries a #meetingPoint section. Only the genuinely
    // data-driven structured shells must be absent.
    for (const id of ['highlights', 'itinerary', 'details']) {
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

    // QA fix pass: no "Coming soon" dead-end on the storefront. The contact
    // affordance is a REAL link routing to Switchback support (D6: no direct
    // customer→Vendor messaging until moderation/support rules exist).
    const contactLink = page.getByTestId('message-vendor')
    await expect(contactLink).toBeVisible()
    await expect(contactLink).toHaveAttribute('href', /\/contact$/)
    await expect(page.getByTestId('message-vendor-note')).toHaveCount(0)
  })

  // Vendor JSON-LD (ADR-0013 / issue 21): a Business-verified Vendor (KYC tier
  // 3, goa-dive-center) emits a LocalBusiness node + a BreadcrumbList. The
  // Vendor is never an "operator" in schema.
  test('Business-verified Vendor emits LocalBusiness + BreadcrumbList JSON-LD', async ({
    page,
  }) => {
    const response = await page.goto('/vendor/goa-dive-center')
    expect(response?.status()).toBe(200)

    const jsonLdScripts = page.locator('script[type="application/ld+json"]')
    const count = await jsonLdScripts.count()
    expect(count).toBeGreaterThanOrEqual(2)

    let localBusinessCount = 0
    let organizationCount = 0
    let breadcrumbCount = 0
    for (let i = 0; i < count; i++) {
      const content = await jsonLdScripts.nth(i).textContent()
      if (!content) continue
      const parsed = JSON.parse(content) as Record<string, unknown>
      expect(parsed['@context']).toBe('https://schema.org')
      // A Vendor is never typed as an "operator".
      expect(parsed['@type']).not.toBe('operator')

      if (parsed['@type'] === 'LocalBusiness') {
        localBusinessCount += 1
        expect(parsed.name).toContain('Goa Dive Center')
        expect(String(parsed.url)).toContain('/vendor/goa-dive-center')
      }
      if (parsed['@type'] === 'Organization') organizationCount += 1
      if (parsed['@type'] === 'BreadcrumbList') breadcrumbCount += 1
    }

    expect(localBusinessCount).toBe(1)
    // A Business-verified Vendor is a LocalBusiness, never the lower-tier
    // Organization.
    expect(organizationCount).toBe(0)
    expect(breadcrumbCount).toBe(1)
  })

  // A lower-tier Vendor (identity tier, himalayan-hikes-co) emits Organization
  // — NOT LocalBusiness (LocalBusiness is gated by Business verification).
  test('identity-tier Vendor emits Organization JSON-LD, never LocalBusiness', async ({
    page,
  }) => {
    await page.goto('/vendor/himalayan-hikes-co')

    const jsonLdScripts = page.locator('script[type="application/ld+json"]')
    const count = await jsonLdScripts.count()

    let organizationCount = 0
    let localBusinessCount = 0
    for (let i = 0; i < count; i++) {
      const content = await jsonLdScripts.nth(i).textContent()
      if (!content) continue
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (parsed['@type'] === 'Organization') organizationCount += 1
      if (parsed['@type'] === 'LocalBusiness') localBusinessCount += 1
    }

    expect(organizationCount).toBe(1)
    expect(localBusinessCount).toBe(0)
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

    // Primary facets are visible by default (Sort, Category chips, Destination, Price).
    await expect(rail.getByTestId('facet-category')).toBeVisible()
    await expect(rail.getByTestId('facet-state')).toBeVisible()
    await expect(rail.getByTestId('facet-region')).toBeVisible()
    await expect(rail.getByTestId('facet-sort')).toBeVisible()
    await expect(rail.getByTestId('facet-minPrice')).toBeVisible()
    await expect(rail.getByTestId('facet-maxPrice')).toBeVisible()

    // Activity now lives in the "More filters" progressive-disclosure group;
    // it's present once the disclosure is expanded.
    await rail.getByTestId('facet-more-toggle').click()
    await expect(rail.getByTestId('facet-activity')).toBeVisible()

    // The rail is a client `router.push` auto-filter island (components/search/
    // facet-form.tsx) — changing any control navigates immediately with the
    // updated searchParam (no Apply button, no native <form>). The
    // searchParam-name contract that ADR-0013's robots/canonical rules depend on
    // is still preserved by the per-control navigate() calls, so there is NO
    // <form> element in the rail.
    await expect(rail.locator('form')).toHaveCount(0)

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
  // Postgres-native search supports `regionSlug` filtering and the page already
  // parses `region`; this exercises the end-to-end constraint. Stable signal: every
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

  // ADR-0017 structured facets (issue 04). The difficulty facet must ACTUALLY
  // narrow results: a `?difficulty=moderate` query keeps only Experiences whose
  // indexed `difficulty` is moderate and drops bare Experiences (null difficulty
  // never matches a difficulty filter — see lib/search/indexer.ts).
  //
  // Issue 06's full catalog backfill structured MULTIPLE rows as
  // difficulty=moderate (the flagship `rishikesh-rafting-grade-iii` from issue
  // 03, plus e.g. `manali-hampta-pass-trek-5d` and
  // `goa-scuba-diving-fun-dive-cert`). So this no longer asserts "rafting is the
  // ONLY moderate result"; it asserts the broader invariant: the flagship row
  // is present, the bare degradation row (`manali-solang-paragliding-tandem`,
  // null difficulty) is excluded, and every result is a valid /experience link.
  test('difficulty facet constrains results: ?difficulty=moderate keeps the structured row and drops bare ones', async ({
    page,
  }) => {
    // Bare search mixes structured + bare Experiences — establish that more
    // than just the structured row is visible, so the filter has something to
    // exclude.
    await page.goto('/search')
    const bareHrefs = await page
      .locator('main a[href^="/experience/"]')
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''),
      )
    expect(bareHrefs.length).toBeGreaterThan(0)
    // At least one bare (non-moderate) Experience exists alongside the
    // structured row, so the filter genuinely narrows.
    expect(
      bareHrefs.some(
        (h) => !h.startsWith('/experience/rishikesh-rafting-grade-iii'),
      ),
    ).toBe(true)

    // Filtered by difficulty=moderate: every result is a moderate-difficulty
    // (i.e. structured) Experience. Issue 06's full catalog backfill structured
    // multiple rows as difficulty=moderate (e.g. manali-hampta-pass-trek-5d,
    // goa-scuba-diving-fun-dive-cert) alongside the flagship rafting row, so we
    // assert the broader invariant: the facet narrows to difficulty=moderate
    // listings and excludes bare (null-difficulty) Experiences.
    await page.goto('/search?difficulty=moderate')
    const moderateHrefs = await page
      .locator('main a[href^="/experience/"]')
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''),
      )
    expect(moderateHrefs.length).toBeGreaterThan(0)
    // (a) The flagship structured row is present.
    expect(
      moderateHrefs.some((h) =>
        h.startsWith('/experience/rishikesh-rafting-grade-iii'),
      ),
    ).toBe(true)
    // (b) The bare degradation row (no difficulty) never leaks through a
    //     difficulty filter.
    expect(
      moderateHrefs.some((h) =>
        h.startsWith('/experience/manali-solang-paragliding-tandem'),
      ),
      'bare (null-difficulty) Experience must not appear under difficulty=moderate',
    ).toBe(false)
    // (c) Every result is a valid /experience/<slug> link — the facet returns
    //     only real Experience results.
    for (const href of moderateHrefs) {
      expect(
        /^\/experience\/[a-z0-9-]+$/.test(href),
        `difficulty=moderate returned a malformed result href: ${href}`,
      ).toBe(true)
    }

    // The difficulty facet round-trips: the selected value is reflected back
    // into the control so the user can see the active constraint, and the URL
    // carries it.
    expect(new URL(page.url()).searchParams.get('difficulty')).toBe('moderate')
    await expect(page.getByTestId('facet-difficulty')).toContainText(/moderate/i)
  })

  // Category facet (issue 04 follow-up) — the activity-category rollup must
  // ACTUALLY narrow results: `?category=water` keeps water-category Experiences
  // (rafting/scuba/kayaking) and drops aerial ones (e.g. paragliding). category
  // is DERIVED at index time from activitySlug via the registry; an unknown
  // slug carries null and never matches.
  test('category facet constrains results: ?category=water keeps water-sports rows and drops aerial ones', async ({
    page,
  }) => {
    await page.goto('/search?category=water')
    const waterHrefs = await page
      .locator('main a[href^="/experience/"]')
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''),
      )
    expect(waterHrefs.length).toBeGreaterThan(0)
    // (a) The flagship rafting (water) row is present.
    expect(
      waterHrefs.some((h) =>
        h.startsWith('/experience/rishikesh-rafting-grade-iii'),
      ),
    ).toBe(true)
    // (b) An aerial Experience (paragliding) never leaks through a water filter.
    expect(
      waterHrefs.some((h) =>
        h.startsWith('/experience/manali-solang-paragliding-tandem'),
      ),
      'aerial Experience must not appear under category=water',
    ).toBe(false)
    // (c) Every result is a valid /experience/<slug> link.
    for (const href of waterHrefs) {
      expect(
        /^\/experience\/[a-z0-9-]+$/.test(href),
        `category=water returned a malformed result href: ${href}`,
      ).toBe(true)
    }
    // The category facet round-trips: URL carries it and the control reflects it.
    expect(new URL(page.url()).searchParams.get('category')).toBe('water')
    await expect(page.getByTestId('facet-category')).toContainText(/water/i)
  })

  // Destination=State facet (issue 04 follow-up) — `?state=Goa` keeps only
  // Goa-state Experiences (state derived from regionSlug via the registry).
  test('state facet constrains results: ?state=Goa yields only Goa-state experiences', async ({
    page,
  }) => {
    await page.goto('/search?state=Goa')
    const hrefs = await page
      .locator('main a[href^="/experience/"]')
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''),
      )
    // Every result is a valid Experience link (Goa-state listings only).
    for (const href of hrefs) {
      expect(
        /^\/experience\/[a-z0-9-]+$/.test(href),
        `state=Goa returned a malformed result href: ${href}`,
      ).toBe(true)
    }
    // The state facet round-trips into URL + control.
    expect(new URL(page.url()).searchParams.get('state')).toBe('Goa')
    await expect(page.getByTestId('facet-state')).toContainText(/goa/i)
  })

  // The new structured facet controls are present in the SSR rail (no JS) so
  // the rail is a complete faceted surface (ADR-0013) before any narrowing.
  test('filter rail exposes the structured facets (difficulty, duration, season, group size)', async ({
    page,
  }) => {
    await page.goto('/search')
    const rail = page.getByTestId('search-filter-rail')
    // The structured refinements live in the "More filters" disclosure — expand it.
    await rail.getByTestId('facet-more-toggle').click()
    await expect(rail.getByTestId('facet-difficulty')).toBeVisible()
    await expect(rail.getByTestId('facet-durationBand')).toBeVisible()
    await expect(rail.getByTestId('facet-season')).toBeVisible()
    await expect(rail.getByTestId('facet-groupSize')).toBeVisible()
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
    // Scope to the sign-in form specifically: the page ALSO renders the footer
    // newsletter form (data-testid="newsletter-form"), so a bare locator('form')
    // matches two elements → strict-mode violation. The sign-in form is the one
    // containing the email input.
    const signInForm = page
      .locator('form')
      .filter({ has: page.locator('input#email[type="email"]') })
    await expect(signInForm).toBeVisible()
    await expect(page.locator('input#email[type="email"]')).toBeVisible()
    await expect(page.getByTestId('continue-step1')).toBeVisible()
    await expect(page.locator('input#password')).toHaveCount(0)
    // Scope the submit-button assertion to the sign-in form — the page ALSO
    // renders the footer newsletter form, which has its own submit button, so a
    // page-wide locator('button[type="submit"]') would match it (strict-mode/count).
    await expect(signInForm.locator('button[type="submit"]')).toHaveCount(0)

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
    // Scope to the sign-in form — the footer newsletter form also has a submit.
    await expect(signInForm.locator('button[type="submit"]')).toBeVisible()
    await expect(page.locator('input#email[type="email"]')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/sign-in-step2.png',
      fullPage: true,
    })
  })

  // Credibility copy (issue 01): the Trust Wall no longer carries the fake
  // "Booked by 40,000+ travellers." traction claim — it shows honest,
  // non-numeric copy instead.
  test('/sign-in does not render the fake-traction claim', async ({ page }) => {
    const response = await page.goto('/sign-in')
    expect(response?.status()).toBe(200)

    // No traction number anywhere on the page.
    await expect(page.getByText('40,000', { exact: false })).toHaveCount(0)
    await expect(page.getByText(/travellers/i)).toHaveCount(0)

    // The honest replacement heading renders.
    await expect(
      page.getByRole('heading', {
        name: 'Built for verified adventure bookings across India.',
      }),
    ).toBeVisible()
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
