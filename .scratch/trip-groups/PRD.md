# PRD: Trip Groups + `/community` (hero differentiator)

Status: IMPLEMENTED 2026-06-01 (slices 1–7; slice 8 Pusher chat deferred). The 4 open decisions were resolved with the recommendations below (polling v1, women-only gate inert-but-correct, ADR-0009 stands). See `.scratch/parity-catchup/issues/20-trip-groups.md` for the shipped inventory.
Created: 2026-06-01
Type: EPIC (planning PRD — implemented inline under owner pre-authorisation rather than via /to-issues)
Source: parity-catchup issue 20 · `docs/adr/0009-trip-group-model.md` · parity-audit REPORT.md P1.1
Triage label: needs-triage

> **This is a planning PRD, not a build ticket.** Per parity-catchup #20 (HITL), implementation is gated on the four OPEN DECISIONS below. Resolve those (updating ADR-0009), then run `/to-issues` to break this into the vertical slices in §Implementation.

## Problem Statement

A customer who wants to do an adventure trip with others — friends, or strangers with shared intent ("anyone going to Rishikesh rafting in October?") — has nowhere on Switchback to convene, plan a shared itinerary, or coordinate. outvers.com markets traveller-to-traveller **Trip Groups** + a `/community` surface as its hero differentiator; outvers-next has only a vestigial `bookings.trip_group_id` column — the `docs/adr/0009` schema was **never migrated**, there is no `/community` route, and no logic. Solo and safety-conscious travellers (notably women travelling alone) have no way to find a verified group to travel with.

## Solution

A customer-led **TripGroup** entity (per ADR-0009) that lives from "I'm thinking of going to X" through "we finished the trip." A host convenes a group with a destination/date-window/interest intent; others discover and join it on `/community` (subject to visibility + membership rules, including a **women-verified-only** option gated on Aadhaar eKYC gender); members collaboratively assemble a day-by-day itinerary of real Switchback Experiences; each member **books their own seat individually** (payment/refund/KYC/liability stay per-member — the group never books on anyone's behalf); and the group coordinates via real-time chat. The group owns its own lifecycle state, distinct from any Booking.

Domain vocabulary (CONTEXT.md / ADR-0009): **TripGroup** is the schema/code entity; **Trip** is customer-facing UI copy only (never in schema/domain code). The AI itinerary builder at `/trip-planner` (parity-catchup #16, shipped) is a DISTINCT surface — ADR-0009 flags the name overlap; consider `/community` for groups and keep `/trip-planner` for the AI builder (no rename needed now).

## User Stories

1. As a customer, I want to create a TripGroup with a destination, date window, budget range and interest tags, so that I can convene a trip.
2. As a host, I want to set my group's size cap (≤12, platform max), so that it stays a group and not a tour.
3. As a host, I want to choose visibility — `private` (invite-only), `public_all`, or `public_women_only` — so that I control who can discover/join.
4. As a host, I want to choose a membership rule — `auto_accept` or `host_approval` — so that I gate joins when I want to.
5. As a customer, I want to browse/discover public TripGroups on `/community` filtered by destination, date window and interest, so that I can find a trip to join.
6. As a woman customer, I want a "women-verified hosts only" filter and the ability to join `public_women_only` groups, so that I can travel with a verified-female cohort safely.
7. As a customer, I want to request to join (or auto-join) a group, so that I become a member.
8. As a host, I want to approve/decline join requests (when `host_approval`), so that I curate membership.
9. As a member, I want to leave a group, so that I'm no longer part of it (and my own Bookings are unaffected by others).
10. As a host, I want to remove a member, so that I can manage the group.
11. As a member, I want to see the group's roster + roles (host vs member), so that I know who's in.
12. As a member, I want to co-edit a day-by-day itinerary of real Experiences (or free-text slots), so that we plan collaboratively.
13. As a member, I want itinerary edits to appear in near-real-time for everyone, so that co-editing doesn't clobber.
14. As a host, I want to lock the itinerary (planning → booking), so that members can book the agreed Experiences.
15. As a member, I want to book my own seat on an itinerary Experience (a normal Booking tagged with `trip_group_id`), so that my payment/refund/KYC stay mine.
16. As a member, I want to see which members have booked which itinerary slots, so that I know the group's progress.
17. As a member, I want a group chat, so that we can coordinate logistics.
18. As a member, I want the group's lifecycle state (forming/planning/booking/traveling/completed/archived) to advance as we progress, so that the surface reflects reality.
19. As a host, I want host-transfer (manual, v1), so that a group survives if I drop out.
20. As an admin, I want to see a customer's `aadhaar_gender_verified` only in admin tooling + the join-eligibility check (never leaked to other customers), so that the women-only gate works without privacy leakage.
21. As a customer, I want a group that never advances past `forming` for 30 days to be auto-archived, so that the discovery surface stays fresh.
22. As a member, I want an itinerary export (Maps/Calendar/PDF) generated on demand, so that I can use it off-platform.

## Implementation Decisions

**Schema (hand-authored migration — NEVER `drizzle-kit generate`; next free numbered `.sql` + matching `db/schema/*.ts`).** Per ADR-0009:
- `trip_groups(id, host_user_id, name, destination_slugs[], target_date_window_start, target_date_window_end, budget_range, interest_tags[], visibility, membership_rule, max_members, status, created_at, …)`
- `trip_group_members(trip_group_id, user_id, role, joined_at, …)`
- `trip_group_itinerary_slots(trip_group_id, day_offset, time_band, experience_id?, free_text?, …)`
- `bookings.trip_group_id` already exists (nullable FK) — wire it; do not re-add.
- Enums: group `visibility` (`private | public_all | public_women_only`), `membership_rule` (`auto_accept | host_approval`), group `status` (`forming | planning | booking | traveling | completed | archived`), member `role` (`host | member`).

**Deep modules (testable in isolation, stable interfaces):**
- `lib/trip-groups/group-lifecycle.ts` — the state machine (forming→planning→booking→traveling→completed→archived) with guarded transitions (min-members, host-locks-itinerary, all-bookings-complete). Pure, PGlite-testable.
- `lib/trip-groups/membership.ts` — join/leave/approve/remove + the **eligibility gate** (women-only ⇒ requires `customer_profiles.aadhaar_gender_verified = 'female'`; size cap; membership rule). Pure core.
- `lib/trip-groups/itinerary.ts` — itinerary-slot CRUD + last-write-wins conflict resolution per slot; Experience-ID grounding (a slot's `experience_id` must be a real published Experience, mirroring the ADR-0010 grounding discipline).
- `lib/trip-groups/discovery.ts` — the `/community` browse query (visibility + intent filters + women-verified-hosts filter), respecting privacy (never select gender into list output).
- `lib/trip-groups/booking-linkage.ts` — tag a member's Booking with `trip_group_id` at checkout; read per-slot booking status. Reuses the existing booking-create (does NOT book on the group's behalf — payment/refund/KYC isolation per ADR-0009).
- Real-time: `lib/pusher/*` (presence channels `presence-group-{groupId}`) IF Pusher is adopted — see OPEN DECISION 2.

**Routes:** `/community` (discovery + create), `/community/[groupId]` (detail: roster, itinerary co-edit, chat, booking progress). Auth-gated (these are customer surfaces → `(app)` group + add to `EXCLUDED_PREFIXES`, or `[locale]/(marketing)` for the public discovery list — decide per visibility/SEO).

**Booking linkage:** each member books individually; the Booking carries `trip_group_id`. One member's failed capture / dropout / refund never affects another (payment, refund, KYC, liability isolation — ADR-0009).

## Testing Decisions

Test external behavior, not implementation. Prior art: `lib/payments/commission-resolver.test.ts` + `lib/bookings/*.test.ts` (PGlite via `tests/helpers/db.ts`), and the parity-catchup loaders (`lib/blog/queries.test.ts`, `lib/wishlist/wishlist.test.ts`).
- `group-lifecycle`: every guarded transition (allowed + rejected), min-members gate, auto-archive after 30d forming.
- `membership`: women-only eligibility (female → allowed; male/unverified → rejected), size cap, `host_approval` vs `auto_accept`, leave/remove, host-transfer.
- `itinerary`: slot CRUD, last-write-wins, Experience-ID grounding (free-text vs real published `experience_id`; reject archived/missing).
- `discovery`: visibility filtering + the women-verified-hosts filter; **privacy assertion — gender never appears in list output**.
- `booking-linkage`: a member Booking is tagged with `trip_group_id`; per-member isolation (one cancel doesn't touch others).
- E2E (Playwright): create → discover → join → co-edit itinerary → book a seat → group advances; women-only join blocked for a non-female account.

## Out of Scope (per ADR-0009 "not in v1")

Cross-Vendor group discounts; group payments / split-the-bill; vendor-side "group-only" Experience SKUs; co-hosts; trans/non-binary inclusive filters (deferred to v1.x — Aadhaar is the v1 security floor); operational-transform co-editing (last-write-wins only); special encryption for women-only chats (normal channels, gated by membership).

## Further Notes — OPEN DECISIONS (HITL — resolve before `/to-issues`)

1. **ADR-0009 revisit.** The documented schema/state-machine is thorough and (recommendation) still the right design — but it was never migrated. Confirm it's still the design, or amend ADR-0009, before writing the migration.
2. **Real-time chat infra.** ADR-0009 specifies Pusher presence channels, but `lib/pusher/*` is comments-only and no Pusher account is wired. DECISION NEEDED: (a) provision Pusher now (env keys + the channel-auth route), (b) defer chat + collaborative real-time to a later slice and ship v1 with **polling / optimistic refresh** for itinerary + chat, or (c) drop chat from v1 and ship groups + itinerary + booking-linkage first. **Recommendation: (b)** — ship the group/itinerary/booking value with polling, add Pusher real-time as its own slice once an account exists. This unblocks the hero feature without an infra dependency.
3. **Women-only gate + Aadhaar.** `customer_profiles.aadhaar_gender_verified` exists (enum) but is **unused, and there is no Aadhaar eKYC integration yet**. The women-only join gate depends on a populated gender flag. DECISION NEEDED: is Aadhaar eKYC in scope for this epic, or does the gate ship "inert" (everyone is `unverified` ⇒ no one can join women-only groups until eKYC lands)? **Recommendation:** ship the visibility option + the eligibility CHECK now (it correctly blocks when `unverified`), and track Aadhaar eKYC as a separate dependency that lights up the gate — do not fake gender verification.
4. **Group lifecycle / organizer / capacity / booking linkage** — ADR-0009 resolves these (single host v1, ≤12, the 6-state machine, individual booking with `trip_group_id`). Confirm no product change.

**Proposed vertical slices (for `/to-issues`, in dependency order):** (1) hand-authored migration for the 3 tables + enums + schema files; (2) create + list/discover (`/community`) with visibility/intent filters; (3) join / leave / approve / remove + the women-only eligibility gate; (4) group detail page + roster; (5) collaborative itinerary slots (CRUD + Experience-ID grounding + last-write-wins; polling for v1 per decision 2); (6) booking linkage (`trip_group_id` at checkout + per-slot booking progress); (7) lifecycle transitions + auto-archive job; (8) [gated on decision 2] Pusher real-time presence + chat. Each slice independently testable.
