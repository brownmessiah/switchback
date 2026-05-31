# Outvers Modernization — Competitive Research (Refreshed)

> Source intelligence backing the MVP-validation + redesign program. This document
> **supersedes the 2026-05-22 RESEARCH.md** (stale). Every section below is
> **Re-validated live 2026-05-30** via the firecrawl MCP unless explicitly marked otherwise.
>
> **What changed in this refresh:** the four 2026-05-30 live capture passes (discovery+detail,
> checkout+payment, trust+refund, vendor-onboarding) were folded in. Per-surface friction notes
> (click-count-to-book, IA, trust signals, reviews placement, step counts) and the redesign
> archetype mapping are now grounded in dated, screenshot-backed captures rather than the older
> desk-research summaries. The strategic streams from the 2026-05-22 pass (India incumbents,
> global leaders, community/content) are retained below as **STRATEGIC CONTEXT** because they
> still carry the *why* behind PLAN.md decisions — but anything contradicted by the live pass has
> been corrected (notably the "refund-clarity gap vs Thrillophilia" framing, now revised).
>
> Use this when designing a specific module to remember *why* a feature is in the plan and *what
> the bar to beat looks like, surface by surface*.

**Domain language note:** competitor terms are mapped to Outvers' `CONTEXT.md` vocabulary —
Experience, Vendor, Customer, Booking, Availability slot, Wallet, Outvers credit, Refund balance,
Group-size bracket, Combo Experience, Identity/Business verified Vendor — verbatim. Where a
competitor says "activity/tour/product" read **Experience**; "supplier/operator/host" read
**Vendor**; "traveler/buyer" read **Customer**; "credits/cash/voucher" map to **Outvers credit /
Refund balance** in the two-bucket Wallet.

---

## 0. DETAILED CAPTURE FILES + SCREENSHOTS (live 2026-05-30)

This consolidated document integrates four detailed, dated capture files. For verbatim scrape
output, capture logs, and explicit gap notes, see the source files:

| Issue | Detailed capture file | Surfaces covered |
|---|---|---|
| #01 | [`research/01-discovery-detail.md`](../research/01-discovery-detail.md) | GYG + Klook discovery (home/collection/search); GYG + Viator experience-detail |
| #02 | [`research/02-checkout-payment.md`](../research/02-checkout-payment.md) | Klook + GYG checkout/payment + confirmation |
| #03 | [`research/03-trust-refund.md`](../research/03-trust-refund.md) | Indiahikes + Thrillophilia cancellation/refund, trust, wallet/credit |
| #04 | [`research/04-vendor-onboarding.md`](../research/04-vendor-onboarding.md) | Viator + GYG extranet onboarding/listing/calendar/payout; Thrillophilia partner |

### Screenshots (`.scratch/mvp-validation-redesign/research/screenshots/`)

Discovery + experience-detail (#01):
- [`2026-05-30-getyourguide-home.png`](../research/screenshots/2026-05-30-getyourguide-home.png) — GYG home (marketing-landing)
- [`2026-05-30-klook-home.png`](../research/screenshots/2026-05-30-klook-home.png) — Klook home (marketing-landing)
- [`2026-05-30-getyourguide-collection-rome.png`](../research/screenshots/2026-05-30-getyourguide-collection-rome.png) — GYG Rome collection
- [`2026-05-30-getyourguide-search-results-tokyo.png`](../research/screenshots/2026-05-30-getyourguide-search-results-tokyo.png) — GYG search results (ranking disclosure)
- [`2026-05-30-klook-search-results-tokyo.png`](../research/screenshots/2026-05-30-klook-search-results-tokyo.png) — Klook search results (faceted filters)
- [`2026-05-30-getyourguide-detail-uss-midway.png`](../research/screenshots/2026-05-30-getyourguide-detail-uss-midway.png) — GYG experience-detail
- [`2026-05-30-viator-detail-colosseum.png`](../research/screenshots/2026-05-30-viator-detail-colosseum.png) — Viator experience-detail (24,650 reviews)

Checkout + payment (#02):
- [`2026-05-30-klook-singapore-pass-activity-detail.png`](../research/screenshots/2026-05-30-klook-singapore-pass-activity-detail.png) — Klook detail + booking widget (3-axis configurator)
- [`2026-05-30-getyourguide-eiffel-activity-detail.png`](../research/screenshots/2026-05-30-getyourguide-eiffel-activity-detail.png) — GYG detail + inline booking widget
- [`2026-05-30-getyourguide-eiffel-booking-widget-scrolled.png`](../research/screenshots/2026-05-30-getyourguide-eiffel-booking-widget-scrolled.png) — GYG booking widget (scrolled)
- [`2026-05-30-getyourguide-checkout-empty-cart.png`](../research/screenshots/2026-05-30-getyourguide-checkout-empty-cart.png) — GYG checkout shell (empty-cart, 30-min hold)

Trust + refund (#03):
- [`2026-05-30-indiahikes-cancellation-policy.png`](../research/screenshots/2026-05-30-indiahikes-cancellation-policy.png) — Indiahikes dated cancellation policy page
- [`2026-05-30-indiahikes-trek-detail-shield.png`](../research/screenshots/2026-05-30-indiahikes-trek-detail-shield.png) — Indiahikes trek detail + Shield upsell
- [`2026-05-30-thrillophilia-product-cancellation.png`](../research/screenshots/2026-05-30-thrillophilia-product-cancellation.png) — Thrillophilia per-product cancellation slab

Vendor onboarding (#04):
- [`2026-05-30-viator-supplier-signup-lander.png`](../research/screenshots/2026-05-30-viator-supplier-signup-lander.png) — Viator supplier onboarding lander
- [`2026-05-30-getyourguide-supply-lander.png`](../research/screenshots/2026-05-30-getyourguide-supply-lander.png) — GYG supply onboarding lander

---

## 1. DISCOVERY (home / collection / search) — *Re-validated live 2026-05-30*

**Bar to beat:** GetYourGuide (intent-first, lean) + Klook (vertical-first, dense, India-aware).
Detail: [`research/01-discovery-detail.md`](../research/01-discovery-detail.md).

### marketing-landing (home)
- **GYG** makes **search the hero** (H1 "Discover & book things to do" + one prominent
  destination/Experience autocomplete box), only **3 intent nav verbs** (Places to see · Things to
  do · Trip inspiration), then destination/attraction tiles **with Experience counts** ("Vatican
  Museums 466 activities" → signals supply depth), a canonical product-card grid, a **3-pillar
  trust band** (*Experiences worth traveling for / Book with confidence / Plans change and that's
  ok* → free cancellation, pay later, 24/7), and a deep SEO footer (the collection/SEO surface
  lives in the footer) + a payment-method wall (PayPal/Visa/MC/Klarna/Google/Apple Pay/iDEAL).
- **Klook** is denser and **vertical-first**: a mega-menu organised by supply type (Things to do /
  Accommodation / Transport / Travel essentials — a multi-vertical super-app), heavy locale/currency
  switching (**India-aware: English (India) + INR**), category quick-launch icons under search,
  discount-led "Offers for you" merchandising, destination tiles with Experience counts (Tokyo 1000),
  a 4-pillar "Why choose Klook" band, and KlookCash loyalty.
- **Canonical product-card spec** (both, decision-complete before the click): badge
  (urgency/curation — "Likely to sell out" / "Originals/Certified by GYG" / "Klook's choice") · city +
  format · duration + perks (Skip-the-line / Pickup) · **★ rating + review count** · "From ₹X".
  Klook adds **"• NK+ booked"** volume social proof + **Free cancellation + Instant confirmation**
  tokens on every card; GYG leans on rating over volume.

### collection (category / destination landing)
- GYG Rome collection = curated, ranked, scannable product-card grid (same card spec). **SEO title
  leads with the refund promise** ("The BEST Rome Tours … **FREE Cancellation** | GetYourGuide").
  On-card signals: "Top pick", "Likely to sell out" urgency, "Skip the line" perks, review counts,
  "From $X". URL/IA pattern `/{city}-l{id}/` and `/{city}-l{id}/{category}-tc{id}/` — collection IS
  the SEO landing target.

### search-results
- **Klook = stronger faceted filtering:** result-type tabs (All / Tours / Attraction tickets /
  Transport / Hotels), **Dates** (Today/Tomorrow/All), **price-range** slider, **Instant
  confirmation** toggle, location facet, active-filter count + Clear; rich **Sort by** (Recommended /
  Lowest price / Most booked / Top rated / Recently added); numeric pagination (1…67, not
  infinite-scroll).
- **GYG = lighter filters (category chips + Dates) but leads on transparency:** an inline
  **ranking-transparency disclosure** — *"Activities are ranked by popularity, customer ratings,
  performance, availability, diversity, and revenue (including supplier commissions)… rankings are
  algorithmic with no guaranteed positions."* This is a DSA/P2B-style notice. GYG also surfaces
  **per-group pricing** ("From $440 $352 per group up to 7") and a **Provider rating** distinct from
  per-Experience rating (feeds the vendor-profile archetype).

### Discovery friction comparison
- **Click-count to book from home:** both = **search/tile → results → product → book** ≈ 3 clicks
  to the product page; the Booking itself is +1 interaction (date + pax + Check availability).
  Neither books from home.
- GYG is leaner/intent-first (lower cognitive load); Klook is denser/vertical-first (more cross-sell,
  more load). Both put rating + price + cancellation/confirmation tokens at the discovery layer so
  trust is established **before** the click.
- *Capture caveat:* Klook search had a partial SPA-hydration failure below the fold (error tiles are
  a capture artifact, not a UX state); filters/sort + first ~15 cards rendered cleanly.

---

## 2. EXPERIENCE-DETAIL — *Re-validated live 2026-05-30*

**Bar to beat:** GetYourGuide (San Diego USS Midway, 4,018 reviews) + Viator (Rome Colosseum,
24,650 reviews). Detail: [`research/01-discovery-detail.md`](../research/01-discovery-detail.md).

### IA / section order
- **GYG (single long scroll):** breadcrumb + nav → "Official ticket" badge → **H1** → **Top rated ·
  4.9 · 4,018 reviews** (rating+count immediately under title) → **Vendor attribution at the top**
  ("Activity provider: USS Midway Museum", links to a provider page `/{provider}-s{id}/` →
  vendor-profile) → gallery → value prop → **segment social proof** ("93% of English-speaking
  travelers gave a perfect score") → **benefit/assurance row** (Free cancellation w/ explicit
  24-hour full-refund window · Reserve-now-pay-later · validity · skip-line · accessibility) →
  **reviews teaser (high)** → Highlights → Full description → **Includes** → **Meeting point** (Maps
  deep-link) → Know-before-you-go → **sticky booking module** (price → pax → Select date → Check
  availability, refund/pay-later assurance **restated**) → cross-sell → **full filterable reviews
  block** (4.9/5 · sub-rating bars Guide/Transport/Value · **AI review summary** · Sort + Filter ·
  per-review "Verified booking" + photos + "Was this helpful?").
- **Viator** adds a **sticky in-page anchor/jump nav** (Overview · What's Included · Meeting & Pickup
  · Itinerary · Additional Info · Cancellation Policy · Reviews) for long-page wayfinding; a
  **"Lowest Price Guarantee"** price-trust badge; live urgency ("Very popular! 10+ bookings in the
  past 6 hours"); **reviews pushed even higher** (themed filter chips: Great guides / Couple-friendly
  / Amazing sights); a sponsored cross-sell carousel with explicit **paid-placement disclosure**
  ("Viator earns higher commissions on experiences featured here"); **per-component price
  attribution** in What's Included ("Colosseum ticket valued at €18pp… reservation fee €2pp…") +
  explicit exclusions; and a "Customers Who Bought This Also Bought" block that **surfaces competing
  variants of the same attraction** with price + review-count + duration + Free Cancellation.

### Reviews placement
- Both place a **review teaser ABOVE the description** and a **full filterable block low**. GYG adds
  AI summarisation + sub-rating bars; Viator adds theme-chip filtering + raw count emphasis
  (24,650). Every review tagged "Verified booking".

### Experience-detail friction comparison
- **Click-count to book:** product page → Select date → set pax → **Check availability** → choose
  timeslot/option → Reserve/Checkout ≈ **1 page + ~3 in-page interactions** before entering checkout;
  neither requires leaving the PDP to start. Viator's anchor-nav reduces scroll friction.
- **Trust signal density on PDP:** rating + verified-review count under title; free cancellation +
  pay-later (GYG) or Lowest-Price-Guarantee + mobile ticket (Viator); Vendor attribution;
  meeting-point maps; AI review summary (GYG); per-component price breakdown (Viator).
- **Paid-placement / ranking transparency appears on BOTH** (GYG search; Viator carousel) — now a
  standard compliance pattern Outvers should match.

---

## 3. CHECKOUT + PAYMENT + CONFIRMATION — *Re-validated live 2026-05-30*

**Bar to beat:** GetYourGuide (2-screen, email-first, Reserve-Now-Pay-Later default) + Klook
(multi-item cart, credits economy). Detail: [`research/02-checkout-payment.md`](../research/02-checkout-payment.md).

> Method caveat: a real card-charge could not be completed without paying, and `/checkout` redirects
> to an empty cart without a live session. Step structure was triangulated from (a) live PDP booking
> widgets, (b) the live empty-cart/checkout shell + indexed step metadata, and (c) each platform's own
> published step-by-step guides — all corroborating. The authenticated card/3DS screen was NOT
> captured (explicit gap).

### Summary verdict
Both have converged on **"book in place, defer the form-filling"**: date + option + participants are
selected **inline on the PDP** (no separate page load), then a short checkout. They diverge on cart
model and payment-deferral:
- **GYG = single-item, 2-screen, email-first, RNPL default.** Lowest-friction intent-to-book; hold a
  slot with **$0 charged**.
- **Klook = multi-item cart, ~7 nominal steps, account-led, credits/promo economy.** More steps, but
  optimized for bundling many Experiences into one payment + repeat-buyer loyalty.

### Step counts & friction
- **GYG = 2 checkout screens, ~3 clicks to payment, guest-first:** (1) Customer Information —
  **email-first guest checkout** ("Continue with email… create an account later"); (2) **Payment** —
  card or **Reserve Now & Pay Later**. RNPL is a first-class default: **$0 at booking**, multiple RNPL
  items "charged for all at once, **72 hours before the first activity starts**"; eligibility requires
  **free cancellation + instant confirmation**; ineligible items force a separate standard-payment
  checkout (a known edge-case friction). Cart holds items **30 minutes**.
- **Klook = ~7 nominal steps, ~3–4 clicks (logged-in):** sign up/log in (account foregrounded —
  anti-pattern) → browse → add to cart (inline package/date/pax) → check out (multi-item,
  multi-destination cart) → **apply promo / redeem Klook Credits (dedicated step)** → pay → get
  vouchers. The Singapore Pass forces a **3-axis configurator** (pass type × premium × USS add-on)
  before a price resolves, and some combos returned "No passes found" (real dead-end friction).
  Confirmation is a **two-email pattern** (order summary ≠ booking confirmation — a clarity tax).
- **Persistent order-summary rail** on both throughout checkout. **Reviews are NOT shown in
  checkout** on either (kept distraction-free) — they live on the PDP, each linked to the specific
  option/package booked.

### Checkout cross-platform comparison

| Dimension | Klook | GetYourGuide |
|---|---|---|
| Selection location | Inline on PDP (3-axis configurator on pass products) | Inline on PDP (option + date + pax) |
| Nominal steps | ~7 (signup, cart, promo, pay, vouchers) | 2 checkout screens |
| Clicks to payment | ~3–4 (logged-in) | ~3 (guest) |
| Account model | Account foregrounded (Step 1) | **Email-first, account optional** |
| Cart | **Multi-item, multi-destination** | Single-item bias, 30-min hold |
| Pay-later | No | **RNPL default ($0 hold; charge 72h pre-activity)** |
| Loyalty in checkout | Promo + Klook Credits as a step | None (kept lean) |
| Confirmation | Two emails (summary ≠ confirmation) | One booking confirmation + voucher |
| Reviews in checkout | No (PDP section) | No (kept distraction-free) |

---

## 4. TRUST + REFUND CLARITY (India context) — *Re-validated live 2026-05-30*

**Bar to beat:** Indiahikes (policy depth + self-serve dashboard cancel with live refund preview) +
Thrillophilia (inline per-listing slab + social-proof volume). Detail:
[`research/03-trust-refund.md`](../research/03-trust-refund.md).

### REVISED verdict on the "refund-clarity gap vs Thrillophilia" claim
The original 2026-05-22 framing ("we have a refund-clarity gap vs Thrillophilia") is **half-wrong and
now corrected**:
1. **Thrillophilia has NO centralized standard cancellation-policy page.** `/cancellation-policy`
   302-redirects to the homepage (live-confirmed). The only "canonical" answer is a stale (Nov 2021)
   Freshdesk article saying the policy is **per-product and email-delivered** ("review the
   cancellation policies mentioned on the booking voucher").
2. **BUT** every Thrillophilia *product page* carries a concrete, graduated, time-sliced
   cancellation slab inline: **≥30 days → 25% fee; 15–30 days → 50% fee; <15 days → 100% (no
   refund)**; force majeure → "alternate options, no cash refund." It's a templated slab repeated
   across slugs, placed at the **bottom of the page**.
3. **Indiahikes is the actual clarity leader**, not Thrillophilia — a single dated policy page
   (effective Feb 27 2025), 12 sub-policies, a named refund-protection product (**Indiahikes
   Shield**), an explicit **voucher-vs-cash** model, a self-serve "Cancel Trek" dashboard flow that
   **shows the exact refund amount BEFORE you confirm**, and an honest RBI-compliance note (no
   auto-refund >6 months because bank details aren't stored).

**Net:** the bar on **refund clarity** = Indiahikes (policy depth + dashboard cancel with live refund
preview); the bar on **point-of-sale clarity** = Thrillophilia's inline per-listing slab. The
redesign opportunity is to combine both.

### Trust / safety + wallet/credit signals
- **Indiahikes:** Shield as an inline priced upsell (₹750) sold as a *story* ("Why you should opt for
  the Shield" — rain/roadblocks/floods/landslides/permit restrictions), a heavy safety section
  (medical kit, oxygen, gear, trained leaders) + a safety-declaration accordion, on-page named
  reviews with trek dates, IMF official-partner badge. **Voucher-first refunds** (Outvers-credit
  analog): force-majeure suspension → full-fee voucher valid 1 year (not cash); add-on cancels → 96%
  refund (4% txn charge) to original method OR back as voucher if paid by voucher.
- **Thrillophilia:** very social-proof-volume-forward — **12,70,891 reviews (1.27M)**, **4.8★ "Rated
  By 3L+ Travellers"**, an **ET "Best Leisure Tours Brand" award badge** (third-party authority),
  "verified stays, on-ground support," a human-support trust block ("real humans… before, during,
  after"). **Thrillcash** is its wallet currency. Inline term flagged: **100% prepayment, 5% GST**
  (no deposit/partial-pay shown — contrast with Outvers' partial-pay model).

### Trust + refund friction notes
- **Click-count to refund terms:** Indiahikes = **1 click** from any trek detail (Cancellation Policy
  tab) → full dated policy; live refund amount shown **inside** the cancel flow (best in class).
  Thrillophilia = terms exist on the product page but **buried at the very bottom**; brand policy
  requires digging into Freshdesk or the post-purchase voucher email (higher friction).
- **IA:** Indiahikes = centralized, linked from every listing, ToC-structured. Thrillophilia =
  decentralized, no canonical page, per-listing slabs + stale help article + email voucher (clarity
  is real but scattered + time-sliced).
- **Reviews placement:** Indiahikes = named reviews on the detail page with dates; Thrillophilia =
  global review count site-wide in nav + per-product reviews in a sidebar.
- **Trust ranking:** Thrillophilia leads on **social-proof volume**; Indiahikes leads on **safety +
  protection depth + policy transparency**. Both use "real humans / on-ground support" as a lever.

---

## 5. VENDOR ONBOARDING + EXTRANET — *Re-validated live 2026-05-30*

**Bar to beat:** Viator + GetYourGuide self-serve supplier portals; Thrillophilia partner (India
comparator — the anti-pattern). Detail: [`research/04-vendor-onboarding.md`](../research/04-vendor-onboarding.md).

> Gating caveat: the *actual* extranets (Viator Supplier Management Center, GYG Supplier Portal) sit
> behind login + business verification and were NOT directly captured. The gated flows are documented
> via each operator's own official step-by-step + Help Center verification docs (corroborated), plus
> the public onboarding landers. Explicit gaps noted in the source file.

### Onboarding models
- **Viator:** self-serve but **NOT free** — a **one-time, non-refundable $29/Experience submission
  fee** + commission-only after. 5-step sign-up (create account / reuse Tripadvisor login → confirm
  email → **ID/account verification (KYC gate)** → AI "Smart Creator" product builder → submit + pay
  $29 → manual review + 1:1 Launch Assist). Commission rate **opaque until after sign-up**.
- **GYG:** **free to list**, commission-only (**20–30%, country-varying, revealed at the pricing
  step**). Marketed 3-stage funnel + a **6-step registration wizard** (click register → **select
  legal status** *Registered company vs Registered individual* (branches docs) → activity questions →
  contact + company details + **preferred payout currency** → create account → **verify via email**).

### Listing form (the vendor-form reference — GYG 13-step, most complete)
Create → **category** → **title** → **description + highlights** → **locations** → **keywords (~15)**
→ **what's included / not included** → **guide, food & drink, transportation** → **additional info**
(not-suitable-for, what-to-bring, contact) → **photos (min 4, rec 10)** → **product options**
(duration, group size, languages, meeting point, **price**) → **itinerary builder** → **review +
compliance checkbox** → Save and publish. Viator's "Smart Creator" / GYG's "Automated Content
Creator" are AI-assisted description generators.

### Verification / KYC (GYG, fully documented)
Business-type choice is **load-bearing and irreversible** (wrong type → verification fails → contact
support — a known footgun). Registered company needs govt photo ID of verifier + char-by-char legal
name match against registry + registration number (NOT tax/VAT ID) + address + MD name + contact.
In-flow: details → business address → contact (incl. internal-only emergency phone) → automated
registry match → **ID upload** (camera or continue-on-another-device QR) → **selfie liveness check**.
Outcome: mostly auto-verified in minutes, some manual ≤48h, **only 3 attempts total**; status under
Company Profile (Pending/Verified/Declined).

### Availability-calendar / dashboard / payout
- **Availability:** self-serve calendar OR sync from **100–250+ reservation systems / channel
  managers** (Bókun [Viator/Tripadvisor-owned, privileged path], FareHarbor, Rezdy, Ventrata,
  Regiondo…). Viator offers **both calendar AND manifest/roster views** + booking restrictions/cutoffs.
- **Vendor dashboard (GYG):** Analytics snapshot + **Insights** ("Likely to Sell Out" predictions,
  off-peak fill, claims +20% off-peak) + Special Offers + Connectivity + Multilingual (12+ langs).
- **Payout visibility:** Viator = weekly via PayPal OR monthly via bank/Payoneer, **paid after the
  travel date**. GYG = monthly free / bi-monthly with surcharge, pays all **fulfilled** Bookings minus
  commission; needs registration number + tax ID + bank details up front.

### Thrillophilia (India comparator) — KEY FINDING
**No self-serve activity-supplier extranet exists.** The only public "partner" surface is "Advertise
With Us" — a **brand-advertising contact form** (dropdown: Automobiles/Airlines/Travel Gear/Events/
Hotels), selling marketing solutions, NOT an Experience-listing flow. Thrillophilia explicitly states
itineraries are "designed in-house, not picked from a catalogue… not pulled from a supplier list" —
it's a **DMC / in-house operator**, onboarding local Vendors **manually/offline**. No public listing
form, availability calendar, or payout dashboard. **This absence is itself the finding** and the wedge
Outvers exploits in India.

### Vendor-side friction to BEAT
1. **Commission opacity** — both GYG & Viator hide the rate until in-flow → Outvers shows it up front
   (ties to commission-resolution ADRs).
2. **Upfront per-listing fee** (Viator $29) → Outvers: free to list.
3. **Verification brittleness** (GYG: char-by-char registry match, 3 attempts, selfie liveness) →
   Outvers: India-appropriate, forgiving KYC (PAN/GST/Udyam/IFSC) with clear fix-paths, mapping to
   Identity-verified vs Business-verified Vendor states + the vendor-verification ADR.
4. **No self-serve at all** (Thrillophilia) → self-serve is Outvers' India wedge.
5. **Payout-timing opacity** → make "you get paid ₹X on date Y (post-travel-date)" explicit in the
   dashboard; tie to payouts/GST/TDS ADR.

---

## 6. FINDINGS → REDESIGN ARCHETYPE MAPPING — *Re-validated live 2026-05-30*

### marketing-landing (home)
- Make **search the hero** (GYG), not a marketing carousel; one prominent destination/Experience
  search box with autocomplete + rotating popular-query hints (Klook).
- Lead nav with **intent verbs** ("Things to do / Places to see / Trip inspiration"); keep deep
  category permutations in the SEO footer.
- Ship a **3–4 pillar trust band** ("Book with confidence / Free cancellation & flexibility / 24-7
  support") — both leaders have one; Outvers' refund + cancellation ADRs map directly.
- Show **destination/attraction tiles with Experience counts** (supply-depth signal).
- Display an India **payment-method wall** (UPI, cards, netbanking, wallets) as a checkout-trust
  signal in the footer.

### collection (category / destination landing)
- Curated, ranked, scannable **product-card grid**; SEO title leads with the refund/cancellation
  promise. Standard on-card spec: badge · city + format · duration + perks · **rating + review
  count** · "From ₹X" — cards must be **decision-complete**. URL/IA: `/{city}/` and
  `/{city}/{category}/` as SEO targets.

### search-results
- Adopt **Klook-grade faceted filters**: result-type tabs, **price-range**, **Dates**
  (Today/Tomorrow/All), **Instant confirmation** toggle, location facet, active-filter count + Clear;
  rich **Sort by** (Recommended / Lowest price / Most booked / Top rated / Recently added). Numeric
  pagination is acceptable (no infinite scroll required).
- **MANDATORY: ship a ranking-transparency disclosure** ("How we rank") — both GYG (search) and
  Viator (sponsored carousel) expose one; aligns with Outvers' commission-resolution model and
  pre-empts P2B/consumer-law exposure.
- Surface **per-Group-size-bracket vs per-person pricing** explicitly on cards, and a **provider
  rating** distinct from per-Experience rating (feeds vendor-profile).

### experience-detail
- **Vendor attribution + rating + verified-review-count directly under the title**, Vendor name
  linking to a vendor-profile.
- Section order: gallery → value prop → **assurance row** (free cancellation w/ explicit window +
  full-refund wording, pay-later, validity, accessibility) → **reviews teaser (high)** → Highlights →
  Full description → **Includes + explicit exclusions** → Meeting point (map deep-link) →
  Know-before-you-go → booking module → cross-sell → **full filterable reviews block**.
- Add a **sticky in-page anchor nav** (Viator) for long PDPs.
- **Price transparency:** break out ticket/**permit**/fee vs service portion (Viator per-component
  attribution) — strongly relevant to Outvers' permit + commission + GST/TDS money path.
- **Reviews:** teaser above the fold + full block low with sort + filter + sub-rating bars + optional
  AI summary, every review tagged "Verified booking"; consider theme-chip filtering.
- State **free cancellation / refund window TWICE** (assurance row + booking module) — maps to
  cancellation/refund ADRs.

### checkout
- **Collapse selection into the PDP.** Outvers checkout should begin with the Availability slot
  already chosen; the dedicated checkout page is only identity + payment.
- **≤2 screens, email-first, guest-allowed** (GYG floor). Do NOT gate Booking behind account creation
  (Klook Step 1 is the anti-pattern).
- **Persistent order-summary rail** (price, date, cancellation terms) on every screen.
- **Multi-item cart is optional but a differentiator** (Klook) — directly relevant to Outvers' Trip
  Groups / multi-Experience itineraries (single-payment multi-Experience cart).
- **Surface a "hold without paying" / "reserve now, pay later" mechanism** in the checkout box with
  eligibility (free cancellation + instant confirmation) shown up front. Outvers' partial-pay /
  T-24h auto-capture money path is the closest analog to GYG RNPL ($0 at booking, charge 72h before).
- **Put cancellation/refund clarity inside checkout**, not on a separate policy page (where
  Indiahikes/Thrillophilia under-deliver and GYG wins).
- **Handle the ineligible-item edge case gracefully** (GYG blocks RNPL+standard mixing → book
  separately). Outvers must define the equivalent rule for partial-pay-ineligible Experiences.

### confirmation
- **Single, unambiguous confirmation.** Avoid Klook's two-email pattern. Send one "Booking confirmed
  + voucher"; if money-path needs a pending state, label it explicitly "Reserved — balance due
  <date>", not an ambiguous "order summary".
- **Voucher = the redeemable artifact** (booking details + how-to-redeem + cancellation window).
- **Restate the pay-later / partial-pay schedule** on confirmation (when money moves).
- Reinforce trust: instant-confirmation badge, free-cancellation-until-date, 24/7 support handle.

### content-page (trust / cancellation)
- Build a **single, dated, ToC-structured Cancellation & Refund page** (Indiahikes), NOT a
  redirect-to-home (Thrillophilia fails this — cheapest high-trust win).
- **Sell trust as a story, not a clause** (Indiahikes "Why opt for the Shield" / "Why we don't refund
  on shutdown" essay) — narrate the *reason* behind force-majeure-Outvers-credit rules.
- Surface **third-party authority + volume badges** (ET award + review count) as a credibility anchor.
- **Show the refund slab at point-of-sale**, inline near the price (Thrillophilia 25/50/100%), but
  ABOVE the fold, not at page bottom.

### customer-dashboard / wallet
- **Self-serve cancel with a LIVE refund quote before confirm** (Indiahikes) — the headline pattern.
  Ties to Outvers' two-bucket Wallet + refund-flow: compute and display the exact **Outvers credit vs
  cash Refund balance** split *before* the Customer commits.
- **Outvers credit / Refund balance as a first-class refund rail** — label which Wallet bucket a
  refund lands in and its expiry (Indiahikes voucher-if-paid-by-voucher edge case).
- **Group / per-participant cancel** (Indiahikes primary-can-cancel-for-group) — relevant to Trip
  Groups + Group-size brackets.
- **Honest constraint messaging** (Indiahikes RBI >6-month note) — explain *why* and route to support
  when the refund path can't auto-process.
- **Refund-protection upsell** (Indiahikes Shield, priced, addable up to T-20d) — a wallet-adjacent
  monetizable trust product for Outvers' cancellation/refund stack.

### vendor-profile (Outvers differentiator)
- Competitors expose Vendor identity only as a **named provider link from the PDP** (GYG
  `/{provider}-s{id}/`) + a **Provider rating** on search cards — none surface a rich, standalone,
  traveler-facing Vendor storefront (deep vendor management stays in the gated extranet).
- **Opportunity:** a fuller public **vendor-profile** (Identity/Business-verified Vendor badge tied to
  the vendor-verification ADR, aggregate provider rating, response/cancellation track record, all
  Experiences) is a differentiator. Mine GYG "Provider rating" + "Certified/Originals by GYG" as the
  trust primitives.

### Vendor archetypes (onboarding-wizard / vendor-form / availability-calendar / vendor-dashboard / vendor-table / settings-forms)

| Archetype | Best-in-class reference | Copy / improve for Outvers |
|---|---|---|
| **onboarding-wizard** | GYG 6-step register + Viator "reuse existing login" speed | Branch on legal status early (GST-registered vs unregistered). "List in under 30 min." **Reveal commission BEFORE the final step.** **NO upfront fee** (beat Viator $29). |
| **vendor-form** (listing) | GYG 13-step product builder | Adopt the IA almost wholesale + Outvers fields (permits, safety stack per ADRs). AI-assist description generation. Itinerary builder is table-stakes. |
| **availability-calendar** | GYG (self-serve + reservation sync) + Viator (calendar **and** manifest, cutoffs) | Offer calendar + manifest/roster views; booking cutoffs. Plan channel-manager ingestion (Outvers ADR) — external-calendar sync is a known bottleneck. |
| **vendor-dashboard** | GYG (Analytics + "Likely to Sell Out" Insights + Special Offers + Connectivity) | Lead with a performance snapshot + actionable insights; special-offers module; single hub. |
| **vendor-table** | Viator manifest + GYG bookings overview | Sortable Experiences/Bookings table with status + calendar/manifest toggle. |
| **settings-forms** (payout/KYC/profile) | GYG verification + Viator payout cadence | India-localize KYC (PAN/GST/IFSC), forgiving fix-paths (avoid GYG's 3-attempt hostility). Payout cadence + currency in settings. Make payout *visibility* (when/how much, post-travel-date) explicit. Tie to payouts/GST/TDS ADR. |

---

## 7. STRATEGIC CONTEXT (carried from 2026-05-22 desk research — *NOT re-validated live; retained for the "why" behind PLAN.md*)

> The three streams below predate this refresh. They were desk research, not the dated live capture
> pass. Where the live 2026-05-30 pass touched the same competitor (e.g. Thrillophilia refund clarity,
> GYG/Viator/Klook discovery + checkout + vendor onboarding), **Sections 1–6 above are authoritative**
> and supersede any conflicting detail here. These streams remain useful for India-market patterns,
> community/content platforms, and feature-prioritization rationale that the live pass did not cover.

### 7.1 — India incumbents (strategic)
- **Thrillophilia (the gorilla):** SEO moat on `/adventure-sports-in-{city}` + `/tours/{slug}` with
  FAQ schema + price-in-title. Editorial-discovery funnel; Combo Experiences sold heavily.
  Razorpay + UPI + cards, instant-cashback bank tie-ins, EMI on 3K+. **Consistent refund-delay
  complaints (1+ month) across Trustpilot/PissedConsumer/MouthShut — Outvers' biggest opening on
  refund SLA.** *(NOTE: the live #03 pass refined the "refund clarity gap" framing — see §4; the
  refund-SLA pain remains the strategic opening.)*
- **MakeMyTrip Activities:** voucher-based; voucher "usually instant after payment, within 24h in
  unforeseen circumstances" — **the 24h voucher SLA is the industry expectation Outvers must match.**
  UPI/EMI/MMT Wallet/MyCash/Pay-Later; cashback-on-cancellation deducted from refund. MMT Partner
  portal = GST + PAN + Udyam onboarding.
- **Tripoto:** content/community/commerce; demand-generation layer, not a direct competitor —
  partner/syndicate, don't compete.
- **Niche operators:** Indiahikes = gold standard (owns "trek" SEO, policy-as-blog, Green Trails,
  cert displayed). Bikat = small-batch safety positioning, same refund pain. Most are fixed-date
  group-departure with no real-time inventory APIs.

| Dimension | Indian norm | Outvers implication |
|---|---|---|
| **KYC** | Aadhaar OTP (Customers); PAN + GSTIN + Udyam (Vendors) | Aadhaar OTP for Customers; layer PAN+GST for Identity/Business-verified Vendor |
| **Commission** | 15–25% activities, post-experience (T+7); 30% on Combos | `commissionRate` correct; default 18–20% w/ Combo/festival tiers |
| **Payments** | UPI 70%+; Razorpay default; partial-pay ("Pay 25%") standard >₹5K; COD dead; EMI ₹3K+ | **Partial-pay (advance + on-arrival)** — major conversion lift on high-ticket |
| **WhatsApp** | Vouchers, reminders, vendor chat, booking via WhatsApp flows (Interakt/AiSensy/Wati) | `whatsapp.ts`: confirm + T-24h + T-2h + vendor deep-link + post-trip review prompt |
| **SEO** | `/{activity}-in-{city}` wins; FAQ/Product/Review/Breadcrumb schema; listicles → product pages | `/adventure/{activity}-in-{city-slug}` + `/vendor/{slug}` + editorial layer |
| **Pricing** | Dynamic by season/weekend; Group-size brackets (1-2,3-5,6+); festive banners; strike-through | `seasonalPricing` + festival calendar |
| **Trust** | Photo reviews common, video rare (opportunity); guide cert (RMI/NIM/ABVIMAS); ATOAI/ISO | Display ATOAI/guide-cert/insurance; **refund-policy clarity out-trusts Thrillophilia** |
| **Loyalty** | Wallet/cashback > points (MMT MyCash, goCash); referral flat ₹200–500 both-sided | Wallet first (Outvers credit); both-sided referral credit |
| **Group/community** | No one does stranger-matching for adventure well | Trip Groups genuinely differentiated — lean in |
| **India-specific** | Monsoon closures; regional languages; state permits (ILP Sikkim/Ladakh); waivers; veg/Jain flags | Monsoon-aware Availability; multilingual vendor app; per-state permit handling |

**Stream 1 "what to steal" (ranked impact/effort):** (1) refund-policy transparency + SLA-backed
wallet refunds 24–48h; (2) WhatsApp confirm/T-24h/T-2h/review flow; (3) partial-pay 25% advance;
(4) SEO URL refactor + schema + listicle landing pages; (5) monsoon-aware Availability + state
permits; (6) Vendor self-serve onboarding (Aadhaar/PAN/GSTIN/Udyam + cert upload + auto-commission
slabs); (7) Trip Groups stranger-matching with women-only/verified safety; (8) video reviews +
post-trip photo prompts; (9) Wallet + ₹200 both-sided referral + festive banners; (10) editorial/UGC
content layer.

### 7.2 — Global category leaders (strategic)
- **Klook:** AI-first in-destination discovery, map-led nearby feed, Gen-AI (Gemini) listing + search;
  instant-confirm + bundled passes; native-app conversion engine + QR voucher wallet; Bókun-native
  ingestion; Klook Credits loyalty; free-cancellation + reserve-now-pay-later on tiles.
- **GetYourGuide:** Spring 2026 ML search suggestions + AI review summaries (closes the
  planning→booking gap); instant-confirm + free-cancellation-24h inline; Supplier Portal
  "Performance" section + AI-suggested reply inbox; deliberately light on loyalty (conversion
  velocity focus).
- **Viator:** review-volume-led ranking (TripAdvisor pool); instant + request-to-book + RNPL;
  **Partner API v2.0** (structured endpoints for parallel ingestion — B2B distribution play); AI
  Product Builder; "No Show" tool (73% chargeback win); relies on TripAdvisor brand trust.
- **Headout:** card-dense city pages, "Lowest price guaranteed," <3-tap checkout, PWA-first (Vite +
  Tailwind, <2s TTI), curated marketplace, 24/7 chat hero, $209M rev / 651 employees (automation).

**ADOPT:** Bókun/FareHarbor channel ingestion; Viator-style structured Partner API; AI review
summarization (anxiety-driven adventure buyers); AI-assisted Vendor listing generation (#1 supply-side
unlock for Indian operators); fast PWA-grade TTI (RSC streaming); operator AI-suggested-reply inbox;
free-cancellation + reserve-now-pay-later default tile (trust weight 3x in India).
**IGNORE (for now):** heavy loyalty/credits; open-marketplace SKU explosion (curated > breadth for
safety/liability); ChatGPT-plugin external AI distribution (AI-native traveler segment <5% in India).

### 7.3 — Community / content platforms (strategic)
- **Airbnb Experiences (relaunched May 2025):** curated-only after 1.0 supply-quality collapse;
  ID-verified hosts + cert; "Airbnb Originals" halo content; story-led editorial framing.
- **Local-guide marketplaces (Withlocals / ToursByLocals / Showaround):** ToursByLocals manual vetting
  + **reviews only from travelers whose guide confirmed delivery** (kills fake reviews — critical
  pattern for Outvers); rich guide profiles (response time, repeat-booking rate, badges).
- **Strangers-to-buddies (Couchsurfing Hangouts / Meetup):** lightweight intent + radius filter
  (Trip Groups analog); 4-tier verification; **lesson: monetize the supply side, not the social side**
  (Couchsurfing paywall killed trust).
- **Gifting (Tinggly / Cloud9):** open-box (recipient chooses) vs specific-experience gift — ship
  both; code → account → balance redemption; ~2yr validity.
- **Itinerary planners (Wanderlog / TripIt):** Wanderlog wins on Google-Docs-style real-time
  collaboration; AI chat → day plan; export .ics/Maps/PDF.
- **Travel-social (Polarsteps / Travello):** passive auto-tracked diaries > active blogging (lower
  friction = more UGC); Travello group-chat-first = direct Trip Groups analog.
- **Failure modes:** social dies when monetized too aggressively, safety incidents unaddressed, or
  supply isn't curated.

**Stream 3 features to add/fix:** women-verified Trip Groups filter; three-tier Vendor verification
badge on every card; delivery-confirmed reviews only; vernacular content + voice-note reviews;
auto-tracked trip diaries; real-time collaborative itinerary builder; AI trip planner constrained to
Outvers inventory; gift Experiences (open-box + B2B corporate); host video intros + response-time SLA
badges; safety stack (in-app SOS + trusted-contact check-in pings).

---

## 8. SOURCES

### Live 2026-05-30 captures (authoritative)
Full URLs, capture logs, and explicit gap notes live in the four detailed files:
[`01-discovery-detail.md`](../research/01-discovery-detail.md),
[`02-checkout-payment.md`](../research/02-checkout-payment.md),
[`03-trust-refund.md`](../research/03-trust-refund.md),
[`04-vendor-onboarding.md`](../research/04-vendor-onboarding.md).
Primary live surfaces: getyourguide.com (home/collection/search/detail/checkout/contact +
getyourguide.supply onboarding + supply.getyourguide.support verification docs); klook.com
(home/search/activity-detail + how-to-use-klook guide); viator.com (Colosseum detail) +
supplier.viator.com/sign-up-info; indiahikes.com (blog/cancellation-policy + dayara-bugyal-trek);
thrillophilia.com (homepage + product slab + advertise-with-us + Freshdesk article).

### Strategic-context sources (2026-05-22 desk research, retained)
- [Thrillophilia](https://www.thrillophilia.com/) · [Rishikesh listicle](https://www.thrillophilia.com/adventure-sports-in-rishikesh) · [Combo product](https://www.thrillophilia.com/tours/combo-of-rafting-paragliding) · [T&Cs](https://www.thrillophilia.com/terms-and-conditions) · [Trustpilot](https://www.trustpilot.com/review/www.thrillophilia.com) · [PissedConsumer](https://thrillophilia.pissedconsumer.com/review.html)
- [MakeMyTrip Activities](https://www.makemytrip.com/activities/india/river-rafting-by-inbound-adventure-rishikesh-rishikesh-details.html) · [BHIM UPI offer](https://www.makemytrip.com/promos/bhim-upi-offer-100125.html)
- [Tripoto](https://www.tripoto.com/) · [Indiahikes](https://indiahikes.com/) · [Indiahikes cancellation blog](https://indiahikes.com/blog/cancellation-policy) · [Bikat](https://www.bikatadventures.com/)
- [Razorpay refunds](https://razorpay.com/docs/payments/refunds/) · [India vendor onboarding guide](https://www.india-briefing.com/news/guide-to-vendor-onboarding-in-india-34332.html/)
- [GYG Spring 2026 Release](https://www.getyourguide.press/blog/springrelease2026) · [Skift: GYG AI](https://skift.com/2026/04/22/getyourguide-ai-updates/) · [Klook+Google Cloud GenAI](https://www.klook.com/newsroom/partnership-Google%20Cloud-2023/) · [Bokun-Klook](https://www.bokun.io/klook-supplier) · [Viator Partner API v2.0](https://docs.viator.com/partner-api/technical/) · [Viator Extranet Guide 2026](https://automate.travel/blog/viator-extranet-guide-2026/) · [Headout tech stack](https://techlist.ai/headout.com)
- [Airbnb 2025 Summer Release](https://news.airbnb.com/airbnb-2025-summer-release/) · [ToursByLocals Verified Reviews](https://www.toursbylocals.com/travel-blog/verified-reviews) · [Couchsurfing Safety](https://about.couchsurfing.com/about/safety/) · [Tinggly How It Works](https://tinggly.com/how-it-works) · [Wanderlog](https://wanderlog.com/) · [Polarsteps](https://www.polarsteps.com/) · [Jugni — Women-Only India Travel](https://jugni.co.in/) · [NomadHer](https://apps.apple.com/us/app/nomadher-solo-female-travel/id1473787837)

---

*Refreshed 2026-05-30. Sections 1–6 are live-re-validated and authoritative; Section 7 is retained
strategic context (desk research, superseded where it conflicts with Sections 1–6). This document is
intended to become the repo-root RESEARCH.md.*
