# Structured Experiences milestone — verification record (issue 07)

Date: 2026-06-03 · Branch stack: `task/01-…` → `task/07-verification-docs` (off `main`, cumulative).
Authoritative design: `structured-experiences-and-catalog-volume.md`. Fact-check: `structured-experiences-fact-check-report.md`.

## Gate results (fresh evidence)

| Gate | Command | Result |
|---|---|---|
| Types | `pnpm typecheck` | exit 0 |
| Unit/integration | `pnpm test` (vitest) | **1933 passed \| 1 todo** (171 files) — up from 1824 at milestone start (+109) |
| i18n | `pnpm i18n:check` | PASSED — 13 locales in sync (747 keys) |
| Lint | `pnpm lint` | red **only on pre-existing debt** (~21 errors / 78 warnings in files UNTOUCHED by this milestone; identical count on `main`). This milestone adds **zero** net lint problems. |
| E2E | `pnpm e2e` (6 projects) | milestone specs green; see E2E analysis below |

## Live data verification (fresh-reset `outvers_e2e`, Postgres :5433 + Meilisearch :7700)

- `drizzle-kit push --force` (migration 0022 cols + `experience_itinerary_steps`) → applied.
- `pnpm db:seed` + `pnpm db:seed:demo` → **81 experiences** (51 existing + 30 demo pilot), **71 published**, **70 structured**, **148 itinerary steps**, **20 `u_cat_*` vendors**.
- Published per region (all ≥3, SEO rule satisfied): rishikesh 10, manali 8, bir-billing 8, goa 8, kasol 7, leh-ladakh 7, andaman 6, lonavala 6, spiti 6, auli 5.
- `db:seed:demo` re-run → idempotent (counts unchanged).
- Reindex → live Meili filterable attrs include `difficulty, durationBand, seasonMonths, maxGroupSize`; facet queries return results: `difficulty=challenging`→6, `seasonMonths=1`→31, `durationBand=multi_day`→23.

## E2E analysis — zero regressions from this milestone

Milestone's own specs (all PASS): structured PDP renders every ADR-0017 section + TouristTrip JSON-LD; bare Experience degrades cleanly; filter rail exposes structured facets; difficulty facet narrows; region facet narrows; bare filter rail.

Full-suite failure diff (`main` baseline vs `task/07`):

- **6 failures identical on both branches → PRE-EXISTING, unrelated** to this milestone: `graceful-degradation` footer stub (256) + rafting out-of-scope control (307); `sitemap` /sitemap-en.xml (15), index (26), robots.txt (38) — dev-server metadata-route artifacts; `wallet` ADR-0004 labels (28).
- **4 failures on `task/07` only → FLAKY, not regressions**: admin users list (1050), sub-admin gate (1080), region-closures heading (1149), trip-groups create (27). All **PASS in isolation** on `task/07` (re-run: 4/4 green, 9.3s) — timing flakiness under post-Workflow machine load in the full run.

Method: ran `pnpm e2e` on `main` (6 failed / 212 passed) and `task/07` (10 failed / 207 passed); the 4 extra all pass when re-run alone. CWV/a11y: the structured-PDP E2E passes the devtools-fixture axe check.

## Outcome

All milestone acceptance criteria met. Content shipped as a **bounded pilot (~30 new listings)** per owner decision (full-100 is a data-only follow-up). **Issue 05 (vendor form) awaits owner sign-off** on `listing-form-stepper.tsx` (additive-only, not merged). Fast-follows tracked in the plan doc. Nothing merged — human owns review/merge of the `task/*` stack.
