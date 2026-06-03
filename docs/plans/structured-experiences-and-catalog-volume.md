# Plan: Structured Experience model + 151-listing catalog

Status: DONE (2026-06-03) — built via /build-using-tdd as a cumulative branch stack
(task/01→07 off main), every slice reviewer-pass. Slice 5 (content) shipped as a
**bounded pilot (~30 new listings)** per owner decision; full-100 is a data-only
follow-up. Slice 3 (vendor form, issue 05) is **awaiting owner sign-off** on the
in-flight listing-form-stepper.tsx (built additive-only, not merged). Live verify:
81 experiences / 70 structured / ≥3 published per region / Meili facets searchable.
Fact-check report: docs/plans/structured-experiences-fact-check-report.md.
Type: Milestone (schema + PDP + vendor form + search facets + content)
Source: user — "seed 100 more listings; make existing data correct and enhance it"

> Produced via `/grill-me`. The six load-bearing decisions below were chosen
> by the owner; this document is the shared understanding to build against.

## Locked decisions

1. **Placement** — the 100 new listings live in a **dev/demo-only** module
   `db/seed-demo-catalog.ts` behind a new `pnpm db:seed:demo`, **NOT** wired into
   `db/seed.ts`, so they never run in the Playwright `global-setup` (suite stays
   fast + isolation contract intact). The divergent `.scratch/demo-catalog.ts` is
   folded in and retired.
2. **Enhance depth** — **full structured model** (not prose-only).
3. **Schema shape** — **hybrid**: scalar quick-facts columns + difficulty enum +
   `text[]` content arrays + one normalized `experience_itinerary_steps` child
   table. (Mirrors the existing `trip_group_itinerary_slots` pattern.)
4. **Authoring scope** — **full path**: migration + detail-loader + PDP render +
   JSON-LD + vendor create/edit form (incl. repeatable itinerary editor) + Zod +
   Server Actions + admin moderation surfacing + ×13 i18n + seed all 151 + reindex.
5. **Correctness bar** — **AI-author + web-grounded adversarial fact-check
   Workflow** for both the 100 new AND the 51 existing (verify altitudes, river
   grades, seasons, permit names, distances, operator-plausible pricing against
   live sources; fix hallucinations).
6. **Search + vendors** — new scalar fields become Meili filterable/sortable AND
   power **/search facet UI now**; add **~12 new dev-only demo vendors** (~20 total
   carrying 151 listings, ~7–8 each).

## Constraints carried from the codebase

- **Controlled vocabulary (ADR-0013):** exactly 10 regions × 10 activities. New
  listings must stay inside this grid; adding a region/activity is a code change
  needing ≥3 published Experiences. 100 new ≈ 3.3 per (region,activity) cell.
- **Two seed paths, one script:** E2E `global-setup` runs `npx drizzle-kit push
  --force` then `npx tsx db/seed.ts` (→ `seedCatalog` in `seed-extras.ts` +
  `seedTripGroups`). PGlite unit harness (`tests/helpers/db.ts`) replays
  `db/migrations/*.sql`. So: schema TS drives E2E; hand-authored `.sql` drives unit
  tests + prod. **Author BOTH.** Migrations are hand-written, numbered — next is
  **0022**. Never `drizzle-kit generate`.
- **Isolation contract** (`seed-extras.ts` header): catalog-namespaced vendors
  only (`u_cat_*`), scope-locked commission/pricing tiers, no closures on E2E
  regions (rishikesh/manali/bir-billing/goa), zero disputed bookings. Enriching the
  existing 32 catalog rows is **additive + nullable** — safe; the 100 new live in
  the dev-only module, never in this path.
- **New columns are NULLABLE** so the additive migration never breaks the E2E
  `drizzle-kit push` seed or any existing PDP/E2E selector.
- **Listing content stays English** in v1 (matches current catalog). ×13 i18n is
  for UI chrome (labels, facets, section headings) — NOT the 151 prose bodies.
- **Slug rule:** region-prefixed, must not start `combo-`, must not impersonate the
  `{activity}-in-{region}` collection URL pattern (app-layer reservation).

## The structured model (exact spec)

### Migration `0022_structured_experience_attributes.sql` + schema TS

New enum `experience_difficulty`: `easy | moderate | challenging | extreme`.

`ALTER TABLE experiences ADD` (all nullable / array-default-empty):

| column | type | notes |
|---|---|---|
| `duration_minutes` | `integer` | total active duration; multi-day in minutes (5d≈7200). `CHECK > 0` |
| `difficulty` | `experience_difficulty` | per-listing (a beginner raft ≠ Grade IV) |
| `min_age` | `integer` | `CHECK >= 0` |
| `max_group_size` | `integer` | operational per-departure cap; distinct from pricing brackets. `CHECK > 0` |
| `languages` | `text[] DEFAULT '{}'` | guide languages: `en`,`hi`,… |
| `meeting_point` | `text` | landmark/address free text |
| `season_months` | `smallint[] DEFAULT '{}'` | months 1–12 it runs; `CHECK season_months <@ ARRAY[1..12]` |
| `highlights` | `text[] DEFAULT '{}'` | 0–6 selling bullets |
| `inclusions` | `text[] DEFAULT '{}'` | |
| `exclusions` | `text[] DEFAULT '{}'` | |
| `what_to_bring` | `text[] DEFAULT '{}'` | |

New table `experience_itinerary_steps` (optional — only multi-day/multi-stop trips):

```
id            uuid PK default random
experience_id uuid NOT NULL FK -> experiences(id) ON DELETE CASCADE
step_order    integer NOT NULL          -- 0-based
title         text NOT NULL
description   text NULL
day_offset    integer NULL              -- day 1 = 0, for multi-day
duration_minutes integer NULL
+ timestamps
UNIQUE (experience_id, step_order)
```

### Shared validation `lib/experiences/structured-schema.ts` (Zod + display helpers)

- `highlights` 0–6 · `inclusions`/`exclusions`/`what_to_bring` 0–15 · each item ≤120 chars
- `languages` ⊆ known set · `season_months` unique ints 1–12
- `duration_minutes` 15–43200 · `min_age` 0–99 · `max_group_size` 1–100
- itinerary 0–30 steps, ordered, title ≤120, description ≤600
- helpers: `formatDuration(min)` → "3 hours"/"5 days"; `formatSeason(months)` → "Jun–Oct"

## Slices (dependency-ordered, TDD — RED first on every slice)

### Slice 0 — ADR + schema + migration (foundation)
- **ADR-0017 "Structured Experience Attributes"** — cross-ref ADR-0011 (pricing),
  ADR-0013 (SEO/facets), ADR-0009 (itinerary pattern). Records the hybrid choice,
  nullability rationale, and search-facet intent.
- `db/schema/experiences.ts` (+ enum), new `db/schema/experience-itinerary-steps.ts`
  (+ relations), export from `db/schema/index`.
- Hand-author `db/migrations/0022_*.sql` (`--> statement-breakpoint` between stmts).
- **RED:** extend `db/schema/experiences.test.ts` + new
  `experience-itinerary-steps.test.ts` — assert columns/enum/FK-cascade/CHECKs via
  PGlite (`setupTestDb` replays the new .sql).
- **Gate:** vitest schema tests green; `drizzle-kit push` builds clean (E2E parity).

### Slice 1 — domain: validation + loaders (pure, PGlite-TDD)
- `lib/experiences/structured-schema.ts` (Zod + helpers).
- `lib/experiences/itinerary.ts` — `loadItinerary(db, expId)` ordered; write helper
  reused by the form action + seed.
- Extend `lib/experiences/detail-loader.ts` — select new columns + load itinerary;
  grow `ExperienceDetailData`.
- **RED-first** unit tests for each (formatting, validation edges, ordered load).

### Slice 2 — PDP render + JSON-LD + i18n
- `app/[locale]/(marketing)/experience/[slug]/page.tsx`: quick-facts strip
  (duration · difficulty · min age · group size · languages), highlights list,
  inclusions/exclusions two-column, what-to-bring, itinerary accordion, meeting
  point. New anchor-nav entries (only render sections that have data).
- JSON-LD: enrich `product` + add a `Trip`/`TouristTrip` node (itinerary + duration)
  in `lib/seo/schemas/`.
- ×13 i18n keys in `lib/i18n/messages/*` (`ExperiencePage` namespace).
- **E2E:** seeded structured listing renders every new section; a11y check.
- **Gate:** `pnpm i18n:check` (13 identical non-empty key sets).

### Slice 3 — vendor authoring + admin moderation
- Extend `app/vendor/(dashboard)/listings/new/actions.ts`,
  `[id]/edit/{schema,actions}.ts`, and `listing-form-stepper.tsx` — new inputs incl.
  a **repeatable itinerary editor** + array editors (highlights/inclusions/
  exclusions/what-to-bring) + scalar facts. New or extended "Details/Itinerary" step.
  ⚠ This edits the listing-form you reworked — see Risks.
- `app/admin/experiences/page.tsx` surfaces new fields (read-only moderation).
- ×13 i18n for form labels.
- **Tests:** action-persists-fields (PGlite integration), form unit tests, E2E
  vendor create→edit round-trip.

### Slice 4 — search facets (index + UI)
- `lib/search/indexer.ts`: add `difficulty`, `durationBand`, `seasonMonths`,
  `maxGroupSize` to `EXPERIENCE_FILTERABLE_ATTRIBUTES` (+ `durationMinutes` sortable);
  map at index time. **RED** on `lib/search/indexer.test.ts` first.
- `/search` facet UI: `components/search/facet-form.tsx` + `filters-sheet.tsx` +
  page query parsing in `app/[locale]/(marketing)/search/page.tsx`.
- ×13 i18n for facet labels.
- **Tests:** indexer settings test, search-filter integration + E2E.
- Note: E2E search tests target the **existing catalog's** structured fields (the
  100 dev-only listings are absent from the E2E seed).

### Slice 5 — content: author 100 new + fix/enrich 51 (the fact-check Workflow)
- **Workflow** (separate invocation): (a) authoring fan-out across the (region×
  activity) grid + ~12 new `u_cat_*` vendors → structured listing records; (b)
  adversarial **web-grounded fact-check** pass (firecrawl/search) verifying every
  claim, fixing hallucinations; (c) synthesis → typed dataset `db/data/demo-catalog.ts`.
- **Existing-51 audit:** same fact-check on current prose → corrections +
  structured backfill applied to `db/seed-extras.ts` (32) and base `db/seed.ts`
  (additive, isolation-safe).
- `db/seed-demo-catalog.ts` (dev-only) reads the dataset: upsert ~12 vendors + 100
  experiences + itinerary steps + media + future slots + a subset of reviews;
  idempotent (deterministic `ns()` IDs + `onConflictDoNothing`). Add `pnpm db:seed:demo`.
- Retire `.scratch/demo-catalog.ts` (folded in).
- Expand the verified Unsplash pool per activity/region (HTTP-200 verify) so 151
  galleries vary.
- Reindex (`.scratch/reindex-search.ts` pattern).

### Slice 6 — verification + docs
- Full gates: `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm i18n:check` ·
  Playwright E2E. CWV/a11y sanity on the redesigned PDP.
- Render-sample audit: spot-check N PDPs + /search facets against the fact-check report.
- Update memory + flip this plan to DONE.

## Risks / watch-items
- **Owner WIP collision:** Slice 3 edits `listing-form-stepper.tsx` (your rework).
  Coordinate / review before merge.
- **E2E seed path:** enriching `seed-extras.ts` is additive+nullable — but if any
  E2E asserts exact PDP copy, new sections could shift selectors. Keep additive-only;
  re-run E2E after Slice 2.
- **Migration in two engines:** the `season_months <@ ARRAY[...]` CHECK must be
  PGlite-compatible (verify in Slice 0 RED).
- **Image link rot:** verify HTTP 200 at author time; keep activity fallback.
- **Fact-check cost:** Slice 5 is the token-heavy Workflow; gated behind owner go.

## Out of scope / fast-follow
- Translating the 151 listing **prose** into 13 locales (content stays en in v1).
- Aadhaar eKYC, Pusher chat (unrelated deferred items).
- Map embed for `meeting_point` (text only for now).

### Follow-ups surfaced during the build (2026-06-03)
- **Scale the demo catalog 30 → 100** — the pipeline (Workflow + `db/seed-demo-catalog.ts`)
  is proven; remaining is data-only (author + fact-check 70 more listings into
  `db/data/demo-catalog.ts`). Owner chose the bounded pilot for this pass.
- **Issue 05 owner sign-off + merge** — vendor `listing-form-stepper.tsx` changes are
  additive-only on `task/05-vendor-form-actions-admin`; review then merge. After merge,
  run the vendor-project E2E (create→edit structured round-trip spec already written).
- **Pre-existing repo lint debt** — `pnpm lint` is red on `main` (~21 errors / 78 warnings)
  in files UNTOUCHED by this milestone (admin/vendor `<a href=/dashboard>`, unused vars,
  owner stepper setState-in-effect). This milestone added zero net lint problems. Clean up
  separately.
- **Pre-existing E2E failures (5)** in the `unauthenticated` project — sitemap/robots 404s
  (dev-server metadata-route artifacts), footer "Help centre" link, a wishlist control —
  fail identically on base `main`, unrelated to this milestone.
- **Dev reindex script** (`.scratch/reindex-search.ts`) doesn't flush stale Meili docs
  (leftover cross-surface beacons from prior dev runs); harmless for facets but the index
  carries junk. The E2E `meili-setup.ts` flushes correctly.
- **difficulty=moderate E2E** (public-pages.spec.ts) proves narrowing via a single
  bare-row-excluded check; could be strengthened to assert every result is difficulty=moderate.

## Suggested execution order
Slices 0→1→2→4 are the schema→read→render→discover spine and can ship first as a
reviewable PR. Slice 3 (vendor form) and Slice 5 (content Workflow) are the two
large independent efforts; Slice 5's Workflow can run in the background while 3 is built.
