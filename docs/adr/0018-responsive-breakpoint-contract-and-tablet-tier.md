# Responsive breakpoint contract & tablet tier

## Context

The redesign (DESIGN.md, all 45 routes / #63–107) was authored and verified at a single viewport: `playwright.config.ts` runs `devices['Desktop Chrome']` only, so the per-test axe gate in `tests/e2e/fixtures/devtools.ts` has only ever proven AA at desktop width. The token system bumps section rhythm at `48rem` and grid gutter at `64rem` (`app/globals.css`) but has no breakpoint token, no touch-target token, and no container token — there is no codified contract for *what restructures, where, and how well*.

The surfaces degrade unevenly. Marketing and customer pages mostly reflow on raw Tailwind utilities; the dense back-office does not. The admin and vendor sidebars are hand-rolled fixed-overlay drawers (`app/admin/admin-sidebar.tsx`, `app/vendor/vendor-sidebar.tsx`: `fixed inset-0 … lg:hidden` + a `w-72` panel) that are *not* on the Sheet primitive, so they lack focus-trap / Escape / restore. The ~24 data tables follow A3's "horizontal-scroll" rule. The admin ledger (`app/admin/_components/admin-ledger-layout.tsx`: `lg:grid-cols-[minmax(0,1fr)_24rem]`) and the PDP booking rail are `lg`-only split layouts with no defined sub-`lg` fallback. DESIGN.md §5 already commits to "44px min touch targets (India mobile-first)," but the shared controls ship at `h-8` (32px) and the participant stepper at `size-9` (36px) — asserted and unmet. (The checkout order-summary `<aside>` is already `lg:sticky lg:top-6` in `app/(app)/checkout/checkout-form.tsx`; on a 1-col mobile layout it renders *after* the Pay button, so the fix is a mobile DOM reorder, not new sticky behaviour.)

This ADR records the responsive contract for the task "Make UI mobile responsive": the breakpoint tiers, the quality bar, the deliberate reversal of A3, the touch-target floor, and the two surfaces allowed to stay desktop-only. It is the *why*; DESIGN.md §8 is the *how* (the per-pattern flip rules and the responsive primitives). CONTEXT.md is untouched — "responsive," "breakpoint," and "tablet" are general UI concepts, not Outvers domain terms.

## Decision

A **bespoke three-tier breakpoint contract** with a hard device floor, **uniform excellence on every surface**, a coarse-pointer touch-target floor, and exactly two `lg`-only exceptions. Tailwind v4 defaults are kept verbatim (`sm` 640 / `md` 768 / `lg` 1024) — no breakpoint overrides, no new token — so the contract rides the existing `md:`/`lg:` prefixes and the two token bumps already in `app/globals.css`.

- **base** `< 768px` — mobile. **Hard floor 360px:** nothing clips and the page never horizontal-scrolls at 360 (intentional inner-scroll strips that already use `.scrollbar-none`, e.g. the PDP anchor nav, are exempt).
- **tablet (`md`)** `768–1023px` — iPad portrait earns its own treatment, not a stretched phone or a cramped desktop.
- **desktop (`lg`)** `≥ 1024px`.

Structural flips are **lowered to `md` wherever the tablet width carries the richer layout**, rather than defaulting every flip to `lg`. The eleven per-surface flip rules live in DESIGN.md §8.3; the spine is: site header (hamburger → inline nav — the one deliberate `sm` flip, since four short links fit at 640), card grids (1→2→3-col), search filters (Sheet → Sheet → rail), checkout (1-col summary-hoisted → 2-col → 2-col), wallet/money cards (stacked → 2-col, no third column at `lg`), back-office sidebar (drawer → icon-rail at `md` → label-rail at `lg`), data tables (cards → table at `md`), ledger split-view (detail-Sheet → side-by-side at `lg`), PDP booking (bottom-Sheet → side-rail at `lg`), forms/wizards (1-col → 2-col field groups at `md`), dashboards (1 → 2 → 3–4-col).

**Uniform excellence, not "nothing breaks."** All four surfaces — marketing (`app/[locale]/(marketing)`), customer app (`app/(app)`), vendor extranet (`app/vendor`), admin (`app/admin`) — are held to one bar. The densest, most table-heavy surfaces get the *most* bespoke mobile work, because that is where naive reflow fails worst.

**Reversal of A3.** A3 currently mandates `Card > CardContent p-0 > Table`, horizontal-scroll for the ~24 list surfaces. This reverses it below `md`: a shared `<ResponsiveTable>` renders the `Table` primitive at `≥ md` and a stacked label:value Card list `< md` (each row → one card titled by a per-table primary column, status `Badge` and right-aligned `.tabular-nums` figures preserved). Horizontal-scroll survives only as the `md`-tablet/desktop fallback, never the phone default.

**44px coarse-pointer touch-target floor.** Interactive controls present a ≥44×44px target on coarse pointers, gated on `@media (pointer: coarse)` so fine-pointer desktops keep the dense 32/36px controls. "India mobile-first" (ADR-0012) makes this an accessibility requirement, not polish.

**Six shared foundations** carry the contract so routes do not re-implement it: (1) the `@media (pointer: coarse)` touch-target floor; (2) `<ResponsiveTable>` (the A3 reversal); (3) a Sheet-based portal nav drawer replacing both hand-rolled back-office drawers (gaining the focus-trap / restore / Escape that `components/search/filters-sheet.tsx` already has); (4) a PDP sticky bottom bar → bottom Sheet wrapping the existing `BookingRailInteractive` island, active `< lg`; (5) the checkout order-summary hoisted above the stepper on mobile; (6) the admin ledger detail rendered as a Sheet `< lg`.

**Two `lg`-only exceptions** — panels too wide to dock beside their content at 768px. The **admin ledger detail** (a fixed `24rem` column leaves ≈360px for the list at 768px → detail-as-Sheet below `lg`) and the **PDP booking side-rail** (the booking Card — calendar + stepper + price breakdown + assurances — needs ~22rem, which at 768px leaves the gallery and long-scroll description under ~26rem → sticky bottom bar + bottom Sheet on base and tablet). Every other flip lowers to `md`; these two name a concrete width reason. New split-view / side-rail surfaces default to lowering at `md` and must justify a width before pinning to `lg`.

This clears the three-part ADR test: **hard to reverse** (encoded across 45 routes + three shared primitives; unwinding it re-touches every surface and the test matrix); **surprising** (it reverses a *written* DESIGN.md rule — A3 horizontal-scroll → card-collapse — and adds a third tier most marketplaces omit; a future engineer reading "horizontal-scroll" in A3 without this record would do the wrong thing); **a real trade-off** (three tiers triple the test surface on restructured pages and the `<ResponsiveTable>` card mode is per-table config — paid for uniform excellence over a cheaper two-tier bar).

## Why not the alternatives

- **Two-tier mobile | desktop (no tablet).** The marketplace default and the cheaper option. Rejected: a 768px iPad-portrait viewport comfortably holds a 2-col grid, a 2-col checkout, a real data table, and a slim icon-rail — collapsing it to the phone layout wastes that width and stretching the desktop layout crowds it. The middle tier reuses the same `md`/`lg` utilities with no new token, so its cost is bounded.
- **Enhanced-mobile (tablet = a big phone; flip at `lg`).** Keep one mobile layout up to 1024px. Rejected: it pushes *every* flip to `lg`, so 768–1023px renders 1-col grids, stacked cards, and a drawer sidebar on a viewport that holds two or three columns — under-built on exactly the device the tier exists to serve. This contract takes the inverse default: lower to `md`, pin to `lg` only the two panels that genuinely don't fit 768px.
- **Keep A3 horizontal-scroll on phones.** The path of least resistance. Rejected: horizontal-scroll inside a vertically-scrolling page is a known mobile failure — the status Badge and money figures (the load-bearing cells of every money queue) sit off-canvas. `<ResponsiveTable>` keeps every cell on-screen and reuses the A1 Card idiom.

## Consequences

- **DESIGN.md §8 is the codified home** of the per-surface flip rules, the six primitives, and the verification model; this ADR is the *why* it points back to. A3's "horizontal-scroll" prose is amended inline there, and A4 / B1 / B3 / B6 gain tablet-tier flip notes (DESIGN.md §8.7).
- **No new tokens.** The contract rides Tailwind defaults and the two existing bumps in `app/globals.css`; there is deliberately still no breakpoint, touch-target, or container token. The touch-target floor is a single `@media (pointer: coarse)` base-layer rule keyed off the primitives' `data-slot` attributes, so steppers, slot chips, pagination, table row-links, and Sheet/Dialog close buttons inherit it without per-component edits.
- **The two hand-rolled drawers are deleted** for the Sheet-primitive portal drawer. Reviewers must not "fix" desktop controls to 44px (that breaks the intended fine-pointer density), and must keep the two `lg`-only exceptions as exceptions — every *other* split flips at `md`. (A coarse-pointer touchscreen laptop ≥1024px correctly gets 44px targets; the "no desktop visual change" promise is about fine-pointer mice.)
- **Verification is gated, not aspirational.** `playwright.config.ts` gains a **phone (375px)** and a **tablet (768px)** project that re-run the suite under the same per-page axe gate (`wcag2a + wcag2aa`) at each width. Viewport-aware specs cover the restructured surfaces — the **375px** project asserts the `<ResponsiveTable>` card-collapse, the booking bottom-Sheet, the sidebar drawer, the checkout hoist, and the ledger detail-Sheet; the **768px** project asserts the table form (768 = `md` min), the filter Sheet, the icon-rail, and the 2-col checkout — and each new Sheet asserts focus-trap / Escape / restore and the ≥44px hit area under `pointer: coarse`. A scripted screenshot audit at **360 / 768 / 1280** across all 45 routes is the Phase 0 baseline and is re-run after each surface sweep; its triaged defect list is the acceptance artifact. Execution: Phase 0 baseline → cross-cutting foundations → per-surface sweep (consumer → vendor → admin, orchestrated), TDD per repo policy.

## Cross-references

- **ADR-0012 (Multi-locale strategy)** — the tier-2/3 mobile-first audience that makes the 44px touch-target floor an accessibility requirement, not a polish item.

## Amendment — homepage feature carousel (home-redesign issue 05, 2026-07-14)

A3's "no horizontal scroll" rule gains one **intentional, documented
exception**: the homepage feature carousel (`components/home/
feature-carousel.tsx`, CR8). It is a snap-locked, one-card-per-view
scroll-snap track — swipe is the *primary* gesture, not an overflow
accident; dots + autoplay make every card reachable without scrolling at
all; and the track is confined to its own `<section>` (the page body still
never scrolls horizontally, which is what A3 actually protects). Reviewers
must not "fix" this track into a stacked list.
