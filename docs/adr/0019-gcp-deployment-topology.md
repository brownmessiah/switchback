# GCP deployment topology

## Status

accepted (2026-06-20)

## Context

The app had never been deployed. The code carried Vercel-isms (`vercel.json` cron, `CRON_SECRET` Bearer auth, Neon Postgres pooled/direct split, Cloudflare R2 storage with a GCS *stub*, Upstash REST Redis) but no production target existed. We are deploying to **Google Cloud Platform**, going **GCP-native** for the pieces that carry real lock-in (compute, primary datastore, object storage) while keeping cloud-agnostic SaaS where it is genuinely cheaper or lower-ops.

**This first environment is a live demo / showcase running on production-grade infrastructure, not a real-money production system.** Razorpay (and Razorpay X) stay in **TEST mode**; the database is fully seeded with the demo catalog + blog corpus. The intent is to prove the real architecture now and flip to real money later via a documented cutover (see *Deferred: real-money cutover*). Several choices below (India region, PITR, Cloud Armor, OIDC-hardened cron) are therefore *future-proofing* rather than *compliance-today* — but they are cheap to keep and avoid a re-architecture at go-live.

## Decision

### Scope: what runs where

| Concern | Decision |
|---|---|
| Compute | **Cloud Run** (gen2) |
| Primary DB | **Cloud SQL for PostgreSQL 16**, zonal |
| Object storage | **GCS** (public bucket) — implement the stubbed `GcsAdapter`, retire R2 |
| Search | **Postgres-native** — remove Meilisearch entirely (amends ADR-0013) |
| Redis (dedup / rate-limit / cache) | **Upstash kept** (pragmatic; not Memorystore) |
| Cron | **Cloud Scheduler** → private Cloud Run cron service |
| Secrets | **Secret Manager** |
| Ingress | **Global External ALB + Serverless NEG + Cloud CDN + Cloud Armor** |
| CI/CD | **GitHub Actions + Workload Identity Federation** → Artifact Registry → Cloud Run |
| Kept SaaS (cloud-agnostic) | Resend, Pusher, Sentry, PostHog, Razorpay/X, better-auth, OpenAI/Anthropic, Mapbox |

### Environment & region

- **Single environment ("prod"), single GCP project, single region `asia-south1` (Mumbai).** No staging (cost). The LB is global/anycast; all regional resources (Cloud Run, Cloud SQL, Artifact Registry, GCS) are `asia-south1`.
- Region is India-based for user latency and **forward RBI payment-data-localization** compliance (binding only once real money is enabled).
- Because there is no staging, every migration's first real run is against this DB — mitigated by an on-demand backup before each migrate (see *Migrations*) and validation against a throwaway clone / local PGlite first.

### Compute: one image, two services

- A single container image is deployed as **two Cloud Run services**:
  - **Public web service** — `--allow-unauthenticated`, `min-instances=1`, `cpu=1`, `memory=1Gi`, `concurrency=80`, `max-instances=4`.
  - **Private cron service** — `--no-allow-unauthenticated`, `min-instances=0` (scale-to-zero; cold-start is fine for scheduled batches), invoked only by the Cloud Scheduler service account via **OIDC**.
- `min-instances=1` on the web service keeps checkout + payment-webhook paths warm (no cold start).
- The cron route handlers are **env-gated**: they return `404` unless `RUN_CRON_ROUTES=true`. The flag is set only on the cron service, so `/api/cron/*` is *unreachable* on the public URL. `CRON_SECRET` is still configured on the cron service for defense-in-depth on top of OIDC.

### Networking

- One **VPC**. Cloud Run reaches the data tier via **Direct VPC egress** (not the legacy Serverless VPC Access connector) into a dedicated subnet.
- The data tier (Cloud SQL, future private resources) is **private-IP-only** — no public IP anywhere.
- Cloud Run egress = **"private ranges only"**, so calls to external SaaS (Razorpay, Resend, Pusher, OpenAI, Sentry, PostHog) go straight out — **no Cloud NAT** needed. No integration requires a static outbound IP (Razorpay verifies webhooks by signature, and those are inbound).

### Database

- **Cloud SQL PG16, zonal** (single node), tier `db-custom-1-3840` (1 vCPU / 3.75 GB). HA deferred — switching to regional HA later is a brief restart, not a re-architecture.
- **Automated daily backups + PITR (WAL archiving) ON** even without HA — the recovery path for a zone failure.
- Connection pooling stays **in-app** (`postgres.js` `max:10`). `max-instances (4) × 10 = 40` stays well under the instance's `max_connections`. Reach for Cloud SQL managed connection pooling / PgBouncer only if that ceiling is ever hit.
- Neon's pooled/direct URL split collapses to **one `DATABASE_URL`** (app + migrations). `prepare:false` retained (harmless; keeps a future pooler viable).

### Migrations

- The 34 hand-authored `db/migrations/*.sql` are the source of truth. Drizzle's journal is **stale** (~18 entries / snapshots only to `0005` vs 34 files) so `drizzle-kit migrate` is unusable, and `drizzle-kit push` (used by the e2e harness) is destructive — **neither runs against prod**.
- A small **tracked migration runner** (tsx) maintains a `schema_migrations(filename, applied_at)` table, applies pending `.sql` in lexical order, each in its own transaction, and stops loudly on first failure.
- It runs as a **Cloud Run Job** (same image, alternate entrypoint) so it executes *inside the VPC* against private Cloud SQL (a GitHub-hosted runner cannot reach the private IP).
- Deploy sequence: tests green → build/push image → `gcloud sql backups create` → execute migrate Job → **only on success** `gcloud run deploy` (traffic shift).

### Object storage

- Implement `GcsAdapter` on `@google-cloud/storage` using **ADC** (Cloud Run's attached service account — no key files), against a **public bucket** (uniform bucket-level access, `allUsers:objectViewer`). Matches the existing `getUrl()` → `storage.googleapis.com/<bucket>/<key>` pattern (already whitelisted in `next.config`).
- Add a `getStorageAdapter()` factory (GCS in prod, `LocalFileAdapter` in dev) and wire it into the **3 call sites that currently hardcode `new LocalFileAdapter()`** (review photos, blog cover, listing images) — as-is these would write to Cloud Run's ephemeral disk. Retire `R2_*`.
- **Forward guardrail:** when KYC docs / invoices / payout statements get an upload path (M3, ADR-0007/0016), they go in a **separate private bucket served via signed URLs** — never the public one.

### Search (amends ADR-0013)

- Meilisearch is **removed** — no VM, no managed instance, no `indexer.ts`, no reindex script, no second source of truth.
- The `q` text query is served by **Postgres FTS (`tsvector` + GIN) + `pg_trgm`** over `title` + `shortDescription`; all facets/filters/sorts/facet-counts are plain SQL — in the Cloud SQL already running. `search-experiences.ts` is rewritten behind the existing `MeiliLike`/search abstraction.
- Rationale: small, single-language catalog already on Postgres; this deletes the most ops-heavy component *and* the most fragile behavior (a Meili outage previously returned empty `/search` with **no Postgres fallback**). Search is now exactly as available as the DB the rest of the site already needs. Semantic search later = **pgvector in the same Cloud SQL**, still native.

### Cron

- **Cloud Scheduler**, timezone **`Asia/Kolkata`** (payout batch expressed as `0 17 * * *` IST directly rather than UTC math). Three jobs mirror the old `vercel.json`: partial-pay-autocapture (`*/15`), trip-groups-archive (daily), payout-batch (5pm IST).
- Targets the **private cron service** with an **OIDC token** (scheduler SA as the only invoker), plus the existing `CRON_SECRET` header check.

### Ingress

- **Global External Application Load Balancer** with a **Serverless NEG** to the public Cloud Run service. Managed TLS, anycast IP, apex + www.
- **Domain: `switchback.com`** (registered at **GoDaddy**, DNS stays at GoDaddy), **configured last**. The agent reserves a global static IP + creates the Google-managed cert resources itself; the final step — apex `A` (+ `www`) records pointing at the LB IP and cert domain-authorization — is a **manual GoDaddy edit** (agent has no GoDaddy API access) unless GoDaddy API creds are provided. Until DNS is live, the E2E validation loop runs against the **LB IP / Cloud Run URL**. **Build-time sequencing:** `NEXT_PUBLIC_APP_URL` is baked into the image, so pre-DNS builds carry the temp URL and the image is **rebuilt/redeployed with `https://switchback.com`** at the domain step (when the Google OAuth redirect URI and better-auth `trustedOrigins` also flip to the real domain).
- **Cloud CDN** edge-caches `/_next/static`, `/_next/image`, and public/ISR pages. Cache rules **must never cache** authenticated responses, Server Actions, or API routes (driven by app `Cache-Control`).
- **Cloud Armor** (WAF / rate-limiting / DDoS in front of auth + payment surfaces) is **deferred to the real-money cutover** — the demo runs in Razorpay TEST mode, so the LB + CDN go up now and the Armor policy is attached at go-live. When attached, rules **must not block Razorpay inbound webhooks**.

### CI/CD

- Extend the existing **GitHub Actions** CI. A deploy job, gated behind lint/typecheck/test/e2e, authenticates via **Workload Identity Federation** (no long-lived SA JSON in GitHub), builds the image, pushes to **Artifact Registry**, runs the migrate Job, then `gcloud run deploy`.
- WIF trust is **scoped to this repo + the `main` branch only**, with a **least-privilege deploy service account** (no repo-wide/org-wide trust).
- **Auto-deploy on merge to `main`** (no manual approval gate) — fast iteration. The safety net is therefore the **tagged `--no-traffic` → smoke → shift** rollout: the smoke check (deep `/healthz` + a real read path) is load-bearing since it is the only gate before 100% traffic, and a bad revision is one `update-traffic` away from rollback.

### Secrets & container

- All secrets in **Secret Manager**, exposed to Cloud Run as **secret references** (mounted env vars) at runtime. Terraform creates the secret *containers* + IAM bindings (Cloud Run SA = accessor) but **not** the versions — values are added out-of-band (`gcloud secrets versions add`) so plaintext never enters tf state or git. Rotation is manual/documented; rotating `BETTER_AUTH_SECRET` invalidates all active sessions (acceptable for the demo), and provider keys rotate at the provider → add a new secret version → redeploy.
- **Footgun:** `NEXT_PUBLIC_*` (notably `NEXT_PUBLIC_APP_URL`) are **baked at build time** by Next — they must be passed as **Docker build args in CI**, not just set on the service.
- New `Dockerfile`: multi-stage pnpm build (full Node 22 build stage), **`output: 'standalone'`** in `next.config`, **distroless runtime stage** (`gcr.io/distroless/nodejs22-debian12` — minimal attack surface, glibc so `sharp` + the Node-based migration Job work; no shell, so debug via logs), non-root, `.dockerignore`. **Build gotcha:** standalone file-tracing must include the pnpm-workspace symlinked deps — verify the standalone server starts before relying on the image (this repo has a `pnpm-workspace.yaml`).
- **Footgun:** remove the ngrok dev hacks in `next.config`; `serverActions.allowedOrigins` and better-auth `trustedOrigins` must include the **prod domain**, or Server Actions fail the Origin/Host CSRF check behind the LB.

### IaC

- All GCP infrastructure is defined in **Terraform** (HCL), remote state in a dedicated GCS bucket. One root module covers the ~15 resource types; standing up staging at cutover is a `tfvars` copy, not a manual rebuild. Terraform manages the Secret Manager secret *containers* + IAM but **not** secret versions (see *Secrets*).

### Health checks & deploy safety

- Add an unauthenticated **`/api/healthz`** route. **Startup probe = deep** (`SELECT 1`, short timeout) so an instance enters rotation only once Cloud SQL is reachable; **liveness + LB backend check = shallow** (process-up) so a transient DB blip doesn't drop every instance at once. Note: `lib/env.ts` parses env at import, so a missing required secret fails the container at boot (fail-fast — the revision won't go healthy until all required secrets are wired).
- **Rollout:** deploy the new revision with `--no-traffic` + a unique tag, smoke-test the tagged URL (deep healthz + a read path), then shift 100%. The previous revision is retained for one-command rollback (`update-traffic --to-revisions=PREV=100`, no rebuild). Expand/contract migrations keep that rollback schema-safe.

### Observability & alerting

- Cloud Logging is automatic. **Cloud Monitoring alerts (demo phase): cron/payout-job failure, public-service 5xx rate, Cloud SQL disk%/connections/instance-down, and a synthetic uptime check** on the public URL → **email** notification channel. **Sentry** owns app-exception alerting (no duplication); PostHog remains. Escalate to Slack/SMS at the real-money cutover.

### Backups

- Cloud SQL **automated daily backups + 7-day PITR** (on even though zonal). The demo DB is fully reproducible from code (migrations + `db:seed*`), so heavy DR — longer retention, off-instance logical dumps to GCS, a *tested* restore drill — is **deferred to the real-money cutover** when data becomes irreplaceable.

### Image delivery

- Keep **Next/Image** optimization; **Cloud CDN caches `/_next/image`** (long max-age; the Unsplash/GCS sources are stable) so variants compute once then serve from edge — origin CPU stays bounded under the lean sizing. An external image CDN/loader is revisited only if image-opt CPU becomes a real cost line (and would reintroduce a non-GCP vendor).

### Cost guardrail

- A GCP **billing budget of $120/mo**, **alert-only** (no billing auto-disable — that would kill the live demo), email alerts at **50% / 90% / 100%**. Estimated GCP spend is ~$100-160/mo (Cloud SQL always-on, Cloud Run min=1, LB+CDN baseline, GCS/AR/egress; SaaS bills separately), so the cap sits *inside* the estimate by design — expect to trip the upper alerts and tune once real numbers land.

## Considered options (rejected)

- **Memorystore for Redis** — rejected; Upstash kept. Every Redis use tolerates eviction (structural DB floors), so HA/persistence is unneeded, and Upstash is near-$0 pay-per-use with zero code change vs ~$35-50/mo always-on Memorystore.
- **Meilisearch Cloud / self-hosted Meili VM** — rejected in favor of Postgres-native search (above).
- **AlloyDB** and **regional-HA Cloud SQL** — deferred; zonal Cloud SQL fits a pre-revenue demo, upgradeable later.
- **staging environment** — deferred (cost); prod-only with pre-migrate backups.
- **Cloud Run domain mapping** / **Cloudflare front** — rejected; ALB+CDN+Armor is the production-correct ingress for an SEO + money site and stays GCP-native.
- **Cloud Build triggers** — rejected; GitHub Actions already hosts CI, WIF keeps it keyless.
- **`drizzle-kit migrate`/`push` against prod**, and **migrate-on-startup** — rejected (stale journal; destructive; instance races) in favor of the tracked Cloud Run Job runner.
- **Serverless VPC Access connector** and **Cloud NAT** — rejected; Direct VPC egress with private-ranges-only egress is cheaper and sufficient.
- **Firebase Auth** (instead of better-auth) — rejected. better-auth is the relational spine: ~89 files use its helpers and ~29 schema tables FK the `users` table; the ADR-0006 multi-role / vendor-team / multi-seat / KYC-tier authz is relational and keyed on the Postgres user id, which doesn't fit Firebase's ≤1000-byte non-relational custom claims (would force a dual Firebase↔Postgres source of truth or a full FK refactor). It would also replace the India-DLT-compliant MSG91 phone OTP with Firebase Phone Auth, and move identity into a managed external store (lock-in). Firebase Auth only wins greenfield; auth here is already built and working.
- **Firebase App Hosting** (instead of Cloud Run + ALB) — rejected for now. App Hosting is a managed wrapper *over* Cloud Run + Cloud Build + Cloud CDN, not an alternative to it. Two blockers: (1) the framework integration is documented to work with **Next.js 12–15.0** ("you may encounter errors"; firebase-tools #9666 is a Next 16 breakage) while the app is on **Next 16.2.6**; (2) it undoes deliberate choices here — no first-class Cloud Armor/WAF attachment, no clean mapping for the two-service public-web + private-OIDC-cron split, and loss of Dockerfile/Node-version control to buildpacks. It *does* support VPC + private Cloud SQL, and its GitHub-push DX is nicer — revisit only if Next is pinned ≤15 and managed DX is preferred over explicit control.

## Deferred: real-money cutover

Before this environment takes real customer money, a documented cutover must: purge demo/fixture data; set `RAZORPAY_TEST_MODE=false` + live Razorpay/X keys + `RAZORPAYX_ACCOUNT_NUMBER`; register prod webhook URLs (Razorpay + X) and secrets; **attach the Cloud Armor WAF policy to the LB** (deferred from the demo phase); verify Resend sending domain (SPF/DKIM/DMARC); add the prod Google OAuth redirect URI; confirm `asia-south1` satisfies RBI residency; and switch real vendor onboarding on. Consider adding a staging environment and regional-HA Cloud SQL at that point.

## Execution context (for the next session)

This plan is executed in a later session **after `/to-prd` + `/to-issues`**. That session does **all** config itself via the `gcloud` / `gsutil` / `gh` / `terraform` CLIs and only pings the human for things genuinely impossible headlessly.

### Accounts & project (verified 2026-06-20)

- **GCP:** account **`aishwarye@switchback.com`** (already the active `gcloud` account), project **`switchback-adventure`** (already the active project). All GCP/Terraform work targets this account+project.
- **GitHub:** account **`aishwarye-creator`** (active `gh` login; token has `repo` + `workflow` scopes). Create a **private** repo **`aishwarye-creator/switchback-next`**, add it as `origin`, push. (No `origin` remote exists yet.)
- **WIF trust:** scoped to **`aishwarye-creator/switchback-next` @ `refs/heads/main`** (see *CI/CD*).

### Agent does it all via CLI

- Repo creation + push (`gh repo create … --private`, `git remote add origin`, push), GitHub Actions/secrets/Environment config (`gh`), and **all** GCP provisioning (enable APIs; Terraform apply for VPC, Cloud SQL, Cloud Run ×2 + Job, Artifact Registry, GCS + IAM, Scheduler, LB+NEG+CDN, Secret Manager containers + IAM, WIF, budget, monitoring) are done by the agent.
- **Secret values:** source from the existing **`.env.local`** (it already holds them) → `gcloud secrets versions add`. So secrets do **not** require pinging the human.
- **Enable required APIs** first: run, sqladmin, compute, artifactregistry, secretmanager, cloudscheduler, iamcredentials, sts, monitoring, logging, cloudbilling, certificatemanager (+ dns if Cloud DNS is used).

### Ping the human ONLY for (genuinely un-automatable)

- **Billing account linkage** to `switchback-adventure`, if not already enabled (agent checks first; flags only if missing).
- **GoDaddy DNS record edits** for `switchback.com` (apex `A` + `www` → LB static IP, + cert domain-authorization), done **last**. The agent has no GoDaddy API access, so either the human adds the records or provides GoDaddy API creds. Everything else (static IP, managed cert resource, rebuild with `https://switchback.com`) the agent does itself.
- Any secret value **not** present in `.env.local` (e.g. live keys — N/A in the TEST-mode demo).

### Definition of done — post-deploy E2E validation loop

The deployment task is **not done until the hosted app works without errors.** After deploying, the agent **validates the live HTTPS URL** (not just local) with **Chrome DevTools and/or Playwright**: check for console/network/server errors and exercise the critical flows (auth via demo login, browse/search, PDP, checkout in Razorpay TEST mode, vendor dashboard). On any issue → fix → redeploy → re-validate, looping until the hosted app behaves as expected with no errors. (Auth E2E needs a freshly-restarted server context and demo-login session minting — see project memory gotchas.)

## Consequences

- The data tier is fully private; only the LB is internet-facing.
- One image, two services, env-gated cron → cron endpoints are absent from the public surface.
- Search and storage both require code work before first deploy (Postgres search rewrite; `GcsAdapter` + factory + 3 call sites). Redis requires none.
- Migrations are forward-only; schema changes must be **backward-compatible (expand/contract)** so a Cloud Run revision rollback never faces a schema it can't run against.
