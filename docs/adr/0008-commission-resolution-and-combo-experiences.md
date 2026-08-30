# Commission resolution chain and Combo Experiences

## Context

The plan committed to "default 18-20% with combo/festival tiers" and "30% on combos," and the research highlights Thrillophilia's combo discovery URLs (`/tours/combo-of-rafting-paragliding`) as a meaningful revenue and SEO surface. What the plan never specified: where the commission rate actually lives (per-Vendor vs per-Experience vs per-Booking), how festival/combo tiers fire, and what a Combo *is* structurally (a first-class SKU or a runtime cart). All three answers are coupled — the same schema decisions resolve them together.

## Decision

### Commission as a resolved chain at Booking creation

The rate applied to a specific Booking is resolved in this precedence order at Booking-create time, then **snapshotted** onto the Booking row:

1. Active festival tier override (`commission_tiers` table, time-windowed, admin-controlled)
2. Per-Experience override (`experiences.commission_rate_override`, nullable)
3. Per-Vendor base rate (`vendor_profiles.commission_rate`, default 20%)
4. Platform default (constant: 20%)

First non-null wins. The Booking row stores:

- `commission_rate_snapshot` — the resolved rate
- `commission_basis_snapshot` — which layer fired (e.g. `festival_diwali_2026`, `experience_override`, `vendor_default`, `platform_default`)

Subsequent changes to Vendor rate, Experience overrides, or festival tiers never affect existing Bookings. Audit row written on every resolution.

### Combo Experience as a first-class type

A Combo is a regular row in `experiences` with `is_combo: true` and `combo_constituents` (Experience IDs array). It has its own slug, its own price (usually a bundle discount vs sum of constituents), its own JSON-LD schema, its own cancellation preset. A Booking against a Combo creates **one** Booking row referencing the Combo Experience; constituents are not separately booked. Combo availability is the intersection of constituent availability.

The "30% on combos" rate is just the default value of `commission_rate_override` when an Experience is marked as a Combo — not a separate code path.

### Festival/seasonal tiers via dedicated table

```
commission_tiers(
  id, name, start_at, end_at,
  applies_to_categories[], applies_to_vendor_ids[], applies_to_experience_ids[],
  rate_override (absolute), reason, created_by_admin_id, created_at
)
```

Empty applies-to arrays mean "all." Booking-create queries active tiers whose filters match the Experience, picks most recently created if multiple match. Every write to this table flows through the audit log.

### Snapshotting is non-negotiable

Every money-relevant value on a Booking (rate, basis, cancellation preset, capture timing) is locked at create time. This is the structural fix to the legacy app's "no transactional integrity for the money path" problem.

## Why not the alternatives

- **Per-Vendor only with no Experience overrides** — fails for Combo Experiences (need a different rate per SKU) and locks out tactical pricing.
- **Recompute commission at payout time** — opens the door to silent rate drift after the customer has paid. Disaster on refunds where the original deal needs to reverse cleanly.
- **Combo as a runtime cart of multiple Experiences** — defeats the SEO surface (no discoverable combo URL), complicates inventory (N-way intersection across separate Bookings), complicates Vendor accounting (N commission rows), complicates cancellation (which constituent's policy applies?).

## Consequences

- The Booking-create transaction must resolve the commission chain *before* writing the Booking row, in the same transaction. Resolution function lives in `lib/payments/commission-resolver.ts` with its own Vitest suite.
- `experiences.combo_constituents` is an `int[]` with a CHECK constraint that all referenced IDs exist and belong to the same Vendor (no cross-Vendor combos in v1).
- Combo cancellation: the Combo Experience has its own preset; if a Customer cancels a Combo, the Combo's preset governs — *not* a min/max across constituents.
- **GST on commission is an open question** (Switchback' commission is a service to the Vendor; GST applies; Vendor's payout = `booking_gross × (1 - commission_rate) − TDS_if_applicable`; Switchback issues a separate GST invoice). Tracked as the next money-path ADR.

## Amendment — customer checkout cart (see ADR-0021)

The rejection of **"Combo as a runtime cart of multiple Experiences"** above (under *Why not the alternatives*) is about representing a **Combo product** as a runtime basket — that remains rejected, for the reasons stated (it would defeat the discoverable combo URL, force N-way inventory intersection, N commission rows, and per-constituent cancellation ambiguity).

It does **not** rule out a customer **checkout cart**. ADR-0021 introduces a cart as a checkout convenience: each line item becomes its **own independent Booking** (its own commission/cancellation/tax snapshots, state machine, and payout) — never a Combo SKU. There is no combo URL to defeat, no N-way intersection (each item books its own slot), no shared commission row, and no cancellation ambiguity (each Booking carries its own preset). The two concepts are orthogonal; see ADR-0021 for the cart money model.
