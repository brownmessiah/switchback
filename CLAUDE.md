@AGENTS.md

# CLAUDE.md

## Domain language
Use the terms defined in `CONTEXT.md` verbatim in schema names, code, commits, and docs. Do not drift to the synonyms listed under each entry's `_Avoid_` section. The 50-odd terms there are load-bearing — they line up with `docs/adr/0001` – `0016` and the legacy Convex schema.

## Load-bearing decisions
Read `docs/adr/` before changing any of: payments, refunds, cancellation, vendor verification, commission resolution, Trip Groups, AI guardrails, availability / pricing / permits, SEO architecture, channel-manager ingestion, safety stack, payouts / GST / TDS.

## Engineering workflow
See PLAN.md "Engineering workflow" for the skill + agent map. TDD is mandatory — invoke `superpowers:test-driven-development` at the start of every feature, bugfix, or refactor. Invoke `superpowers:verification-before-completion` before every commit.

## Agent skills

### Issue tracker
Local markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels
Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs
Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Project structure
- `app/` — Next.js App Router routes
- `db/` — Drizzle schema, migrations, query helpers
- `lib/` — Domain logic (auth, payments, AI, etc.)
- `tests/` — Vitest unit + integration (`tests/unit/`) and Playwright E2E (`tests/e2e/`)
- `docs/adr/` — Architectural Decision Records (16 ADRs cover every load-bearing decision)
- `docs/plans/` — Per-milestone implementation plans
- `docs/agents/` — Agent skill docs
