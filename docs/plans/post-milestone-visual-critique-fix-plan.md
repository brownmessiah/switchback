# Post-milestone visual/UX critique — fix plan

Date: 2026-06-03 · Source: 5 UI-critique subagents over 65 screenshots (every page, all 4 role
surfaces) of the running app on the structured-experiences branch. Raw findings:
`.scratch/screenshots-critique/critique-{public,customer,vendor,admin-a,admin-b}.md` + the
screenshots in `.scratch/screenshots-critique/{public,mobile,customer,vendor,onboarding,admin}/`.

Tally: **~13 P0 · ~72 P1 · ~43 P2.** The structured-experiences PDP itself was rated the
strongest page in the set ("the bar other pages should meet") and `experience-bare` degrades
correctly — so the milestone feature lands well. Most findings are **demo-data realism** and a
handful of **real layout bugs**, not the new feature.

The work splits into four workstreams. **Seed realism (A)** is the cheapest, highest-impact for a
demo; **layout bugs (B)** are the real code defects; **C/D** are feature polish and a11y.

---

## A. Seed / demo-data realism  ← biggest cluster, mostly `db/seed*.ts`

The recurring complaint across customer + vendor + admin: the app looks like a test DB, not a real
marketplace. These are mostly seed fixes (high demo ROI, low risk; the dev-only `db:seed:demo` +
base `db/seed.ts`/`db/seed-extras.ts`).

**A0 (demo-critical):**
- **QA fixtures leak into customer + admin lists.** The seed customer's dashboard and `/admin/bookings`
  are dominated by `Commission Scope Fixture — Bir Billing (admin #26)`, `Review Moderation Fixture
  (admin #27)`, `(Identity Tier)` / `(admin #…)` rows. → Give the demo customer (and the admin
  bookings demo) realistic, varied, deduplicated bookings against real Experience names; exclude
  the admin/E2E **fixture** experiences from customer-facing queries (they exist only for E2E and
  should never appear in a human demo).
- **Contradictory booking badges + future "Completed" dates.** Cards show `Completed + Upcoming`
  and `Cancelled + Upcoming`, and trips dated 10 Jun 2026 are "Completed" while today is ~3 Jun.
  → Two fixes: (1) seed completed trips with **past** dates; (2) derive ONE lifecycle badge +
  ONE time badge (suppress "Upcoming" on terminal states) — this is also a code fix in the
  booking-card component.
- **Wallet ledger doesn't reconcile.** ₹500 Refund balance + ₹200 credit shown, but the ledger has
  a single +₹200 promo row. → Seed refund/credit/debit rows that **sum to** the displayed balances
  (the Hampta cancellation should produce a refund-balance credit row).
- **Empty vendor-detail KYC.** `/admin/vendors/[id]` (the tier-promotion review screen) shows six
  "Not submitted" tiles + "About: Not provided" + all-zero trust factors, yet offers "Approve →
  Identity". → Seed at least one Identity/Business vendor with **submitted KYC docs** (PAN/Aadhaar/
  GSTIN thumbnails) so the moderation flow is demonstrable; give genuinely-bare vendors a real
  empty-state, not six grey tiles.

**A1:**
- **Undifferentiated vendors** — all ~26 show Commission 20% / SLA 100% / Joined 3 Jun 2026.
  → Vary commission tiers, SLA scores, staggered join dates.
- **Analytics charts read as broken** (`/admin/analytics`) — flat ₹0/0 for ~13 months then one
  spike, because all seed data is dated in the last weeks. → Either spread seed dates historically
  OR default the chart window to the active data range / add a range selector (code).
- Thin content: single review for the business vendor; one message thread; near-empty availability
  calendar; refunds only "Pending"; reviews all "Visible" on a moderation screen. → Seed variety
  across states so each surface demonstrates its filters/sorting.
- Placeholder profile gaps: customer address/trusted-contact blank; vendor bank **account-holder
  name** empty; blog covers show placeholder glyphs in `/admin/blog`. → Seed real values / render
  real thumbnails.
- Raw identifiers in operator UI: `/admin/region-closures` shows raw slugs (`leh-ladakh`); `/admin/
  support` "Assigned To" shows `u_seed_a…`; loyalty/booking refs show raw UUIDs. → Render display
  names; short human refs (e.g. `OV-3F50`) with the UUID behind copy.

---

## B. Layout / render bugs  ← real code defects

**B0 (demo-critical):**
- **Vendor `listing-edit`: sticky "Continue / Save changes" bar overlaps the Photos dropzone**
  (hides "0/10 images"). Only breaks on edit (longer form). → Real sticky-footer treatment: solid
  bg + top border + bottom `padding`/`scroll-margin` on the form so the last field clears the bar
  (`app/vendor/(dashboard)/listings/listing-form-stepper.tsx` / the edit form shell).
- **Vendor dashboard: SLA-score pill clipped to "Exc…"** (4-up stat row too narrow) **and the
  Revenue chart y-axis is garbled** (`0,000` / `'7,500` — ₹/digit clipped + stray punctuation from
  the currency-tick formatter). → Wrap/shrink the pill (or 2×2 grid); fix the chart tick formatter +
  widen the y-axis gutter.
- **`search-faceted` group-size placeholder leaks "Fits at least N people"** — literal dev `N` in
  the UI. → Real copy / a numeric stepper (`components/search/facet-form.tsx`). *(One-word fix; do
  this first.)*

**B1:**
- **Admin table clipping:** `/admin/commission` "Bookings" column header+values clipped off the card
  edge; `/admin/disputes` "Actions" button clipped to "Complete…". → Let the table scroll / stack the
  detail panel below on narrow widths / move redundant table actions into the detail rail.
- **Admin page-shell width inconsistency** — some admin routes render at a different max-width/scale
  than others (sidebar typography differs). → Audit that every `/admin/*` route uses the standard
  admin layout wrapper / one max-width container.
- **Review text overflow** past the column edge (vendor `reviews`, admin `reviews`). → Clamp/wrap;
  fixed Response column width.
- **Customer "N" floating badge** overlaps content bottom-left on every account page. → Confirm
  it's not the dev indicator; if it's a real element, fix z-index/position so it never overlaps.
- **Card image aspect-ratio inconsistency** on home/search grids. → Lock 4:3 `object-fit: cover`.

---

## C. Feature presentation & marketing polish

- **Search facets feel generic** — all native select/text inputs, so the new structured facets
  (difficulty/duration/season/group-size) don't feel more capable than a plain sidebar. → Chip /
  segmented controls for the low-cardinality facets (difficulty, duration band, season). (This is
  the one place the *new feature* could present better.)
- **Itinerary accordion unverified** — the screenshotted structured listing (a 1-night eco-camp)
  had no Itinerary section, so the headline accordion isn't proven in the set. → Verify on a
  multi-day trek listing; ensure the PDP sub-nav adds an "Itinerary" anchor when steps exist.
- **Home hero subtitle low-contrast** white-on-busy-photo (desktop + mobile). → Add a darkening
  scrim behind hero copy.
- **Sign-in primary CTA is pale pink (looks disabled) + non-brand focus ring.** → Brand crimson
  for the auth CTA + focus ring.
- **Duplicate hero imagery across listing grids** (`/adventure/*`, `/activities/*`, `/category/*`):
  every card uses the same activity stock photo. → Source per-listing `media_assets` cover on
  collection cards (seed already creates 6 photos/experience); fall back to activity-tinted
  gradients, not one repeated photo. *(Borderline A/seed + C/code.)*
- Empty/sparse public states (vendor-profile, contact, trip-planner, wishlist, support): add
  illustrations + a primary CTA so indexed/shared URLs aren't dead ends.
- **Mobile:** add a sticky bottom "Book now" bar on the PDP so booking is reachable without
  scrolling the whole page.

## D. Accessibility

- **Status-by-color-alone** on the **customer dashboard** booking pills and the **vendor bookings
  table** (Confirmed vs Completed both greenish). → Pair color with icon + text label + non-color
  weight (the **admin** surface already does this correctly — use it as the reference).
- Contrast: amber "50% refund" text (cancellation table) and support **Priority** Medium-vs-High
  hues are too close. → Darken amber to AA; use amber(Medium)/red(High) with an icon.
- KYC tier badges all-green on `/admin/vendors` — use a tier ramp so Business ≠ Phone visually.

## E. Global chrome (P2)
- Footer `(soon)` tags on Help centre / Contact us / Vendor KYC across all surfaces look unfinished
  → hide unbuilt links or subtler treatment. Consumer marketing footer renders inside the admin +
  vendor back-office → use a minimal portal footer there.

---

## Recommended execution order

1. **Demo quick wins (½ day):** B0 "N people" leak; B0 vendor-edit sticky-bar overlap; B0 vendor
   dashboard pill+chart; A0 fixture-leak + badge/date logic; sign-in CTA color; hero scrim. These
   remove every "looks broken" first impression.
2. **Seed realism pass (A0/A1):** one focused edit to `db/seed.ts` / `db/seed-extras.ts` /
   `db/seed-demo-catalog.ts` — varied vendors, reconciled wallet ledger, KYC-doc'd vendor, historical
   dates, realistic customer bookings, multi-state refunds/reviews. Highest demo ROI.
3. **Layout bugs (B1):** admin table clipping + shell-width audit + review overflow.
4. **Feature polish (C) + a11y (D):** facet chips, itinerary verify, status-by-color fixes.
5. **P2 polish (E)** last.

Each fix should follow the repo TDD/verification norms; UI-only changes verified by re-screenshotting
the affected route with `.scratch/screenshot-all.mjs`. This plan is intentionally a *plan* — no code
changes were made as part of producing it.

---

## Status — 2026-06-04 (demo-polish pass)

**Done (committed to `main`):**
- **B0 quick wins** (`bd7c50c`): vendor revenue-chart tick formatter (TDD'd `formatAxisTick` →
  ₹7.5K/₹10L/₹2.5Cr) + wider gutter; SLA pill no longer clipped; vendor listing-edit sticky bar no
  longer overlaps the Photos dropzone; sign-in CTA full brand crimson; deeper hero scrim. The B0 "N
  people" group-size leak was already fixed in a prior pass.
- **A0 seed realism** (`bc2b360`): fixtures excluded from the customer dashboard + `/admin/bookings`
  (shared `lib/experiences/fixture-slugs` registry); ONE coherent lifecycle badge + suppressed
  "Upcoming" on terminal states (TDD'd `deriveBookingBadges`); demo customer reshaped to a varied
  real-experience history; wallet ledger reconciled (refund ₹500 = +650−150, credit ₹200 = +200);
  KYC-doc'd vendors (goa-dive-center business, himalayan-hikes-co identity).
- **Imagery + feature C items** (`de5674f`, `f13b8ee`, `89a3a05`): the duplicate/mis-tagged hero
  imagery (C) is fixed — 10×6 visually-verified on-subject pools + distinct per-listing galleries +
  distinct PDP gallery tiles; plus the requested /search keyword box, grid/list toggle, and the #70
  booking-rail date picker.

**Verification note:** all of the above are unit-tested (2051 green), typecheck/lint/i18n clean, and
DB-/visually-verified on the running demo. The **authed E2E projects (admin/customer/vendor) could not
be run** in the local env this pass — the long-running reused dev server's session auth is broken
(untouched specs 404/redirect too), an environmental issue, not these changes. Run the authed E2E in
CI / a clean `pnpm dev` to close that gap.

**Residual / follow-ups (not done):**
- Some of the demo customer's `completed` bookings still sit on FUTURE slots (the review-generation
  seed paths reuse the T+7d demo slots to attach Issue-#11 reviews). The badge contradiction is gone,
  but a "Completed" card can still show a near-future date + sort among upcoming. Fixing needs the
  review-generation paths to use past slots without disturbing #11 review determinism.
- A1 (undifferentiated vendors, historical analytics dates, thin content), B1 (admin table clipping +
  shell-width audit + review overflow), remaining C (itinerary verify, empty-state art, mobile sticky
  Book-now), D (status-by-color a11y), E (footer `(soon)` tags) — untouched this pass.
