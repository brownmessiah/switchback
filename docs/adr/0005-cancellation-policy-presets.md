# Cancellation policy as named presets

## Context

Indian-incumbent research identifies "refund-policy transparency + SLA-backed wallet refunds" as the single biggest competitive wedge — Thrillophilia's customer-complaint pattern is *ambiguity*, not stinginess. Indiahikes turned their cancellation policy into a blog post. The wedge is being clear and predictable. The plan committed to the SLA-backed refund half but never specified the policy model itself, so the question of *what amount is owed and when* was undefined.

## Decision

Per-Experience cancellation policy via three named presets plus an admin-gated Custom option:

| Preset | Free cancel up to | 50% refund up to | After that |
|---|---|---|---|
| **Flexible** | T-24h | T-2h | No refund |
| **Moderate** | T-72h | T-24h | No refund |
| **Strict** | T-14d | T-7d | No refund |

Custom requires admin approval at Experience-creation time and writes the reason to `audit_logs`. Reserved for high-altitude expeditions with non-refundable permit fees, festival-day-only experiences, and similar bespoke cases.

Rules:

- Plain-language policy renders identically on every Experience card, the booking-confirmation email, the WhatsApp confirmation, and the Booking detail page — sourced from one constant per preset.
- Refund math is a **pure function** of `(preset, cancellation_timestamp, booking_total)`. No service call, no human review inside the policy window.
- **Inside-policy cancellation** → refund auto-credited to the Customer's Refund balance within minutes, Vendor commission row reversed in the same database transaction.
- **Outside-policy cancellation** → routes to support as a Dispute (per ADR-0003). Resolution at admin discretion; declined by default except in clear vendor-fault cases.
- **Vendor-cancelled Bookings** always full-refund regardless of preset; the Vendor's response-time SLA score takes a hit.
- The preset on a Booking is **locked at Booking creation time**. Changing an Experience's preset only affects future Bookings.
- Build a `/cancellation-policy` page that explains all three presets with examples; link to it from every Experience card (Indiahikes pattern — policy as content/SEO).

## Why not the alternatives

- **Single platform-wide policy** — bankrupts multi-day-trek Vendors (T-24h free cancel is impossible when permits/guides commit months ahead) or makes day trips punitively strict.
- **Per-Vendor uniform policy** — wrong granularity: a Vendor selling both a day rafting trip and a 7-day Garhwal trek needs different policies per Experience.
- **Per-Experience free-for-all** — snowflakes destroy transparency, which is the entire competitive wedge.

## Consequences

- Schema: `experiences.cancellation_preset` is an enum (`flexible | moderate | strict | custom`); a `cancellation_policy_text` field stores the plain-language string for Custom only (presets use a constant).
- `bookings.cancellation_preset_snapshot` stores the preset value at Booking-creation time so historical refund math doesn't break when an Experience's preset is changed.
- Refund-calculation function lives in `lib/payments/refund-policy.ts` as a pure function and has its own Vitest suite — this is load-bearing logic where a 1-line bug = real money lost.
- The `/cancellation-policy` SEO page is built in M2 alongside the money path, not deferred — it's part of the trust wedge.

## Revision 2026-06-16 — non_cancellable preset + reschedule_allowed (issue #09)

The hybrid cancellation model adds **exactly two** things to the original Decision — a fourth preset and a boolean flag — and **nothing else**. The original three presets (Flexible / Moderate / Strict) keep their exact refund math and plain-language constants untouched.

### `non_cancellable` preset

A fourth value joins the `cancellation_preset` enum: `non_cancellable`. Its refund function **always returns 0 in every window** — there is no free window, no 50% window, no timing that yields any refund. It is the strict end-stop of the preset spectrum, for fixed-cost commitments (non-refundable permit fees, charter slots, festival-day-only departures) where the original `strict` preset's T-14d free window is still too generous.

A cancellation attempt on a `non_cancellable` Booking behaves like an **OUTSIDE-POLICY case** (the same class as a post-`start_at` cancellation): it routes to support as a **Dispute per ADR-0003**, where Outvers may still grant an exceptional refund at admin discretion (declined by default except in clear vendor-fault cases). The refund function returns `basis: 'non_cancellable'` (a distinct basis value, for audit clarity) with `routesToDispute: true` and the full booking total held as the cancellation fee.

The **Vendor-cancelled invariant is unchanged**: a `non_cancellable` Booking that the *Vendor* cancels is still full-refunded (the `vendorCancelled` branch wins before the preset is consulted), and the Vendor's SLA score still takes the hit. `non_cancellable` only governs Customer-initiated cancellations.

### `reschedule_allowed` flag

Experiences gain a `reschedule_allowed` boolean (PRD default: **ON / `true`**). It is **snapshotted onto the Booking at create** (`bookings.reschedule_allowed_snapshot`), so — like the preset — a later change to the Experience never alters the rights of an already-created Booking. The flag is a property *carried alongside* the refund math, not an input to it: the pure `quoteRefund` echoes it on the `RefundQuote` (defaulting `false` when not supplied) so the cancellation UI / Booking-detail surface (issue #10) can read "reschedule allowed" from the same single source as the refund figure. Reschedule itself (re-binding a Booking to a new slot) is a separate flow; this revision only establishes the per-Experience right and its Booking snapshot.

### Preset-transparency wedge is PRESERVED

This is the load-bearing constraint. The hybrid adds **only** `non_cancellable` + `reschedule_allowed`. There are **NO per-Experience free-form refund numbers** — a Vendor still cannot type a bespoke "40% up to T-5d" refund schedule. Every Experience's refund behaviour is still fully described by one of four named presets, each rendered from a single plain-language constant per preset (the "policy as content" wedge from the original Decision). The snowflake-destroying-transparency rejection under "Why not the alternatives" still stands; `non_cancellable` is a fourth *named, constant-driven* preset, not a free-for-all.

### Untouched

- **ADR-0011** (availability / pricing), **ADR-0003** (Dispute queue / Booking state machine — the `non_cancellable` route reuses the existing outside-policy → Dispute path), and **ADR-0006** (permissions) are not modified by this revision.
- The three existing presets' refund math + plain-language constants are byte-identical.
