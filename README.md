# Outvers

Indian adventure-activity marketplace — rafting, paragliding, scuba, trekking, multi-day expeditions. Ground-up rebuild of the legacy app at `/Users/aishwaryechauhan/Personal/travel-app/` on a portable, owned stack.

Status: **M1 Foundation complete**. See `PLAN.md` for milestone schedule.

---

## Quick start

```bash
# 1. Install deps
pnpm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local — at minimum, DATABASE_URL + BETTER_AUTH_SECRET + NEXT_PUBLIC_APP_URL

# 3. Apply migrations to your Neon dev branch
pnpm db:migrate

# 4. Boot dev server
pnpm dev
# → http://localhost:3000
```

The dev server boots with Turbopack in ~300ms. Without a populated database, you'll see the default Next.js landing page; auth routes at `/api/auth/*` are operational.

---

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Next.js dev server with Turbopack |
| `pnpm build` | Production build |
| `pnpm start` | Production server (use after `build`) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript `tsc --noEmit` |
| `pnpm test` | Vitest unit + integration |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:coverage` | Vitest with v8 coverage report + threshold gate |
| `pnpm e2e` | Playwright E2E |
| `pnpm e2e:ui` | Playwright UI mode (interactive) |
| `pnpm db:generate` | Generate Drizzle migration from schema diff |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:push` | Push schema directly (dev only — bypasses migrations) |
| `pnpm db:studio` | Open Drizzle Studio (web UI) |

---

## Project structure

```
app/                  Next.js App Router routes
  api/auth/[...all]/  better-auth route handler
db/
  schema/             Drizzle schema (16 tables — users, profiles, experiences,
                      availability, money path, wallet, audit, AI, slug redirects)
  migrations/         drizzle-kit generated .sql files
  client.ts           postgres-js + Drizzle handle
docs/
  adr/                16 ADRs covering every load-bearing decision (payments,
                      KYC, commission, TripGroups, AI, SEO, channel managers,
                      safety, payouts/GST/TDS)
  plans/              Per-milestone implementation plans
  agents/             Agent skill docs
lib/
  auth/               better-auth wiring + MSG91 provider
  email/resend.ts     Resend transactional email
  pusher/             Pusher real-time (server + client)
  redis.ts            Upstash Redis (idempotency, rate limit, hot cache)
  sentry/init.ts      Sentry error tracking
  storage/r2.ts       Cloudflare R2 (S3-compatible) object storage
  env.ts              Typed env validation with Zod
tests/
  e2e/                Playwright E2E specs
  unit/               Sanity tests
  helpers/db.ts       pglite-backed Drizzle harness for schema tests
.github/workflows/    CI (lint, typecheck, unit, e2e)
PLAN.md               Master plan (M1–M6 phasing)
CONTEXT.md            Domain vocabulary (~50 canonical terms)
RESEARCH.md           Competitive research backing the plan
TODO_FOR_SHIVAM.md    Operational items (Aadhaar API, MSG91 templates, etc.)
```

---

## Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16.2 (App Router, Turbopack) |
| Language | TypeScript 5.9, strict mode |
| Styling | Tailwind v4 + shadcn/ui |
| DB | Postgres (Neon, ap-south-1 Mumbai) |
| ORM | Drizzle ORM 0.45 + drizzle-kit |
| Auth | better-auth 1.6 (Drizzle adapter) + Google OAuth + MSG91 phone OTP |
| Payments | Razorpay (UPI, cards, EMI) — wired in M2 |
| Real-time | Pusher Channels |
| Search | Meilisearch (managed) |
| AI | OpenAI via Vercel AI SDK |
| Maps | Mapbox |
| Email | Resend + React Email |
| Object storage | Cloudflare R2 (S3-compatible) |
| Observability | Sentry + PostHog + Vercel Analytics |
| Testing | Vitest + @electric-sql/pglite + Playwright |
| CI | GitHub Actions |
| Deploy | Vercel |

---

## Engineering workflow

See `PLAN.md` "Engineering workflow" for the full skill + agent map. The non-negotiables:

1. **TDD is mandatory.** Invoke `superpowers:test-driven-development` at the start of every feature, bugfix, or refactor.
2. **Verify before commit.** Invoke `superpowers:verification-before-completion` to run lint + typecheck + tests one final time.
3. **Snapshot rule for money path.** Every commission rate, basis, price-per-person, cancellation preset, TDS amount, and GST rate is snapshotted onto the Booking row at create time and never recomputed (ADRs 0001 / 0008 / 0011 / 0016).
4. **AI safety.** Every AI generation writes an `ai_generations` row with provenance (`model`, `prompt_template_hash`, `citation_traces`) per ADR-0010.
5. **Domain vocabulary.** Use the terms in `CONTEXT.md` verbatim — don't drift to synonyms listed under `_Avoid_`.

---

## What's done (M1)

- Next.js 16 scaffold + Tailwind v4 + Turbopack
- Drizzle schema for 16 tables covering users, profiles, experiences, availability, money path, wallet, audit, AI generations, slug redirects
- 109 unit + integration tests, all green (95% statement coverage)
- Playwright smoke test
- better-auth with Drizzle adapter, Google OAuth, MSG91 phone OTP
- Service wirings: Redis (Upstash), R2 (Cloudflare), Resend, Pusher, Sentry
- Typed env validation with Zod 4
- GitHub Actions CI: lint + typecheck + unit (coverage) + e2e
- `TODO_FOR_SHIVAM.md` operational items list

## What's next (M2 — Money path, 6 weeks)

The headline M2 deliverables: browse → experience detail → book → Razorpay → confirm → vendor payout, with partial payment (25% advance / 75% T-24h), refund flow with SLA-backed wallet auto-refund, Meilisearch indexer + facets, SEO URL shape with JSON-LD schemas, Razorpay webhook idempotency.

See `docs/plans/` for the per-milestone implementation plan when M2 begins.

---

## Contributing

This is a solo build with Claude as the implementing engineer. The user (Shivam) drives product decisions; Claude implements. Feedback loops happen through:

- ADRs in `docs/adr/` capture load-bearing decisions
- Per-milestone plans in `docs/plans/` capture implementation strategy
- TDD discipline + code review by `everything-claude-code:code-reviewer` and `everything-claude-code:security-reviewer` agents on every major commit
