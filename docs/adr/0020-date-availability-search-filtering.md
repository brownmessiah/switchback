# Date-availability search filtering

Amends the search half of ADR-0013 (SEO/URL) and builds on ADR-0019 (which retired Meilisearch). Sibling of ADR-0011 (availability/pricing/permits).

## Context

The homepage search bar is gaining a date selector (Today / Tomorrow / Next weekend + a 2-month grid). Selecting a date must narrow `/search` results to Experiences that are bookable **on that date**. Today `searchExperiences` (`lib/search/search-experiences.ts`) has no date filter — only `seasonMonth` (1–12) and `maxGroupSize`.

Two structural questions: **where** does date filtering execute, and **how** do we keep pagination and SEO robots rules correct.

The "where" is already settled by reality: **Meilisearch is retired (ADR-0019).** `searchExperiences` is a single Postgres `SELECT` over `experiences ⋈ vendor_profiles`, `LIMIT 20`, with full-text via a GIN `tsvector` + `pg_trgm` typo tolerance. There is no search index to hold availability, and availability already lives in live Postgres (`availability_slots`). A Postgres filter is therefore the only mechanism — and it is always current, with no sync path to maintain.

## Decision

### Filter in Postgres as an inline `EXISTS` correlated subquery, evaluated before `LIMIT`

Add a `date` param. When present, append to the existing `conditions[]` array a correlated `EXISTS` against `availability_slots`:

```sql
EXISTS (
  SELECT 1 FROM availability_slots s
  WHERE s.experience_id = experiences.id
    AND s.status = 'open'
    AND s.start_at >= :dayStart
    AND s.start_at <  :dayEnd
    AND s.capacity_taken < s.capacity
)
```

`[:dayStart, :dayEnd)` is the chosen **UTC calendar day** (`YYYY-MM-00:00:00.000Z` … next-day 00:00). This reuses the codebase's canonical "bookable" predicate — `status = 'open' AND start_at >= now AND capacity_taken < capacity` (from `lib/experiences/detail-loader.ts`) — ranged to the selected day (a today/future day is always `>= now`; the UI rejects past dates).

This is an **inline filter evaluated before `LIMIT 20`**, deliberately *not* a post-hoc filter of the 20 returned hits. Naive post-filtering (fetch 20 rows, then drop the ones lacking a slot) under-fills the page — it would show fewer than 20 results even when more matches exist, and would corrupt counts/pagination. `EXISTS`-before-`LIMIT` keeps `LIMIT 20` semantics correct. ("Post-filter" here means *filter in Postgres against availability*, contrasted with a search-index filter — not filtering in application code after the query.)

### Param + robots contract

- `date` added to `SearchExperiencesParams` (UTC `YYYY-MM-DD` string).
- `parseSearchParams` reads URL key `date` via the existing `first()` helper, validates `YYYY-MM-DD`, and rejects past dates (collapse to `undefined`).
- `date` is added to `isFilteredSearch()` — **mandatory**. A date-filtered URL is a filtered view and must inherit ADR-0013's `noindex, follow` + canonical-to-bare-`/search` treatment. Omitting this would leak infinite date permutations into the index. Because `generateMetadata` also calls `parseSearchParams`, the noindex treatment is inherited automatically once `date` is in `isFilteredSearch`.

### Index

The existing unique index `(experience_id, start_at)` on `availability_slots` (from `0000_big_fenris.sql`) serves the correlated `EXISTS`: it leads on `experience_id` (the correlation key) with a range on `start_at`; `status` and `capacity_taken` are cheap heap rechecks on the few candidate rows. **No new index is required for v1.** If `EXPLAIN` later shows the heap recheck is hot, add a partial index `(experience_id, start_at) WHERE status = 'open'` — deferred until measured.

## Why not the alternatives

- **Put availability into a search index (Meili/Typesense/etc.)** — there is no search index (Meili retired, ADR-0019). Reintroducing one to hold *dynamic per-slot* availability means reindexing on every booking and capacity change — pure churn when Postgres already holds live truth.
- **Post-filter the 20 returned hits in application code** — under-fills the results page and corrupts pagination/counts. Rejected.
- **Reuse `seasonMonth` (month) as a proxy** — already exists and is too coarse; the brief asks for a specific bookable date.
- **Match `start_at = 'YYYY-MM-DD'`** — `start_at` is `timestamptz` (a moment, e.g. 06:00), not a `date`; equality never matches. The day must be ranged.

## Consequences

- **Materialization dependency.** Date filtering only surfaces Experiences whose slots are **materialized**. `materializeSlots` (`lib/availability/slot-materializer.ts`) fills a rolling ~90-day window, but it is currently triggered by vendor actions/seeds, **not** a live cron (no entry in `vercel.json`). A date beyond the materialized horizon returns empty even when a recurring pattern implies availability. A reliable materialization cron should back date search before launch; tracked as a follow-up.
- `searchExperiences` stays a single query; the `EXISTS` adds one correlated, indexed lookup per candidate row.
- Filter tests must cover: date with an open slot (included); date fully `sold_out`/`closed` (excluded); date where `capacity_taken = capacity` (excluded); past date (rejected in parse); date beyond the materialization horizon (empty); and pagination correctness (≥20 matches still fill the page — i.e. the `EXISTS` is inside the query, not applied after `LIMIT`).
- The date variant of a `/search` URL is `noindex, follow` and canonicalizes to bare `/search` (via `isFilteredSearch`), consistent with every other facet.

## Amendment — lower bound clamps to `now()` (issue-10 review, 2026-07-14)

The original SQL ranged `[:dayStart, :dayEnd)` and asserted "a today/future
day is always `>= now`" — true only at midnight. For the flagship **Today**
selection, slots earlier in the UTC day would still match, surfacing
Experiences whose only same-day slot has already departed (India inventory
is morning-heavy). The implemented predicate therefore clamps the lower
bound: `start_at >= GREATEST(:dayStart, now-as-bound)` (computed as the max
of the day-start and the current instant, passed as an ISO string). This
restores parity with the canonical bookable predicate
(`lib/experiences/detail-loader.ts`: `startAt >= now`). Additionally,
`parseDateParam` clamps the far horizon to ~366 days: the UI offers two
months, materialization covers ~90 days, and extreme years ('9999-12-31')
serialize to expanded-year ISO strings Postgres rejects.
