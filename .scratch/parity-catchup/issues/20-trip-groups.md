# 20: Trip Groups + `/community` (EPIC — needs its own PRD)

Status: done

> **IMPLEMENTED 2026-06-01 (owner pre-authorised "do the HITL items without my input").** The 4 open decisions were resolved with the PRD's recommendations: ADR-0009 design stands (migrated); **polling v1, Pusher chat deferred** (slice 8); women-only gate ships **correct-but-inert** (blocks `unverified` — Aadhaar eKYC is a tracked dependency, never faked); lifecycle/capacity/booking-linkage per ADR-0009.
> **Shipped (slices 1–7):**
> - **Schema + migration 0021:** `trip_groups` / `trip_group_members` / `trip_group_itinerary_slots` + 5 enums; `bookings.trip_group_id` FK (ON DELETE SET NULL — isolation).
> - **Domain (7 modules, PGlite-TDD, 48 tests):** `group-lifecycle` (pure 6-state machine + guards), `groups` (create+roster), `membership` (join/approve/decline/leave/remove/transfer + women-only `evaluateJoinEligibility`), `discovery` (`/community` query, gender never selected — privacy test), `itinerary` (slot CRUD + Experience-ID grounding + last-write-wins), `booking-linkage` (`assertCanBookForGroup` + per-slot progress), `group-transitions` (host lock/advance + `sweepAutoArchive`).
> - **UI:** `/community` (discovery + filters + create) and `/community/[groupId]` (roster, co-edit itinerary, join/leave/approve, booking progress); Server Actions; user-menu link; `/community` in EXCLUDED_PREFIXES; English copy v1 (i18n namespace deferred).
> - **Checkout (slice 6):** group-tagged seats validated via `assertCanBookForGroup` then tagged through createBooking; per-member isolation preserved.
> - **Cron:** `/api/cron/trip-groups-archive` (daily) runs `sweepAutoArchive`.
> - **Seed + E2E:** isolation-safe demo (3 groups) + a 4-test `/community` E2E (create / discover / join-leave / women-only block) — **all green** through the live stack (also fixed a D2-regression where global-setup imported lib/env at load time).
> **Verified:** full vitest 1809/0; typecheck + i18n clean; eslint clean on changed files; E2E 4/4.
> **Deferred (own follow-up):** slice 8 Pusher real-time chat (needs a Pusher account); group→experience→checkout `tripGroupId` UX forwarding (the tagging mechanism + guard are done + reachable via `/checkout?tripGroupId=`); i18n namespace for `/community`; Aadhaar eKYC to light up the women-only gate.
Type: HITL
Priority: P1
Gap class: feature-gap
Source: community-tripgroups (com-only); the standing-question verdict (REPORT.md P1.1)

## Parent

[Parity audit REPORT.md](../../parity-audit/REPORT.md)

## What to build

com's documented **hero differentiator**: traveller-to-traveller group planning + real-time group chat at `/community`, backed by `tripGroups` / `tripGroupMembers` / `tripGroupMessages`. next has **only** a vestigial `bookings.trip_group_id` column (no table, no route, no logic) — ADR-0009 defines a schema that was **never migrated**.

This is an **EPIC, not a single tracer bullet**. Before implementation it needs a dedicated planning pass because of load-bearing decisions:
- **ADR-0009 revisit** — is the documented schema still the design? It was never migrated.
- **Real-time chat infrastructure** — Pusher / WS / polling? (`lib/pusher/*` only references it in comments today.)
- **Women-only gate** — `customer_profiles.aadhaarGenderVerified` exists but is unused; confirm the product rule + KYC dependency.
- **Group lifecycle** — open/full/completed/cancelled; organizer rules; capacity; booking linkage (`trip_group_id`).

## Acceptance criteria

- [ ] **First:** run `/to-prd` for Trip Groups → a dedicated PRD + ADR-0009 update with the chat-infra, gender-gate, and schema-migration decisions resolved
- [ ] Then break that PRD into its own vertical slices (schema migration → create/list/join/leave → group detail → chat → booking linkage), each with tests
- [ ] Hand-authored migration for the new tables (no `drizzle-kit generate`)
- [ ] This issue is the umbrella; do not implement directly off it without the PRD

## Blocked by

None to start the PRD - but implementation is gated on the planning decisions above (HITL).
