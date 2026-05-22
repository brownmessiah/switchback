# Reserve Now Pay Later deferred but reserved in schema

## Context

The plan's Bookings row lists `"Reserve now, pay later"` alongside `Partial pay (25/75)` as if they were the same tile feature. They're not — at GetYourGuide / Klook, RNPL is a distinct mechanic (0% captured at booking, 100% auto-captured at T-X). Shipping all three payment modes (full-upfront, partial-pay, RNPL) at v1 launches RNPL with no historical data to calibrate no-show / failed-capture risk thresholds, which is unsafe for a marketplace that will be paying out real money to real Vendors on the back of those captures.

## Decision

- v1 ships **two payment modes**: `full_upfront` (default) and `partial_pay` (per ADR-0001).
- `reserve_now_pay_later` is **named in the schema but not implemented**. Specifically: an `experiences.payment_modes_allowed` column stores a set with the three possible values, and admin UI / Vendor onboarding gate which modes a given Experience accepts. The `reserve_now_pay_later` value is rejected by the booking flow with a "not yet available" error.
- The "Reserve now, pay later" tile badge is **removed from v1 marketing copy** — shipping the badge without the mechanic would mislead Customers about when they'll be charged.
- Reintroduce the badge and enable the mode in a v1.x release after launch data (3–6 months) gives a defensible no-show / failed-capture risk model.

## Why

Leaving a phantom enum value in the schema is exactly the kind of thing the next reader (or future-me) will either delete as dead code or try to wire up incorrectly. This ADR exists so that doesn't happen.

## Consequences

- Schema migrations that add new payment modes only need to flip an allow-list, not change the column shape.
- Vendor onboarding UI must already render all three options (with RNPL disabled and labelled "Coming soon") so the eventual launch doesn't require Vendor-side relearning.
- Tests must include a case proving that a booking attempt against an Experience flagged `reserve_now_pay_later` fails cleanly with the right error.
