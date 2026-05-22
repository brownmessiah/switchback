# Outvers Modernization — Implementation Plan

> ## Handoff notes for the next Claude Code session
>
> **What this is:** A ground-up rebuild of the Outvers travel-app currently at `/Users/aishwaryechauhan/Personal/travel-app/` (built on Hercules + React 19 + Convex). This folder (`/Users/aishwaryechauhan/Personal/outvers-next/`) is where the new app lives. The old folder stays untouched as reference.
>
> **Where to start:** Read this file end-to-end, then `CONTEXT.md` for domain language, then `docs/adr/` (16 ADRs covering load-bearing decisions), then `RESEARCH.md` for competitive context. Begin with **M1 — Foundation** below.
>
> **TDD is mandatory:** At the start of every feature, bugfix, or refactor, invoke `superpowers:test-driven-development`. See the **Engineering workflow** section below for the full skill and agent map. The discipline is non-negotiable for the money path (ADRs 0001 / 0003 / 0004 / 0005 / 0008 / 0016), KYC (ADR-0007), and AI guardrails (ADR-0010) — these are the modules where a silent bug is either tax-authority audit risk or customer-trust-destroying.
>
> **Reference the legacy app for parity work:** When porting a module, read the matching file in `/Users/aishwaryechauhan/Personal/travel-app/convex/<module>.ts` for the existing logic and `/Users/aishwaryechauhan/Personal/travel-app/src/pages/<area>/` for UI patterns. The legacy app's Convex schema (`/Users/aishwaryechauhan/Personal/travel-app/convex/schema.ts`) is the authoritative source for domain shape — translate it to Drizzle, don't rewrite the domain.
>
> **Open items the user needs to confirm before serious implementation** (defaulted but flag if blocked):
> - Folder name: defaulted `outvers-next/` — confirm or rename
> - Domain: keep `outvers.onhercules.app` or move to custom domain at launch
> - Team size + start date (drives 6-month timeline realism)
> - Aadhaar API account: transfer from current app or fresh application
> - Bokun / FareHarbor: who initiates commercial conversations
>
> **Auto mode permission:** The user is comfortable with you making reasonable calls without asking. Surface decisions in your responses but don't block on them unless genuinely ambiguous.

---

## Context

The current app at `/Users/aishwaryechauhan/Personal/travel-app/` is **Outvers**, an Indian adventure-activity marketplace (rafting, paragliding, scuba, trekking, etc.) built on **Hercules** (a Vite plugin + auth SDK over React 19 + Convex). It runs at `outvers.onhercules.app`. The codebase is functional but has accumulated:

- **Vendor lock-in** on Hercules (auth + Vite plugin + AI gateway) AND on Convex (DB + functions, hosted-only)
- **Bloated modules** (`convex/admin.ts` is 38KB, `convex/seed.ts` is 29KB)
- **SEO weakness** for a marketplace whose discovery depends on Google ("river rafting Rishikesh") — current React SPA hydrates client-side; competitors (Thrillophilia) own these queries with proper SSR + structured data + listicle pages
- **No real transactional integrity** for the money path — bookings → payments → vendor payouts run on Convex's eventual-consistency model, which is a footgun for funds
- **Missing modern capabilities** that the category (Klook, GetYourGuide, Headout) now considers table stakes: AI review summaries, AI vendor listing generation, channel-manager ingestion (Bokun/FareHarbor), partial payments, WhatsApp transactional flow, SOS/safety stack

The goal: ground-up rebuild in a new folder, **full feature parity with current app PLUS all high-leverage new capabilities**, on an owned, portable stack. Old code stays in place as reference.

This plan was informed by parallel competitive research on (1) Indian incumbents (Thrillophilia, MakeMyTrip Activities, Indiahikes, Bikat), (2) global category leaders (Klook, GetYourGuide, Viator, Headout), and (3) community/content platforms (Airbnb Experiences relaunch, ToursByLocals, Wanderlog, Polarsteps). Full research findings are in `RESEARCH.md`.

---

## Decisions Locked

| Decision | Choice |
|---|---|
| Form factor | Responsive web only (no native) |
| Stack | Next.js 15 (App Router) + TypeScript + Tailwind v4 + shadcn/ui |
| DB / ORM | Postgres + Drizzle ORM |
| Folder | `/Users/aishwaryechauhan/Personal/outvers-next/` (this folder) |
| Scope | Full parity + Indian moat + Trust & safety + Content/community + Vendor channel ingestion + Full AI suite |
| Auth | `better-auth` + MSG91 (OTP/WhatsApp) + Google OAuth |
| Real-time | Pusher Channels |
| Hosting | Vercel (app) + Neon Postgres `ap-south-1` (Mumbai) + Cloudflare R2 + Upstash Redis + Resend |
| Migration | Greenfield — no data port from Convex |

### Operational defaults (overridable)

| Concern | Default |
|---|---|
| Payments | **Razorpay only** — Stripe dropped permanently. Razorpay handles UPI, cards (domestic + international), EMI, wallets, partial-pay via Smart Collect. Foreign-card customers (NRIs / inbound tourists) accept slight UX trade-off |
| SMS / WhatsApp | **MSG91** for both (OTP + WhatsApp Business API templates) |
| Search | **Meilisearch** (Meilisearch Cloud managed; falls back to self-host on Fly.io) |
| AI provider | **OpenAI** (already a dep in legacy) via Vercel AI SDK for streaming |
| Maps | **Mapbox** (cheaper at India scale than Google Maps) |
| Email | **Resend** (transactional + React Email templates) |
| Observability | **Sentry** (errors) + **PostHog** (product analytics + session replay) + Vercel Analytics |
| CMS | **In-house admin UI** over Drizzle (no Sanity/Payload) — current `siteContent` pattern works |
| Testing | **Vitest** (unit/integration) + **Playwright** (E2E) |
| CI/CD | GitHub Actions + Vercel preview deploys per PR |

---

## Architecture

### Folder layout

```
outvers-next/
├── app/                      # Next.js App Router
│   ├── (marketing)/          # Public SEO-heavy routes (RSC)
│   │   ├── page.tsx          # Home
│   │   ├── [lng]/
│   │   │   ├── adventure/[activity]-in-[city]/
│   │   │   ├── destinations/[slug]/
│   │   │   ├── experience/[slug]/
│   │   │   ├── blog/[slug]/
│   │   │   └── ...
│   ├── (app)/                # Authed customer app
│   │   ├── account/
│   │   ├── bookings/
│   │   ├── wishlist/
│   │   ├── groups/           # tripGroups
│   │   └── trip-planner/     # AI itinerary builder
│   ├── (vendor)/             # Vendor portal
│   │   ├── dashboard/
│   │   ├── listings/
│   │   ├── bookings/
│   │   ├── payouts/
│   │   ├── inbox/            # AI-assisted reply inbox
│   │   └── onboarding/
│   ├── (admin)/              # Admin + sub-admin
│   ├── api/
│   │   ├── webhooks/
│   │   │   ├── razorpay/
│   │   │   ├── msg91/
│   │   │   └── bokun/        # Channel manager
│   │   ├── partner/v1/       # Public Partner API (Viator-style)
│   │   └── sse/              # Server-Sent Events fallback
│   └── auth/                 # better-auth handlers
├── db/
│   ├── schema/               # Drizzle schema split by domain
│   │   ├── users.ts
│   │   ├── vendors.ts
│   │   ├── experiences.ts
│   │   ├── bookings.ts
│   │   ├── payments.ts
│   │   ├── reviews.ts
│   │   ├── loyalty.ts
│   │   ├── trip-groups.ts
│   │   ├── support.ts
│   │   ├── content.ts        # blog, siteContent, faqs
│   │   └── audit.ts
│   ├── queries/              # Reusable query builders
│   └── migrations/
├── lib/
│   ├── ai/                   # OpenAI helpers (review summary, listing gen, trip planner)
│   ├── payments/             # Razorpay client + partial-pay engine
│   ├── whatsapp/             # MSG91 templates (confirm, T-24h, T-2h, review)
│   ├── pusher/               # Pusher server + client wrappers
│   ├── search/               # Meilisearch indexer + query helpers
│   ├── storage/              # R2 upload helpers
│   ├── kyc/                  # Aadhaar + PAN + GSTIN + Udyam verifiers
│   ├── permits/              # State-permit logic (ILP, etc.)
│   ├── seasonality/          # Monsoon-aware availability
│   ├── channel-managers/     # Bokun + FareHarbor connectors
│   └── safety/               # SOS, trusted-contact ping
├── components/               # shadcn/ui + custom
├── content/                  # MDX for editorial listicles
├── emails/                   # React Email templates
├── i18n/                     # en, hi, ta, mr, bn
├── tests/
│   ├── e2e/                  # Playwright
│   └── unit/                 # Vitest
├── PLAN.md                   # this file
├── RESEARCH.md               # competitive research findings
└── package.json
```

### Domain modules (parity + new)

Each module is its own slice (schema + queries + Server Actions + UI). **Bold = new capability.** Reference the legacy Convex module in `/Users/aishwaryechauhan/Personal/travel-app/convex/<name>.ts` for parity logic.

| Module | Legacy file | Parity from current | New in v1 |
|---|---|---|---|
| **Users / Auth** | `users.ts`, `subAdmin.ts` | Multi-role (customer/vendor/admin/sub_admin), sub-admin invites, wishlist, phone | Phone-OTP via MSG91, Google OAuth, `better-auth` sessions |
| **Vendors** | `vendor.ts`, `aadhaarKyc.ts` | Profile, KYC docs, commission rate, payouts | **3-tier verification badge** (phone/Aadhaar/in-person), **PAN + GSTIN + Udyam** layered on Aadhaar, **response-time SLA**, **video intros** |
| **Experiences** | `experiences.ts`, `availability.ts` | Title, slug, pricing tiers, addons, images, search | **Monsoon-aware availability**, **state-permit gating** (ILP for Sikkim/Ladakh), **seasonal/dynamic pricing**, **AI-generated description draft** |
| **Bookings / Payments** | `bookings.ts`, `bookings/`, `stripe/`, `razorpay/` | Razorpay + Stripe, promo codes, group bookings | **Partial pay (25% advance / 75% on-arrival)**, **"Reserve now, pay later"** tile badge, **SLA-backed wallet refund (24–48h)** |
| **Refunds** | `refunds.ts` | Manual admin approval | **Auto-approve under SLA threshold**, **wallet credit option** (faster than gateway refund) |
| **Reviews** | `reviews.ts` | Text + rating + helpful count | **Delivery-confirmed only** (vendor must mark "completed"), **AI summary bullets** (safety/difficulty/guide quality), **photo + video upload**, **WhatsApp post-trip prompt** |
| **Loyalty** | `loyalty.ts` | 4-tier points | Keep parity. Plus **wallet** + **flat-Rs referral both-sided** |
| **Promo codes** | `promoCodes.ts` | Percent / flat | Plus **festive banner CMS** (Diwali, Holi, monsoon-special) |
| **Trip Groups** | `tripGroups.ts` | Stranger-matching, chat | **Women-verified filter**, **collaborative day-by-day itinerary**, **export to Maps/Calendar**, **trusted-contact ping** |
| **Support tickets** | `support.ts` | Multi-message thread | **AI-suggested replies** for admins, **WhatsApp channel** |
| **Blog / CMS** | `blog.ts`, `siteContent.ts` | Markdown posts | **MDX with React components**, **editorial listicle templates** (`/adventure/{activity}-in-{city}`), **UGC trip diaries (Polarsteps-style auto-tracked)** |
| **Push / WhatsApp** | `pushNotifications.ts`, `whatsapp.ts` | Web push, basic WhatsApp | **Full transactional flow**: confirm + T-24h + T-2h + post-trip review prompt; **AI-drafted replies** |
| **API Keys / Partner API** | `apiKeys.ts` | Internal API keys | **Public Partner API v1** (Viator-style: separate endpoints for media, availability, reviews, bookings) |
| **Channel Managers** | — | — | **Bokun + FareHarbor inbound connectors** (poll + webhook) |
| **Trip Planner** | `tripPlanner.ts` | Basic AI placeholder | **Inventory-constrained AI planner** — chat → day-by-day itinerary built only from bookable Outvers experiences |
| **Safety** | — | — | **SOS button** (one-tap shares live location with platform + designated contact), **check-in pings** at trip start/end |
| **Gift Experiences** | — | — | **Tinggly-style open-box gift cards** (recipient chooses experience within validity window) |
| **Site Content / FAQs** | `siteContent.ts` | CMS via siteContent | Keep parity; multi-locale (en, hi, ta, mr, bn) |
| **Audit Logs** | `auditLogs.ts` | Action stream | Keep parity (Postgres `audit_logs` table with same shape) |
| **Vendor Payouts** | `payouts.ts` | Bank transfer + UPI | Keep parity, add response-time SLA dashboard |
| **Emails** | `emails.ts` | Transactional templates | Port to React Email + Resend |

### Critical patterns

- **Server Components by default** for all marketing/SEO routes — destinations, experiences, blog, listicles — render fully on server, stream UI for above-the-fold.
- **Server Actions** for all mutations — checkout, KYC submit, vendor onboarding, review create.
- **Drizzle relations + transactions** for the money path. Booking creation, payment confirmation, vendor commission write, audit log entry all in one `db.transaction(async tx => ...)`.
- **Meilisearch** sync via `after()` hook in Server Actions — write to PG, queue async index update.
- **Pusher** for chat (trip groups, support, vendor inbox) + vendor booking pings. Channel naming: `private-vendor-{vendorId}`, `presence-group-{groupId}`.
- **Type-safe URL params + Zod input schemas** on every Server Action.
- **Razorpay webhooks** terminate in `app/api/webhooks/razorpay/route.ts` with idempotency key dedup in Upstash Redis.
- **MSG91 templates** pre-registered + versioned in `lib/whatsapp/templates.ts`.
- **`auditLogs`** write helper called from every privileged action (vendor approval, refund, payout, sub-admin permission change).
- **SEO URL shape**: `/{lng}/adventure/{activity-slug}-in-{city-slug}` + JSON-LD Product/FAQ/Review/BreadcrumbList schema on every product/destination page.

### What is explicitly **not** ported

- Hercules SDK / auth / Vite plugin (the whole point)
- Convex (replaced wholesale)
- Stripe (dropped permanently — Razorpay covers all rails)
- Twilio (replaced by MSG91)
- React Router 7 (replaced by Next App Router)
- The current 38KB `convex/admin.ts` monolith — split into per-domain Server Actions

---

## Engineering workflow

Solo + AI-implemented at scale means quality discipline replaces peer-review-as-a-default. Every iteration on this codebase MUST run through the right skill or agent for the task. Architectural decisions live in `docs/adr/`; *process* discipline lives here.

### TDD is mandatory

Invoke `superpowers:test-driven-development` at the start of every feature, bugfix, or refactor. Write the failing test first, watch it fail, write the minimal implementation, watch it pass, refactor. Verify ≥80% coverage on every module that lands.

No exceptions for:

- **Money path** (ADRs 0001, 0003, 0004, 0005, 0008, 0016) — `db.transaction` boundaries, snapshot rules, commission / GST / TDS math, refund auto-approval, payout batching, dispute-window pause semantics
- **KYC** (ADR-0007) — tier transitions and per-tier cap enforcement at both publish-time and Booking-create-time
- **AI guardrails** (ADR-0010) — citation validation, retrieval grounding, structured-output schema enforcement, dropped-bullet behaviour
- **Booking-create transaction** — capacity decrement, commission resolution, slot reservation, channel-manager seat-block (where applicable), and audit-log writes must all run atomically and be tested as a single unit

### Always-on skills

| Skill | When to invoke |
|---|---|
| `superpowers:test-driven-development` | Start of every feature or bugfix |
| `superpowers:writing-plans` | Before any multi-file or multi-hour change |
| `superpowers:verification-before-completion` | Before claiming a task complete or before commit |

### Situation-triggered skills

| Skill | Trigger |
|---|---|
| `superpowers:systematic-debugging` | First response to any bug, test failure, or unexpected behaviour |
| `superpowers:using-git-worktrees` | Starting feature work that needs isolation from the current workspace |
| `superpowers:dispatching-parallel-agents` | 2+ independent tasks with no shared state |
| `superpowers:requesting-code-review` | Before merge of major features (mandatory for money path) |
| `superpowers:receiving-code-review` | When responding to review feedback |
| `superpowers:finishing-a-development-branch` | When implementation is complete and you need to decide on integration |
| `everything-claude-code:security-review` | After writing auth, payment, KYC, file upload, or user-input handling |
| `diagnose` | Hard bugs and performance regressions — disciplined reproduce-minimise-hypothesise-instrument loop |

### Domain skills (pair with implementation)

| Skill | Use during |
|---|---|
| `everything-claude-code:postgres-patterns` | All Drizzle schema, query, indexing, transaction work |
| `everything-claude-code:database-migrations` | Any migration that changes existing tables |
| `everything-claude-code:frontend-patterns` | React Server Component / Next.js client component work |
| `everything-claude-code:backend-patterns` | Server Actions, API routes, webhook handlers |
| `everything-claude-code:e2e-testing` | Playwright suite expansion and flake debugging |
| `everything-claude-code:api-design` | Public Partner API v1 endpoints (M5) |
| `everything-claude-code:coding-standards` | Universal TS/JS/React standards |
| `everything-claude-code:deployment-patterns` | Vercel deploy config, CI/CD pipelines |
| `frontend-design:frontend-design` | Marketing/listing UI where visual quality matters (Experience pages, listicles, Vendor profiles) |

### Agents to delegate to

| Agent | Invoke when |
|---|---|
| `nextjs-developer` | Next.js 15 implementation: App Router, RSC, Server Actions, streaming, hydration issues |
| `postgres-pro` | Schema design, indexing, transactions, query tuning |
| `playwright-expert` | E2E test design, Page Object Model, trace analysis, flaky-test diagnosis |
| `Backend Architect` | System-design decisions not already covered by an ADR |
| `Security Engineer` | Threat modeling, secure code review on payment / auth / KYC modules |
| `Database Optimizer` | Slow-query investigation, index tuning |
| `Frontend Developer` | Generic React/Next.js UI implementation |
| `UI Designer` | Visual design systems, component composition |
| `everything-claude-code:code-reviewer` | After writing code, before commit |
| `everything-claude-code:security-reviewer` | Vulnerability detection on auth / payment / KYC / AI-input paths |
| `everything-claude-code:database-reviewer` | PostgreSQL-specific schema and query review |
| `everything-claude-code:e2e-runner` | Generate and run E2E tests with artifact capture |
| `everything-claude-code:tdd-guide` | TDD enforcement alternative when the superpowers skill doesn't fit the case |
| `everything-claude-code:doc-updater` | Codemap and documentation refresh after each milestone |
| `everything-claude-code:build-error-resolver` | TypeScript / build error resolution |
| `everything-claude-code:refactor-cleaner` | Dead-code cleanup after a milestone |
| `test-writer-fixer` | Post-implementation coverage gaps and broken-test recovery |
| `Performance Benchmarker` | M6 pre-cutover Lighthouse + load-testing pass |
| `Accessibility Auditor` | Pre-launch WCAG audit on marketing routes |

### Parallel execution default

Any turn with 2+ independent tool calls (multiple reads, multiple agent dispatches, `git status` + `git diff`) batches them in one assistant message. The TDD loop itself is sequential (red → green → refactor); the work *around* it parallelises liberally.

### Why the discipline matters more here than usual

- **Solo build** — no peer review by default; the skill and agent flows above are the entire review mechanism.
- **Money path is tax-authority risk** — ADR-0016 TDS errors and ADR-0008 commission-snapshot errors are not "fix in next sprint" bugs; they are filings the Income Tax Department audits.
- **AI implements at scale** — the bug surface is the whole codebase, not just one engineer's modules. Defensive testing is load-bearing, not optional.

---

## Phasing (within v1)

Given the scope (full parity + 4 new-capability buckets), this is realistically a **6-month, 4–6 engineer** build to v1 launch. Within v1, an internal sequencing to de-risk:

### M1 — Foundation (4 weeks)
- Next.js 15 + TypeScript + Tailwind v4 + shadcn/ui scaffolded
- Drizzle + Postgres schema for users, vendors, experiences, bookings, payments, reviews (port from legacy `convex/schema.ts`)
- `better-auth` + MSG91 OTP + Google OAuth wired
- Mapbox set up
- Vercel + Neon Mumbai + R2 + Upstash + Sentry connected; env vars documented in `.env.example`
- CI/CD with one Playwright smoke test (home page loads)
- **Operational kickoff in parallel:** Aadhaar API re-application, MSG91 WhatsApp template submissions, Bokun/FareHarbor partner outreach

### M2 — Money path (6 weeks)
- Browse → experience detail → book → Razorpay → confirm → vendor payout
- Partial payment engine (25% advance / 75% on-arrival)
- Refund flow with SLA-backed wallet auto-refund
- Meilisearch indexer + facets (port search behavior from legacy `experiences.ts` searchIndex)
- SEO URL shape (`/{lng}/adventure/{activity}-in-{city}`) + JSON-LD on product/destination pages
- Razorpay webhook + idempotency via Upstash Redis dedup keys

### M3 — Trust & safety + WhatsApp (4 weeks)
- 3-tier vendor verification (phone/Aadhaar/in-person)
- PAN + GSTIN + Udyam KYC layer (extends legacy Aadhaar-only flow)
- MSG91 WhatsApp transactional flow (confirm/T-24h/T-2h/review)
- Delivery-confirmed reviews + photo/video upload to R2
- SOS button + trusted-contact ping
- Women-verified tripGroups filter

### M4 — AI suite (4 weeks)
- Review summarization (OpenAI batch job + cached in PG; computed nightly + on review-create)
- AI vendor listing draft generation (in vendor onboarding flow)
- AI-suggested vendor inbox replies (Pusher-pushed drafts)
- Inventory-constrained trip planner (RAG over experiences table via PG + `pgvector` extension)

### M5 — Content / community / channel ingestion (6 weeks)
- MDX editorial listicles + Polarsteps-style auto-tracked trip diaries
- Collab itinerary builder in tripGroups
- Gift experiences (Tinggly model)
- Host video intros
- Bokun + FareHarbor connectors (poll + webhook)
- Public Partner API v1 + docs site

### M6 — Hardening, soft-launch, public launch (2 weeks)
- Warm-introduce active vendors from legacy app to new app (greenfield re-onboarding)
- Run legacy app + new app side-by-side; legacy read-only for existing bookings/history
- DNS flip to new app
- Legacy stays deployed 90 days as audit/historical reference

---

## Verification

### Per-module
- Vitest coverage ≥ 80% on `db/queries/*` and `lib/*`
- Drizzle schema migrations run cleanly on a fresh Neon branch
- Playwright E2E for: register-phone-OTP, browse-book-pay, vendor-onboard, refund-request, AI-summary-display

### End-to-end smoke (each milestone)
- `pnpm dev` boots Next.js + connects to Neon dev branch
- Seed script creates: 1 admin, 3 vendors (one per KYC tier), 10 experiences across 5 destinations, 5 sample bookings
- Razorpay test-mode end-to-end: customer pays → webhook → booking confirmed → vendor commission row written → audit log entry
- MSG91 sandbox: OTP login + WhatsApp template delivery
- Pusher: open vendor dashboard in browser, place test booking, see real-time ping
- Meilisearch: "rishikesh rafting" returns relevant experiences with destination/category facets
- SEO: `curl` a destination page, confirm full HTML + JSON-LD schema present (no client hydration required for crawlable content)

### Pre-cutover gates
- Sentry has < 5 errors/hour in staging under synthetic load
- Lighthouse: ≥ 90 mobile performance on top 20 destination pages
- Razorpay webhook idempotency proven (replay 1000x, single booking)
- AI safety review: every AI-generated review summary fact-checked against source reviews on a 200-review sample
- Vendor onboarding completable end-to-end in ≤ 15min (timed with 3 real Indian operators)
- Refund SLA proven: 100 synthetic refunds processed, p95 ≤ 24h

---

## Known risks & honest flags

1. **Timeline**: "Full parity + all 4 new buckets at launch" is genuinely 6 months for 4–6 engineers. Solo or 1–2 engineers, it's 12–18 months. Recommend re-evaluating at end of M2 whether to defer Content/community or Vendor channel ingestion to a post-launch phase.
2. **Greenfield migration risk**: Existing users + vendors + all reviews reset to zero. Review density is a huge SEO/trust signal; competitors with 5+ years of reviews will out-rank a fresh site for 6–12 months. Mitigations: warm-introduce existing vendors via WhatsApp before launch, seed editorial content heavily, run paid Google search during launch ramp.
3. **Aadhaar / KYC vendor lock-in**: The Aadhaar OTP API is gated; the current app uses a wrapper. Re-applying for API access takes 2–4 weeks — start during M1.
4. **MSG91 WhatsApp template approval**: Each template needs Meta approval (typically 24–72hr per template). Submit all transactional templates in week 1.
5. **Bokun / FareHarbor partnerships**: Channel-manager connectors usually require a commercial agreement, not just public API. Begin partner conversations in M1 if Vendor channel ingestion stays in v1.
6. **Old app stays alive**: Convex hosting costs continue during the 90-day audit window. Budget for it.

---

## First concrete steps for the next session

1. **Confirm the open items with the user** (folder name, domain, team size, Aadhaar account, Bokun outreach owner). Default and proceed if they say "use your defaults."
2. **Initialize Next.js 15 in this folder:**
   ```bash
   cd /Users/aishwaryechauhan/Personal/outvers-next
   pnpm create next-app@latest . --typescript --app --tailwind --eslint --src-dir=false --import-alias="@/*" --turbopack
   ```
3. **Add core deps:** `pnpm add drizzle-orm postgres better-auth @upstash/redis pusher pusher-js meilisearch razorpay openai ai @ai-sdk/openai resend react-email zod`. Dev: `pnpm add -D drizzle-kit vitest @playwright/test @types/node tsx`
4. **Set up Drizzle + Postgres:** create `db/schema/users.ts` first, translated from `/Users/aishwaryechauhan/Personal/travel-app/convex/schema.ts` (the `users` table). Add Neon connection via `DATABASE_URL` env var. Generate first migration with `pnpm drizzle-kit generate`.
5. **Wire better-auth:** install `better-auth` adapter for Drizzle, configure phone provider (custom for MSG91), add `auth.config.ts` + `app/auth/[...all]/route.ts` handler.
6. **Vercel project:** create Vercel project linked to this repo, set Neon `DATABASE_URL`, `MSG91_AUTH_KEY`, `GOOGLE_CLIENT_ID`/`SECRET`, `BETTER_AUTH_SECRET`, `PUSHER_*`, `RAZORPAY_*`, `OPENAI_API_KEY`, `RESEND_API_KEY` in project env vars. Document in `.env.example`.
7. **Smoke test:** Playwright test that loads `/` and asserts 200 + page title. CI green = M1 milestone 1 done.
