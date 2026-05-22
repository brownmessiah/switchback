# Outvers

Indian adventure-activity marketplace — rafting, paragliding, scuba, trekking, multi-day expeditions. Ground-up rebuild of the legacy app at `/Users/aishwaryechauhan/Personal/travel-app/` on a portable, owned stack.

Status: **M2 Money-path backend complete** (Tasks 1–18, 22 of `docs/plans/2026-05-23-m2-money-path.md`). UI tasks (Experience detail, Razorpay Checkout.js, confirmation page, faceted search) + E2E pending — see `docs/plans/m2-verification.md`. See `PLAN.md` for the milestone schedule.

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
- better-auth with Drizzle adapter, Google OAuth, MSG91 phone OTP
- Service wirings: Redis (Upstash), R2 (Cloudflare), Resend, Pusher, Sentry
- Typed env validation with Zod 4
- GitHub Actions CI: lint + typecheck + unit (coverage) + e2e

## What's done (M2 backend — 2026-05-23)

The full money path is wired and exercised by **430 unit + integration tests** (≥95% line coverage on `lib/payments/*`). All commits security-reviewed pre-merge.

- **Schema gaps (Tasks 1–3):** `refund_requests` table; `payments.refund_request_id` FK + consistency CHECK; bookings `payout_method_snapshot` + `payout_destination_snapshot`; structural UPDATE-block trigger on the 12 booking snapshot columns; append-only trigger on `audit_logs`; slug CHECK on tier names.
- **Pure resolvers (Tasks 4–8):** `quoteRefund` (Flexible/Moderate/Strict windows), `resolveCommission` (festival → exp override → vendor → default), `resolvePricing` (tier → group-size bracket → base), `quoteTds` (Section 194-O), `quoteGstOnCommission` (18% IGST), centralised `writeAuditLog`.
- **Booking-create transaction (Task 9):** single `db.transaction` SELECT FOR UPDATE the slot, all 12 snapshots populated, capacity decrement, RNPL rejected, partial-pay <48h coerced + >Rs.25k escrow-flavoured, Redis-backed 24h idempotency.
- **Razorpay (Tasks 10–12):** SDK wrapper with paise conversion + error normalisation (no key_id echo in auth errors); HMAC-SHA256 webhook signature verifier (`crypto.timingSafeEqual`); idempotent webhook handler — Redis dedup (14-day TTL) + DB unique on `razorpay_payment_id`; 1000x serial replay yields exactly one payment row.
- **Wallet + refund flow + cancellation (Tasks 13–15):** two-bucket wallet (Outvers credit, Refund balance) with spend-order and ownership-checked cashout; `processRefund` orchestrates inside/outside-policy + vendor-cancelled with snapshot-rule respect and defense-in-depth ownership guard; `cancelBookingAction` Server Action wired to better-auth session with sanitised user-facing messages.
- **Partial-pay auto-capture (Tasks 16–17):** Vercel Cron every 15 minutes; selection by `(state=confirmed, payment_mode=partial_pay, slot.startAt ∈ T-24h ± 30min)`; TOCTOU-closed via SELECT FOR UPDATE + structural partial unique index `payments_one_autocapture_per_booking`; Razorpay-returned amount validated; terminal failure audits but keeps booking `confirmed` (no silent M3 auto-complete).
- **SEO scaffolding (Tasks 18, 22):** Region + activity registries (controlled vocabulary, 10 each); JSON-LD generators (BreadcrumbList, ItemList of Products with INR offers, FAQPage); activity-city Server Component page at `/{lng}/adventure/{activity}-in-{city}`; Meilisearch client + Experience indexer.

## What's pending (M2 UI — next session)

See `docs/plans/m2-verification.md` for the full inventory. Needs a session with browser access + live Razorpay test account:

- **Task 19** Experience detail page (Product + AggregateRating + Review + FAQPage JSON-LD, slug-redirect handling, permit panel)
- **Task 20** Checkout Server Action + Razorpay Checkout.js client component
- **Task 21** Booking confirmation page + React Email template
- **Task 23** Faceted search route (`/{lng}/search`)
- **Task 24** Playwright happy-path E2E: register → browse → checkout → Razorpay test card → confirmation → cancel inside-policy → refund_balance credited

See `docs/plans/` for the per-milestone implementation plan.

---

## Contributing

This is a solo build with Claude as the implementing engineer. The user (Shivam) drives product decisions; Claude implements. Feedback loops happen through:

- ADRs in `docs/adr/` capture load-bearing decisions
- Per-milestone plans in `docs/plans/` capture implementation strategy
- TDD discipline + code review by `everything-claude-code:code-reviewer` and `everything-claude-code:security-reviewer` agents on every major commit
