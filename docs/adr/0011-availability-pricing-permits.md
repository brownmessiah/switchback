# Availability, Pricing, and State Permits

## Context

The plan introduced monsoon-aware availability, seasonal/dynamic pricing, and state-permit gating as new capabilities without specifying any of them. These are three orthogonal dimensions of the Experience model that converge at Booking creation time — you can't price what isn't available, and you can't book what's blocked by permits. The resolution had to be coherent across all three to avoid leaving the next-engineer with three half-built systems.

## Decision

### Availability — slot-based with rule-generated materialisation

- Vendor configures **patterns** (daily 8AM/2PM, weekends only, peak-only) and **closures** (specific dates, maintenance windows).
- A background generator materialises concrete `availability_slots(experience_id, start_at, end_at, capacity, capacity_taken, status)` rows out to a rolling 6-month window.
- Bookings reference a specific slot row; capacity is decremented atomically inside the Booking-create transaction.

### Region closures as first-class

- `region_closures(region_slug, start_at, end_at, reason, source)` — calendar tied to geographic region, not individual Experiences. `source = admin` for national-level (Rishikesh rafting 1 Jul – 14 Sep); `source = vendor` for local maintenance.
- The slot generator skips dates within any active closure for an Experience's region.
- Customers see "closed for monsoon — reopens 15 Sep" inline on Experience pages within closure windows (turns the closure into trust content rather than a dead-end).

### Pricing — resolved chain at Booking-create, snapshotted

Per-participant price resolves through this precedence at Booking-create time:

1. Active pricing tier override (`pricing_tiers` table, time-windowed, festival/season-scoped)
2. Slot-specific override (admin tool, rare)
3. Experience tier-based price (group-size brackets 1-2 / 3-5 / 6+)
4. Experience base price

`bookings.price_per_participant_snapshot` and `bookings.pricing_basis_snapshot` lock the values. Never recomputed. Audit row written on resolution.

### Group-size brackets are mandatory

Every Experience defines `price_per_person_1_2`, `price_per_person_3_5`, `price_per_person_6_plus`. Flat-priced Vendors set all three identical. Bracket fires based on `participant_count` at Booking-create. Matches Indian-marketplace convention and covers ~95% of pricing models without bespoke curves.

### State permits — per-Experience requirement, not a service

- `experiences.required_permits[]` is an array of permit slugs (`ilp_sikkim`, `ilp_arunachal_pradesh`, `pap_andaman`, `wildlife_corbett`, ...).
- Booking page surfaces a Permits Required panel: plain-language description per permit, link to official application URL, mandatory acknowledgement checkbox.
- T-7d WhatsApp reminder fires for permit-required Bookings.
- **Outvers does not obtain permits on Customer's behalf in v1.** Permit-broker partnership is a v2 question.

### Permit registry as code constant

`lib/permits/registry.ts` is a hand-curated catalogue keyed by permit slug — name, issuing authority, official URL, processing time, cost range, validity duration, plain-language description. Updated by code change in v1; admin UI deferred to v2.

## Why not the alternatives

- **Per-slot manual availability entry** — Vendors will not maintain 180-day calendars by hand; rule-generated patterns + closures is the only manageable surface.
- **Experience-scoped monsoon closures** — duplicates the same closure window across N Vendors operating in the same region; inevitably goes inconsistent. Region-scoped closures are shared knowledge by definition.
- **Recomputed pricing at payment time** — same failure mode as recomputed commission; opens silent rate drift after the Customer has committed. Snapshotting is non-negotiable.
- **Arbitrary group-size price curves** — overengineered for Indian-marketplace convention. Three brackets covers the realistic distribution; bespoke curves go through admin-gated pricing tier entries.
- **Outvers-as-permit-broker** — out of scope for solo v1. The right framing is "we'll tell you exactly what permits you need and how to get them" — explicit, helpful, but not a service Outvers underwrites.

## Consequences

- The slot generator runs as a scheduled job (probably a Vercel Cron job calling a Server Action). Generates 6 months forward; re-runs nightly to extend the window.
- Capacity decrement inside the Booking-create transaction needs `SELECT ... FOR UPDATE` on the slot row to prevent two simultaneous Bookings overselling — covered by the `db.transaction` pattern in PLAN.md.
- A Booking against an Experience with `required_permits` and no acknowledgement-checkbox state is rejected at the Server Action — schema-level invariant.
- `pricing_tiers` and `commission_tiers` are parallel tables with very similar shapes. Resist the urge to merge them — they serve different roles and have different audit semantics. Document the parallelism in `db/schema/`.
- The region taxonomy (`region_slug` values) needs to be canonical and exhaustive — managed in `lib/regions/registry.ts` alongside the permit registry. Adding a region is a code change in v1.
- For permit-required Experiences booked by Customers who are Indian citizens, ILP fields can be pre-filled from Aadhaar data; for foreigners, the application is fully external. Don't assume Aadhaar is available — permit panel must work for foreign Customers too.

## Revision 2026-06-16 — selected pricing variation (issue #07)

The original Decision above stands unchanged. This revision **inserts a new top arm** into the per-participant pricing chain: a Customer-selected **pricing variation**.

### What a pricing variation is

A named, per-Experience price option (`experience_pricing_variations`: `name`, optional `description`, `price_per_person`, optional `duration_minutes`, `is_active` toggle, FK to the Experience with `ON DELETE CASCADE`). It lets a Vendor offer distinct priced options on one Experience — "Sunrise batch", "Private session", "With gear rental" — without modelling each as a separate Experience or abusing the group-size brackets.

### Amended resolution chain (precedence at Booking-create)

When a Booking is created with a valid, active `variationId` belonging to the Experience, **that variation's `price_per_person` is the per-participant price and is snapshotted**. The full precedence is now:

0. **Selected pricing variation** (`experience_pricing_variations`, when a valid active `variationId` is supplied) — **NEW, top precedence**
1. Active pricing tier override (`pricing_tiers` table, time-windowed, festival/season-scoped)
2. Slot-specific override (admin tool, rare)
3. Experience tier-based price (group-size brackets 1-2 / 3-5 / 6+)
4. Experience base price

The resolved value still writes to `bookings.price_per_participant_snapshot` + `bookings.pricing_basis_snapshot` and is **never recomputed** — a later change to the variation's `price_per_person` does not alter an existing Booking. The `pricing_basis_snapshot` records `pricing_variation:<variationId>` so the audit trail identifies exactly which variation fired.

### Capacity remains a property of the Availability slot

Variations are a **pricing** concept only. They **share the Availability slot's capacity** — a slot still holds N participants regardless of which (or no) variation is chosen. The slot generator and the atomic capacity-decrement inside the Booking-create transaction are **UNCHANGED**; the slot/capacity decision in the original Decision stands. There is no per-variation capacity.

### Determinism: an invalid `variationId` is rejected, not downgraded

A `variationId` that is unknown, belongs to a different Experience, or is inactive is **REJECTED** at Booking-create (the transaction rolls back) — it is **not** silently downgraded to the pricing-tier/bracket chain. This preserves determinism: a Customer who selected a specific priced option never silently pays a different resolved price.

### Group-size brackets still apply when no variation is selected

The group-size brackets remain **mandatory** (per the original Decision). When no `variationId` is supplied, resolution is exactly as before (pricing tier → slot override → bracket → base). Variations are additive and optional.

### Scope note

ADR-0005 (cancellation), ADR-0003 (refunds), and ADR-0006 (permissions) are **untouched** by this revision. This is purely a pricing-input addition layered on top of the existing snapshot machinery.
