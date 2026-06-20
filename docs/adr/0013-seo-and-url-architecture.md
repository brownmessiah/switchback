# SEO architecture: URL hierarchy, slugs, structured data, editorial content

## Context

The plan calls out SEO weakness as one of the core rebuild drivers ("competitors own the queries with proper SSR + structured data + listicle pages") and commits to the URL pattern `/{lng}/adventure/{activity}-in-{city}` plus "JSON-LD Product/FAQ/Review/BreadcrumbList schema on every product/destination page." What it didn't specify: the full URL hierarchy, canonical handling for multiple inbound paths to the same Experience, slug rules and uniqueness, listicle data sourcing, the schema-per-page-type mapping, noindex policies, or the role of editorial content in the discovery funnel.

## Decision

### URL hierarchy

| Path | Page type |
|---|---|
| `/{lng?}` | Home |
| `/{lng?}/destinations/{city}` | City landing |
| `/{lng?}/adventure/{activity}-in-{city}` | Activity-city collection (listicle + product cards) |
| `/{lng?}/experience/{slug}` | Experience detail — **canonical** for the Experience regardless of inbound path |
| `/{lng?}/combo/{slug}` | Combo Experience detail |
| `/{lng?}/vendor/{slug}` | Vendor profile |
| `/{lng?}/blog/{slug}` | Editorial article |

Multiple inbound paths can point to the same Experience; all of them set `<link rel="canonical" href="/{lng}/experience/{slug}" />`. Only the canonical path appears in sitemaps.

### Slug rules

- City and activity slugs are controlled vocabulary in `lib/regions/registry.ts` and `lib/activities/registry.ts`. Not Vendor-chosen.
- Experience and Vendor slugs are Vendor-proposed with global uniqueness enforced. Auto-suffix `-2`, `-3` on collision. Forbidden-words list prevents impersonation of canonical activity-city patterns.
- Combo slugs are Experience slugs prefixed `combo-`; non-Combos cannot start with `combo-`.
- Slug changes preserve the old slug in `slug_redirects(old_slug, entity_type, entity_id, retired_at)` and emit a 301 from the old URL. Retired slugs cannot be reused for 365 days.

### JSON-LD per page type

| Page | Schemas |
|---|---|
| Experience detail | `Product` + `offers`, `AggregateRating`, `Review`, `FAQPage`, `BreadcrumbList` |
| Combo detail | `Product` + `offers` (referencing constituent Experiences), `AggregateRating`, `BreadcrumbList` |
| Activity-city collection | `ItemList` of Products, `BreadcrumbList`, `FAQPage` |
| City landing | `TouristDestination`, `ItemList`, `FAQPage` |
| Blog post | `Article`, `BreadcrumbList` |
| Vendor profile (Business-verified) | `LocalBusiness`, `BreadcrumbList` |
| Vendor profile (lower-tier) | `Organization`, `BreadcrumbList` |
| Home | `Organization`, `WebSite` (with SearchAction) |

Generation lives in `lib/seo/schemas/`, one function per schema, composed per page, validated against schema.org via build-time linter.

### Editorial listicles — hybrid model

MDX files in `content/listicles/{locale}/{activity}-in-{city}.mdx` provide editorial intro, "what to look for," safety guidance, FAQ. Product cards inside the page are server-component queries against Postgres + Meilisearch — top N Experiences in scope, refreshed on Vendor activity. Listicles stay fresh as inventory changes; intros stay editorial.

**v1 launch seeding:** 30 listicles in en + hi covering the highest-volume activity-city pairs (rafting in Rishikesh, paragliding in Bir-Billing, scuba in Goa, trekking in Manali, etc.). Content commitment for M5.

**AI-assisted authoring:** admin tool generates outline + first-draft intros via OpenAI (per ADR-0010, AI-assisted labelled, audit-logged); human reviews and edits before publish. Product card section is data, not generated.

### Server-rendering

- All public routes are Server Components.
- Above-the-fold streams immediately; product card lists stream via `<Suspense>` boundaries.
- No client-side data fetching on any indexed surface.
- ISR `revalidate = 60` on listicle and city pages; on-demand revalidation on Experience publish/unpublish via webhook.

### Indexing policies

- `noindex`: `/account/*`, `/(vendor)/*`, `/(admin)/*`, `/auth/*`, `/api/*`.
- `noindex, follow`: paginated collection pages beyond page 1; sort/filter URL variants.
- Sort/filter variants emit `<link rel="canonical">` pointing at the unfiltered URL.
- Sitemaps: per-locale `/sitemap-{lng}.xml`, indexed from `/sitemap.xml`.

## Why not the alternatives

- **Single canonical path that varies by inbound context** — search-engine signal scatters across paths; consolidation requires canonical tags pointing at one. Pick the Experience URL as the authority.
- **Vendor-chosen city/activity slugs** — fragments the canonical activity-city pages (`rafting-rishikesh` vs `river-rafting-rishikesh` vs `rafting-in-rishikesh`); destroys the SEO surface.
- **Pure-MDX listicles (no live data)** — content rots as inventory changes; product cards on a 6-month-old listicle become misleading.
- **Pure-data listicles (no editorial)** — competing on data alone with Thrillophilia's editorial moat is a losing position; the "20 things to do in X" intro is what ranks and converts.
- **Client-side data fetching for product cards on indexed pages** — crawlers see empty content; defeats the entire SEO thesis.

## Consequences

- Slug uniqueness check happens inside the Experience-publish transaction with `SELECT ... FOR UPDATE` on a slug-reservation table to prevent race conditions across two simultaneous publishes.
- Activity registry (`lib/activities/registry.ts`) is the canonical list of `(activity_slug, display_name_per_locale)` pairs. Adding an activity is a code change in v1.
- Listicle authoring requires both editorial discipline (hand-written intros) and product-data freshness — separate them in the file structure: `intro.mdx` + `cards-config.json` per listicle.
- JSON-LD validation in CI prevents schema regressions; broken schemas silently hurt rankings.
- `slug_redirects` lookups are on the hot path of every public URL; cache aggressively (Redis TTL 24h, invalidated on slug change).

## Amendments

### 2026-06-20 — Search backend: Meilisearch → Postgres-native (ADR-0019)

This ADR originally specified Meilisearch as the search/faceting backend for the activity-city collection and `/search` surfaces. As part of the GCP deployment (**ADR-0019**), Meilisearch is **removed**: the `q` text query is served by Postgres FTS (`tsvector` + GIN) + `pg_trgm` over `title` + `shortDescription`, and all facets/filters/sorts/facet-counts are plain SQL in the same Cloud SQL instance. The URL hierarchy, slug rules, canonical handling, JSON-LD, and indexing policies in this ADR are **unchanged** — only the engine producing the result/facet sets changes. Rationale: a small single-language catalog already on Postgres; removing Meili deletes the most ops-heavy component and the prior fragility where a Meili outage returned an empty `/search` with no Postgres fallback. Semantic search, if needed, is `pgvector` in the same Cloud SQL.
