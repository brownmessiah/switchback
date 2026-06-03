# Structured Experience attributes: quick-facts, itinerary, and search facets

## Context

The Experience model (ADR-0011) carries pricing, permits, taxonomy, and cancellation, but everything a Customer reads to *decide* — how long it takes, how hard it is, the minimum age, what's included, what to bring, the hour-by-hour flow — lives in two free-text blobs (`short_description`, `long_description`). That is invisible to search, impossible to render as a structured PDP (Product Detail Page), and useless as JSON-LD. Competitors own the queries precisely because they expose this structure (ADR-0013). The parity audit flagged "data + feature-breadth, not design" as the gap.

This ADR specifies the structured attributes the Experience needs. The constraint that shapes every choice: the addition must be **purely additive**. A live `experiences` table already exists, the E2E suite seeds it via `drizzle-kit push`, and the PDP / E2E selectors read it. A migration that makes any new column `NOT NULL` without a default, or that changes an existing column, breaks the seed and the selectors. So every new column is nullable or array-default-empty, and nothing existing is touched.

## Decision

A **hybrid** model: scalar quick-facts columns on `experiences` for the facts that are single-valued and filterable, a difficulty `pgEnum` for the one closed vocabulary, `text[]` content arrays for the unordered editorial lists, and **one normalized child table** for the itinerary because it is ordered and unbounded.

### Scalar quick-facts on `experiences`

`duration_minutes int`, `difficulty experience_difficulty`, `min_age int`, `max_group_size int`, `meeting_point text`, `season_months smallint[]`. These are the single-valued, filterable facts. `max_group_size` is the **operational per-departure cap** — distinct from the group-size pricing brackets of ADR-0011 (`price_per_person_1_2 / 3_5 / 6_plus`), which price participant count and do not bound it. `season_months` is the set of months (1–12) the Experience runs; it **complements** ADR-0011 `region_closures` rather than replacing it — closures are date-range blackouts tied to a region, `season_months` is the Experience's own operating window.

### Difficulty as an enum

`experience_difficulty = (easy | moderate | challenging | extreme)`. A closed, ordered four-value vocabulary — exactly the case `pgEnum` exists for. The column is **nullable** (legacy rows pre-date it). It is distinct from the ADR-0015 safety stack, which gates high-risk Experiences operationally; difficulty is a Customer-facing rating.

### Content arrays as `text[]`

`languages`, `highlights`, `inclusions`, `exclusions`, `what_to_bring` — all `text[] DEFAULT '{}'`. These are unordered, variable-length editorial lists with no per-item attributes, so a child table would be ceremony for nothing. The empty-array default means a minimal Experience reads back `[]`, never `NULL`, which keeps the PDP render and E2E selectors branch-free.

### Itinerary as a normalized child table

`experience_itinerary_steps(id, experience_id FK ON DELETE CASCADE, step_order int, title NOT NULL, description?, day_offset?, duration_minutes?, timestamps, UNIQUE(experience_id, step_order))`, indexed on `experience_id`. This **mirrors the ADR-0009 `trip_group_itinerary_slots` pattern** verbatim — an integer ordering column plus CASCADE delete on the parent. Itinerary steps are ordered and unbounded (a multi-day trek has dozens), which is exactly when a child table beats an array. This is a **Vendor-authored, per-Experience** itinerary and is deliberately a *different* entity from the Customer-led `trip_group_itinerary_slots` of ADR-0009 — same structural pattern, different owner and lifecycle. Do not conflate them.

### Nullability rationale (the load-bearing constraint)

Every new scalar column is nullable; every array column defaults to `'{}'`; the enum column is nullable. No existing column changes. Each new CHECK (`duration_minutes > 0`, `min_age >= 0`, `max_group_size > 0`, `season_months <@ ARRAY[1..12]`) passes trivially on `NULL`, so legacy rows and the seed are unaffected. The migration is therefore safe to replay against a populated table: `ADD COLUMN IF NOT EXISTS` plus `DO $$ ... duplicate_object` guards on every constraint. This is what lets the E2E `drizzle-kit push` seed and every PDP / E2E selector keep working through the migration.

### Search-facet intent

The scalar quick-facts (`difficulty`, `duration_minutes`, `min_age`, `max_group_size`, `season_months`) are intended to become **Meilisearch facets** in issue 04. Recording the intent here is deliberate: it is *why* these are first-class scalar columns rather than JSON — facetable fields must be indexable scalars, and the canonical Experience detail at `/{lng}/experience/{slug}` (ADR-0013) will render them as structured quick-facts and JSON-LD.

## Why not the alternatives

- **One big JSON blob (`attributes jsonb`)** — invisible to Meilisearch faceting, no CHECK enforcement, no type safety from Drizzle's `$inferSelect`. Defeats the entire reason for the change, which is to make these facts queryable and renderable.
- **Itinerary as a `jsonb[]` column on `experiences`** — loses the ordering integrity, the per-step FK lifecycle, and the ability to index/query individual steps. Ordered + unbounded is the textbook case for a child table; ADR-0009 already established the pattern, so reusing it costs nothing and keeps the codebase consistent.
- **A normalized child table per content list (highlights, inclusions, …)** — over-normalization. These lists have no per-item attributes, no ordering that matters, and no independent lifecycle. `text[]` is the right tool; five extra tables would be ceremony.
- **Making the columns `NOT NULL` with backfilled defaults** — would force a data backfill across the live table and risk breaking the seed/selectors mid-migration. Nullable-additive is the only safe shape for an additive migration against a populated table.
- **A separate `experience_difficulty` lookup table** — a four-value closed vocabulary is exactly what `pgEnum` is for; a lookup table adds a join for no benefit.

## Consequences

- The migration is `0022_structured_experience_attributes.sql`, hand-authored per repo policy (never `drizzle-kit generate`). The PGlite `setupTestDb` replay is the unit-test gate; real `drizzle-kit push` parity is validated in E2E global-setup downstream (issue 07). Schema TS and the `.sql` describe the same columns/constraints by construction.
- The `season_months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]` CHECK is verified under PGlite to reject `{0}` and `{13}` and accept `{6,7,8}` and `{}` (empty array is contained-by → passes).
- Issue 02 builds the Zod validation schema and the itinerary/detail loaders against these columns. Issue 03 renders the PDP + JSON-LD. Issue 04 wires the scalar facts as Meilisearch facets. Issue 05 adds the Vendor authoring form + admin moderation. Issue 06 backfills content. Everything compiles against this slice — hence its P0 / foundation priority.
- Because the columns are nullable, every consumer (PDP, search indexer, JSON-LD builder) must treat them as optional and degrade gracefully when a legacy Experience has not been enriched. This is a feature: enrichment can roll out per-Experience without a flag day.
- `max_group_size` and the ADR-0011 pricing brackets must not be conflated in application code — the bracket selects a price by participant count; `max_group_size` bounds the booking. Both can coexist on one Experience.

## Cross-references

- **ADR-0009** — the `trip_group_itinerary_slots` child-table pattern that `experience_itinerary_steps` mirrors (distinct entity, same shape).
- **ADR-0011** — pricing brackets, `required_permits`, and `region_closures` that `max_group_size` and `season_months` sit alongside without duplicating.
- **ADR-0013** — the SEO/facet architecture and canonical `/{lng}/experience/{slug}` detail page these scalar fields feed as Meilisearch facets and JSON-LD.
