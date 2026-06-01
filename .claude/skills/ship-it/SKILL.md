---
name: ship-it
description: End-to-end execution from a finished grilling session: synthesize PRD, split into issues if needed, then build every task with TDD + reviewer. Use only when you trust the upstream grilling enough to skip manual review of the PRD and issue split. Otherwise run /to-prd, /to-issues, /build-using-tdd separately.
disable-model-invocation: true
---

Run the full post-grill chain in one supervised pass. Pause for explicit user approval at each checkpoint — do not blow through them.

## Step 1: Verify upstream

Confirm the current conversation includes a recent grilling session with resolved decisions. If not, stop and tell the user to run `/grill-with-docs` first.

## Step 2: PRD

Invoke `/to-prd` logic: synthesize the conversation into a PRD and file it as an issue.

**Checkpoint A.** Show the user the PRD link and ask: "PRD filed at [link]. Approve and continue, edit, or abort?" Wait for an answer. Do not proceed on silence.

## Step 3: Issue split (conditional)

Read the PRD. Decide if it's one vertical slice or multiple:
- One slice → skip to Step 4 with the PRD as the only task
- Multiple slices → invoke `/to-issues` logic to file child issues

**Checkpoint B** (only if you split). Show the user the issue list and ask: "Filed N child issues: [list]. Approve and continue, edit, or abort?" Wait.

## Step 4: Execute

Invoke `/build-using-tdd` logic against the PRD or child issues. Same rules as that skill: implementer → mechanical check → reviewer → route.

## Step 5: Report

Single summary as `/build-using-tdd` produces. Add at the top: "PRD: [link]. Issues filed: [list or 'none']."

## Guardrails

- Checkpoints A and B are mandatory. Do not auto-approve.
- If the user aborts at any checkpoint, stop cleanly. Do not roll back filed issues — the user can close them manually.
- All guardrails from `/build-using-tdd` apply transitively.
