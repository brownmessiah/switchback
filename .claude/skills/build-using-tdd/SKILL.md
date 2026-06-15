---
name: build-using-tdd
description: Execute a PRD or list of issues in dependency order. Code tasks run one fresh sub-agent each on the repo's TDD loop, verified by a tdd-reviewer agent. Design-decision tasks pause for a human-in-the-loop checkpoint — the orchestrator surfaces wireframes/screenshots and waits for approve/reject. Auto-detects child issues (from /to-issues) vs a single PRD. Use after /to-prd or /to-issues when you're ready to build.
disable-model-invocation: true
---

Take a PRD or task list and execute every task **in dependency order**. Code tasks run in a fresh implementer sub-agent using the repo's TDD loop, then a fresh `tdd-reviewer` sub-agent verifies the diff. Design-decision tasks pause and surface wireframes/screenshots to the user for approve/reject. Doc/research tasks produce a markdown artifact. The orchestrator (you) routes between them and runs mechanical checks.

## Repo specifics (read first — these correct the generic skill for this repo)

- **Tracker:** local markdown, described in `docs/agents/issue-tracker.md`. PRD at `.scratch/<feature>/PRD.md`; child issues at `.scratch/<feature>/issues/<NN>-<slug>.md`; triage roles in `docs/agents/triage-labels.md`. The `Status:` line is informational — **this skill does not gate on triage status.** It gates on each issue's `Blocked by` field and its executability.
- **TDD loop:** this repo mandates `superpowers:test-driven-development` (see CLAUDE.md / PLAN.md). Invoke that skill to obtain the loop, then paste its text verbatim into every implementer sub-agent. (There is no `.claude/skills/engineering/tdd` — do not look for one.)
- **Verification commands:** `pnpm typecheck` (tsc --noEmit) and `pnpm test` (vitest run). For issues whose acceptance is browser/E2E, the implementer also runs the relevant Playwright project: `pnpm e2e --project <unauthenticated|customer|vendor|admin|cross-surface|i18n>`. E2E needs the dev server + Postgres + Meilisearch up — either `docker-compose.e2e.yml` (Meilisearch) or, **Docker-free**, `pnpm dev:stack` (native Postgres@15 cluster + downloaded Meilisearch binary; see README "Local dev stack" and `scripts/dev-stack.sh`). The harness is not Docker-only.
- **Migrations are hand-authored** numbered `.sql` — **never run `drizzle-kit generate`**; the test harness replays the `.sql` files.
- **Branch convention:** `task/<issue-number>-<slug>`.
- **gstack is installed** (`~/.claude/skills/gstack`, `browse` binary built, `bun` present). Relevant skills: `design-shotgun` (3-variant comparison board → Step 4D), the `browse` binary (`~/.claude/skills/gstack/browse/dist/browse` — screenshots, before/after, exploratory functional checks), `design-review` (post-implement visual QA on redesigned pages), `design-consultation` / `plan-design-review` (the design-language issues), `benchmark` (Core Web Vitals for the hardening issue). **Do NOT use `design-html`** — it emits Pretext HTML, not this repo's React/Tailwind v4/shadcn stack.
- **`mcp-image` (Gemini)** is configured in `.mcp.json` for generating realistic seed/mockup imagery (experience/vendor/destination photos, illustrations, empty-state art, OG images). Demo/seed only — never present AI images as real vendor/experience content.

## Step 1: Detect the input source

- **Issue-list mode:** the most recently referenced PRD has child issues (from `/to-issues`) under `.scratch/<feature>/issues/`.
- **Single-PRD mode:** a PRD exists with no child issues — the whole PRD is one task.

If you can't tell, ask one question: "Which PRD or issue should I execute? Paste the path or number." If the PRD is clearly multiple vertical slices but has no child issues, stop: "Run `/to-issues` first."

## Step 2: Load shared context once

Read into the orchestrator's working memory — these get pasted into every sub-agent prompt:

- `CONTEXT.md` (or every `CONTEXT.md` listed in `CONTEXT-MAP.md` if it exists)
- the `docs/adr/` index; include the body of any ADR a task references
- the `superpowers:test-driven-development` loop — invoke the skill and keep its loop text so you can paste it verbatim

## Step 3: Build the dependency-ordered, typed task list

Fetch all tasks. For each, record: number, `Type` (AFK / HITL), `Blocked by`, and acceptance criteria.

**Classify each task:**
- **Code task** (AFK) — builds or changes tested code. Runs the TDD loop (Step 4A–4C).
- **Design-decision task** (HITL) — produces or selects a design (variant picks, DESIGN.md approval). Routes to the design checkpoint (Step 4D), NOT the TDD loop. An implementer agent cannot make a taste decision.
- **Doc/research task** (AFK, no tests) — produces a markdown artifact (competitor research refresh, DESIGN.md draft). Runs as a single sub-agent that writes the artifact; verified by reading it, not by tests (Step 4E).

**Executability check** (code tasks): acceptance criteria are concrete (not "make it good"), no open questions in the body, scope is one vertical slice. Failing tasks get marked `needs-grilling` and skipped; report at the end.

**Order by dependency.** Maintain a ready-queue of tasks whose entire `Blocked by` list is complete. **Never start a task with an unsatisfied blocker.** If the only remaining tasks are all blocked by an unfinished HITL task, pause and tell the user exactly which approval unblocks them.

## Step 4: Execute (dependency order; sequential by default)

Pull the next ready task and route by type.

### 4A–4C — Code task: implementer → mechanical check → reviewer

**(a) Launch implementer sub-agent.** `subagent_type: general-purpose`. Prompt must contain:
- Task body and acceptance criteria, verbatim
- Full `CONTEXT.md` contents, pasted inline
- Any ADRs the task references, pasted inline
- The `superpowers:test-driven-development` loop, pasted inline (not referenced)
- Branch convention: `task/<issue-number>-<slug>`
- Stop conditions: "Stop when every acceptance criterion has a passing test, `pnpm typecheck` is clean, and `pnpm test` passes. If acceptance is browser/E2E, the relevant Playwright project must also pass. Then commit on the task branch and report back with branch name, files changed, and a one-paragraph summary. Do not open a PR."
- Failure protocol: "If you get stuck for more than three failing attempts on the same test, stop and return the failing test, error, and what you tried."
- Permissions: "You may not push, force-push, rebase, or delete branches. Never run `drizzle-kit generate` — migrations are hand-authored `.sql`."

**(b) Mechanical verification in the orchestrator.** Check out the branch. Run `pnpm typecheck` and `pnpm test` (and the task's Playwright project if its acceptance is browser/E2E). If either fails, send the failure to a *new* implementer sub-agent (fresh context) with the diff and failing output. Cap at 2 retries.

**(c) Launch `tdd-reviewer` sub-agent.** Pass it:
- Original task body and acceptance criteria
- Full `CONTEXT.md` contents
- Any referenced ADRs
- Branch name and the implementer's summary

**(d) Route on reviewer verdict:**
- `pass` → mark done, unblock dependents, next task
- `needs-changes` → fresh implementer sub-agent with the original task plus the reviewer's issue list. Cap at 2 review cycles.
- `fail` → stop the task, mark failed, surface to user. No blind retry.

Both mechanical checks AND the reviewer verdict must be green to advance.

### 4D — Design-decision task: human-in-the-loop checkpoint

This repo has exactly **ONE** human gate: the single **design-selection** issue (`62-design-selection-owner-pick`). Everything else — including variant *generation* and `DESIGN.md` finalization — is AFK. Per the owner: do NOT wait for design approval anywhere except that one issue.

- **Variant-generation tasks (`e-gen-*`, AFK — NOT a gate):** produce 3 codex-curated variant mockups per archetype on the finalized `DESIGN.md` and save them under `.scratch/mvp-validation-redesign/mockups/<archetype>/` — do NOT wait for the owner. Primary: `design-shotgun` + `mcp-image` (Gemini) for realistic imagery; capture a "before" from `tests/e2e/screenshots/` (or via the gstack `browse` binary `~/.claude/skills/gstack/browse/dist/browse screenshot ...`); benchmark the named competitor via firecrawl. Run a `codex` critique to cut weak variants down to 3 strong, distinct options. Verified by reading the saved board (normal AFK path).
- **`DESIGN.md` finalization (AFK):** auto-finalized (run a `codex` design critique, incorporate, mark FINAL). No human approval gate.
- **The single design-selection task (HITL — the only gate):** present ALL archetype boards together via `SendUserFile` + `PushNotification`, with a one-line friction rationale per variant. The owner picks one variant per archetype in a single batch. **Wait for the reply; do not proceed on silence.** Record each pick under this issue's `## Comments`. This unblocks every implement task.

### 4E — Doc/research task

Launch one sub-agent to produce the markdown artifact per the acceptance criteria (e.g. refresh the `RESEARCH.md` section + capture competitor screenshots, or write the DESIGN.md draft). Verify the artifact exists and meets the criteria by reading it. Mark done, unblock dependents.

## Step 5: Report

One summary message when the queue drains:

- **Completed** (branch name + one-line summary)
- **Design decisions made** (archetype + chosen variant)
- **Needed retries** (which, why)
- **Failed** (full error, last sub-agent message)
- **Skipped** (`needs-grilling` reasons)
- **Still blocked** (which tasks, and which approval/blocker unblocks them)

Do not merge, rebase, or open PRs. Human owns review.

## Guardrails

- Never launch a code sub-agent without task body + `CONTEXT.md` + the TDD loop pasted into the prompt.
- Never trust a sub-agent's "done" claim without mechanical verification.
- Never start a task with an unsatisfied `Blocked by`.
- Never auto-decide a HITL design task — always surface wireframes/screenshots to the user and wait for approve/reject.
- Never run `drizzle-kit generate` (migrations are hand-authored numbered `.sql`).
- If three consecutive code tasks fail, stop the entire run — something systemic is wrong.
- Parallel execution only if the user explicitly requests it AND no two queued tasks touch overlapping file paths AND neither is blocked by the other.
