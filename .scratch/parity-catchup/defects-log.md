# parity-catchup — defects discovered (pre-existing, NOT introduced by this backlog)

Logged while executing the parity-catchup backlog. All are pre-existing repo
issues exposed during verification, **not** caused by any catchup change.

**STATUS: D1, D2, D3 all RESOLVED 2026-06-01** (post-merge, on `main`):
- **D1** `fix(analytics): bucket monthly trends in UTC` (`959f0dd`) — UTC on both
  the DB `to_char(... AT TIME ZONE 'UTC')` and `fillMonths` (`Date.UTC`/`getUTC*`);
  deterministic boundary regression test added; green under TZ ∈ {UTC, IST, −8, +14}.
- **D3** `fix(dashboard): hoist request-time sort out of render` (`2150a7f`) —
  extracted `sortBookingsUpcomingFirst()` to module scope so `Date.now()` leaves
  the RSC render body (clears `react-hooks/purity`); sort + badge byte-identical.
- **D2** `fix(e2e): flush + reindex Meilisearch on global setup` (`567f807`) —
  `resetSearchIndex()` flushes the index + reindexes seeded published experiences;
  verified live (goa beacon present→gone, region=goa 9→5 hits, all goa-prefixed).
  Open product follow-up (NOT a bug): analytics months bucket in **UTC**; if the
  business wants **IST**-calendar months, switch the `AT TIME ZONE` to
  `'Asia/Kolkata'` + IST date math — an explicit owner decision, deferred.

Original reports retained below for the record.

---

## D1 — `app/admin/analytics/loaders.test.ts` month-boundary flake (timezone)

**Found during:** issue 02 verification (full `pnpm test`), 2026-06-01 00:2x IST.

**Symptom:** 2 tests fail —
`loadRevenueTrend > includes payment amounts in correct month` (expected 5000, got 0)
and `loadVendorGrowth > includes vendor created this month` (expected 1, got 0).

**Root cause:** the tests compute the expected bucket as
`` `${now.getFullYear()}-${now.getMonth()+1}` `` in **local time** (TZ=Asia/Kolkata),
but the loader buckets `captured_at` / `created_at` with Postgres `date_trunc('month', …)`
in **UTC**. In the window 00:00–05:30 IST on the 1st of a month, `now()` is the new
month locally but the **previous** month in UTC, so the seeded row lands in the
prior-month bucket and the asserted current-month bucket is 0.

**Proof it is pre-existing / time-only:** `TZ=UTC npx vitest run app/admin/analytics/loaders.test.ts` → 9/9 pass; `TZ=Asia/Kolkata` → 2 fail. The full suite passed at 23:59 IST on 2026-05-31 (issue 01 run). No catchup change touches analytics.

**Fix (suggested):** compute the expected month in UTC in the test (`now.getUTCFullYear()` / `now.getUTCMonth()`), matching the loader's UTC bucketing. (Or seed `capturedAt`/`createdAt` at a UTC-stable mid-month date.)

---

## D2 — E2E Meilisearch index persists across runs → stale cross-surface beacons pollute `region=goa`

**Found during:** issue 02 verification (`pnpm e2e --project=unauthenticated` in isolation).

**Symptom:** `public-pages.spec.ts › region facet … ?region=goa yields only Goa experiences` fails:
`region=goa returned a non-Goa result: /experience/outvers-xsurface-collection-beacon<ts>-goa-kayaking-<rnd>`.

**Root cause:** `tests/e2e/global-setup.ts` → `resetDatabase()` drops/recreates the Postgres DB and reseeds, but **does not flush the Meilisearch `experiences` index** (it only waits for Meili health). The index is populated incrementally by admin-approve / cross-surface flows and **persists across runs**. A cross-surface "beacon" experience (region=`goa`, slug `outvers-xsurface-collection-beacon…`, which is NOT `goa-`-prefixed) from a prior run remains indexed; `?region=goa` returns it and the "every result slug starts with `goa-`" assertion fails. Only manifests when the index carries a leftover goa-region non-`goa-`-slug doc (run-order / prior-run dependent — passed in the issue 01 full run).

**Proof it is not catchup code:** the offending doc is a timestamped beacon from a prior run; issue 02 only **reads** `media_assets` and never writes Meilisearch. 42/43 unauthenticated tests passed (all rendered surfaces fine).

**Fix (suggested):** flush/clear the `experiences` index in `global-setup.ts` after reseed (and optionally reindex the seeded published experiences), OR have the cross-surface beacon spec deindex its beacon in `afterAll`, OR scope the `region=goa` assertion to seed-catalog slugs.
