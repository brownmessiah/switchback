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
