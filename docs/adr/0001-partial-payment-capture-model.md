# Partial-payment capture model

## Context

The legacy app charges 100% upfront via Razorpay (and previously Stripe). The rebuild is committed to "Partial pay (25% advance / 75% on-arrival)" because Indian competitive research (Thrillophilia, MakeMyTrip Activities, Indiahikes) shows partial-pay is becoming standard for >Rs.5K bookings and unlocks meaningful conversion on high-ticket items (multi-day treks, rafting expeditions). The plan never specified the mechanics of the 75% — and the four options (cash-on-site to vendor, stored-card auto-capture, full-escrow, pre-auth-with-split-capture) each carry wildly different audit, refund-SLA, and commission implications.

## Decision

**Default path:** 25% captured to Outvers via Razorpay at booking; the remaining 75% is auto-captured by Razorpay on a card-on-file at **T-24h**, aligned with the existing WhatsApp T-24h reminder so the customer sees the charge notification and the reminder in the same window. Outvers takes its commission on the **full booking value**, not just the advance, and pays the vendor net via the standard payout pipeline.

**Carve-outs:**

- **Bookings made <48h before the experience start:** skip partial-pay entirely and charge 100% at booking. The conversion value of partial-pay ("spread the cost over time") is irrelevant inside 48h.
- **Bookings above Rs.25,000 ticket value:** offer partial-pay as a customer choice with explicit consent at checkout; default that choice to an **escrow-flavoured 100% capture** (Outvers holds full amount, vendor paid T+7 from completion). This protects refund mechanics on the highest-stakes trips without sacrificing the partial-pay UX framing on mid-tier bookings.

**Audit:** every Razorpay capture writes an `audit_logs` row with payment ID, capture amount, and trigger source (`booking-create`, `auto-capture-t-minus-24h`, `escrow-full-capture`).

## Why not the alternatives

- **Cash/UPI direct to vendor on arrival** — keeps the legacy app's "no transactional integrity for the money path" problem, which the entire rebuild exists to fix. Outvers can't enforce a refund SLA on money it never held.
- **Full 100% capture upfront with delayed-charge UX framing** — defeats the conversion narrative (customer sees Rs.X+Y on statement, not Rs.X now). Adopted only as the carve-out above Rs.25K where escrow trust outweighs UX framing.
- **Pre-auth full amount, split capture** — pre-auth holds expire at ~7 days, which breaks for any booking made more than a week ahead (most rafting-season and trek bookings).

## Consequences

- Requires explicit "save card for T-24h auto-capture" consent in the checkout flow. This consent text needs legal review before launch.
- A failed T-24h auto-capture is now a real edge case the booking state machine must handle (retry policy, vendor-notification, customer-notification, cancel-or-downgrade-to-cash-on-arrival fallback). Specify this in the bookings state-machine spec before implementation.
- Commission-on-full-amount means the booking row stores the gross booking value at create time, not just the captured-so-far amount. Schema must reflect this.
