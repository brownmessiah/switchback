# TripGroup model: matching surface + collaborative itinerary

## Context

The plan and research identify TripGroups as the most differentiated marketplace feature ("genuinely novel; market it as hero feature") but never specify its shape. "Trip" gets used inconsistently across the plan to mean a single Booking, a TripGroup, or a multi-day itinerary. Three structural readings competed: pure group-Bookings, pure stranger-matching surface, or a multi-day collaborative itinerary entity.

## Decision

A TripGroup is a Customer-led entity that exists from "I'm thinking of going to X" through to "we finished the trip." It owns its own state, not Bookings. Each member books individually with a `trip_group_id` reference on their own Booking.

### Schema

```
trip_groups(
  id, host_user_id, name,
  destination_slugs[], target_date_window_start, target_date_window_end, budget_range,
  interest_tags[], visibility, membership_rule,
  max_members, status, created_at, ...
)

trip_group_members(
  trip_group_id, user_id, role, joined_at, ...
)

trip_group_itinerary_slots(
  trip_group_id, day_offset, time_band, experience_id?, free_text?, ...
)
```

- **Members** — 1 to N Customers. Exactly one host (the convener). One host per group for v1; host-transfer is a manual operation. Co-hosts deferred to v2.
- **Size cap** — host sets at creation; platform-enforced maximum 12. Beyond that it's a tour, not a group.
- **Visibility** — `private` (invite-only), `public_women_only`, `public_all`. Discoverable in the browse surface based on visibility + intent fields.
- **Membership rule** — `auto_accept` or `host_approval`.

### State machine

```
forming   → planning  (min members joined)
planning  → booking   (host locks itinerary)
booking   → traveling (min members complete their first-Experience Booking)
traveling → completed (all member Bookings hit Completion per ADR-0003)
          → archived  (60 days after completed, or host-initiated)
```

### Relationship to Bookings

**The group never makes a Booking on behalf of a member.** Each member books their own seat on each itinerary Experience via a regular Booking with a nullable `trip_group_id` reference. This isolates payment, refund, KYC, and liability:

- Payment isolation: one member's failed capture doesn't block the group.
- Refund isolation: a member dropout only cancels their Bookings.
- KYC: booking requires the booking member's verified identity, not the host's.
- Liability: each Customer's contract is with Outvers (and via Outvers, the Vendor), not with other group members.

### Women-verified mechanics

- A `public_women_only` TripGroup can only be joined by Customers whose User account has been Aadhaar-verified **and** the UIDAI eKYC response returned `F` (female) for the gender field.
- A separate filter on the discovery surface — "women-verified hosts only" — surfaces groups where the host is Aadhaar-verified female regardless of group visibility.
- Trans / non-binary support: out of scope for v1's women-only restriction (Aadhaar is the security floor). Trans / non-binary Customers can be supported via opt-in self-declaration alongside Aadhaar gender, surfaced via *separate* tags, in v1.x. Not a blocker for v1 launch.
- No special encryption for women-only chats — they're normal Pusher group chats with the visibility/membership rule gating who can join.

## Resolution of the "Trip" ambiguity

- **TripGroup** — the schema and code entity.
- **Trip** — customer-facing UI copy only ("your upcoming trip" = an upcoming Booking from the Customer's view). Never used in schema or domain code.
- The `/trip-planner` URL belongs to the AI itinerary builder (M4), which is a distinct product surface. Flag the name overlap in M4 review — may want to rename to `/itinerary-builder` to disambiguate.

## What's not in v1

- Cross-Vendor group discounts (use existing per-Experience pricing tiers).
- Group payments / split-the-bill (each member pays individually).
- Vendor-side "group-only" Experience SKUs.
- Co-hosts.
- Trans / non-binary inclusive filters (deferred to v1.x).

## Consequences

- The collaborative itinerary slot UI uses Pusher presence channels keyed `presence-group-{groupId}` for real-time co-editing. Conflict resolution: last-write-wins per slot (no operational-transform overhead for v1).
- Itinerary export (Google Maps / Calendar / PDF) is a derived view, not stored — generated on demand from itinerary slots + linked Experience metadata.
- A TripGroup that never advances past `forming` after 30 days is auto-archived (cleanup job in M5).
- Aadhaar gender response must be stored on the User in a way that supports the women-only filter without leaking gender to other Customers. Schema: `customer_profiles.aadhaar_gender_verified` enum (`female | male | other | unverified`). Visible only in (i) admin tooling and (ii) the join-eligibility check for women-only groups.
