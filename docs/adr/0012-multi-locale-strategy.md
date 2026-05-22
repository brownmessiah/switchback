# Multi-locale strategy

## Context

The plan declared support for five locales — `en, hi, ta, mr, bn` — without specifying storage shape, translation process, URL strategy, or launch sequencing. Multi-locale touches every public route, every Experience, every WhatsApp template, every SEO surface; getting the foundation wrong now is expensive to undo later. The plan also doesn't acknowledge that translation operations have ongoing curation cost — launching five locales with machine-translated unreviewed content would destroy trust in exactly the tier-2/3 markets the rebuild is trying to reach.

## Decision

### Storage — sparse translation table

```
translations(entity_type, entity_id, field_name, locale, value, updated_at, updated_by_user_id)
```

Index on `(entity_type, entity_id, locale)`. Sparse — only filled translations are stored; missing rows fall back to the canonical locale (en). No schema migrations needed to add new locales.

### Translatable surfaces

- UI strings (next-intl in source control)
- CMS — site copy, FAQs, blog, editorial listicles
- Experience fields — title, short description, long description, addons, slug
- Region names, permit names, cancellation policy text
- WhatsApp template bodies (registered separately per locale at MSG91)

Customer reviews are **not** translated at v1 — kept in source language; AI review summaries optionally translatable in v1.x (modelled as locale-keyed from day one).

### URL strategy — path-prefix, en is un-prefixed canonical

`/adventure/rafting-in-rishikesh` = en; `/hi/adventure/rafting-in-rishikesh` = hi. Per-locale slugs allowed via the translation table. en is the default — no detection-based redirect.

### SEO

- `<link rel="alternate" hreflang="..."` on every translated page for every published locale, plus `x-default` pointing at en.
- Per-locale sitemap files under `/sitemap-{lng}.xml`, indexed from `/sitemap.xml`.
- Canonical URL is the localised URL (each locale ranks independently).

### Translation process per content type

- UI strings: hand-translated in source; en-only PRs ship behind feature flags or fallback until non-en is filled.
- CMS content: hand-translated in admin UI; en + launch-locale required before publish.
- Experience content: Vendor enters en; admin tool offers OpenAI machine-translation drafts (AI-assisted per ADR-0010); Vendor reviews and edits before publish.
- Reviews: not translated at v1.

### v1 launch posture

Infrastructure supports five locales from day one. Content launches in `en + hi`. `ta, mr, bn` populate across v1.x as curation bandwidth allows. Communicated externally as a rollout, not a roadmap commitment to a specific date.

## Why not the alternatives

- **Per-locale columns (`title_en`, `title_hi`, …)** — schema migration on every new locale; rotten ergonomics.
- **JSONB blob columns** — harder to query, harder to index, harder to audit.
- **One table per locale** — combinatorial schema; foreign keys and joins become a maze.
- **Subdomain per locale** — multiple auth domains, more cert/DNS infra, no SEO advantage over path-prefix at this scale.
- **Country-detection redirect** — kills shareable links; users land somewhere unexpected.
- **Ship all five locales at launch** — solo curation can't sustain five launch-quality content sets simultaneously without machine-translating without review, which is the failure mode this ADR exists to prevent. Better to ship two solidly than five badly.

## Consequences

- next-intl middleware handles locale detection and prefix routing; configured in M1.
- Every public-route component reads translatable fields via a `tx(entityType, id, fieldName, locale)` helper that returns the locale value or falls back to en, recording the fallback in a debug log for translation-coverage reporting.
- Vendor onboarding UI initially accepts en-only Experience content. A "translate for [locale]" CTA appears on the Experience after publish, surfacing the AI-draft flow per ADR-0010.
- MSG91 WhatsApp template approval is a per-language, per-template process (24–72hr each per Meta). Submit en + hi versions for all transactional templates in week 1 of M1, per the plan's "operational kickoff in parallel" guidance.
- Sitemap generation is a build-step output (Vercel ISR + on-demand revalidation); per-locale files emit from a single source-of-truth route enumeration.
