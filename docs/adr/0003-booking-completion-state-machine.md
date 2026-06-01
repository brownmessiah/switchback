# Booking completion state machine

## Context

"Completion" of a Booking is the trigger for four downstream effects: (i) Vendor commission becomes realised revenue, (ii) the T+7 Payout countdown starts, (iii) Customer review eligibility opens (per the "delivery-confirmed reviews only" decision adapted from ToursByLocals), and (iv) the MSG91 WhatsApp post-trip review prompt fires. The plan never defined what event marks a Booking complete, even though it depends on the answer in four places.

## Decision

A Booking moves through this state machine:

```
confirmed                 (after payment success, before start_at)
  └─→ awaiting_completion (at scheduled end_at)
        ├─→ completed     (Vendor fires mark_complete after start_at, OR
        │                  auto-transition at end_at + 24h, whichever first)
        └─→ disputed      (Customer fires raise_dispute before completed)
              ├─→ completed                 (support resolves in Vendor's favour;
              │                              optional partial-refund / commission-adjust)
              └─→ cancelled_post_experience (support resolves in Customer's favour;
                                             full refund, no commission, no Payout)
```

- Auto-transition writes `auto_completed: true` on the audit row so analytics can track Vendor-attestation laziness as an SLA metric.
- `completed` is what triggers: commission realisation, Payout countdown start, review window open, WhatsApp review prompt (only if not already fired by Vendor mark_complete).
- The 24h auto-complete window is the default floor — it may need to extend for multi-day treks where Customers are offline. Revisit after launch data.

## Why

- Vendor-only attestation (option a) lets bad-faith Vendors withhold completion to delay revenue recognition or block reviews.
- Customer-only attestation (option b) fails because most Customers ghost the WhatsApp prompt.
- "Both must confirm" (option c) maximises stuck Bookings.
- Pure time-based (option d) unjustly pays Vendors when a no-show happened.
- The hybrid (this ADR) combines the responsiveness of Vendor attestation, the resilience of a time-based floor, and the safety valve of a Customer dispute window.

## Consequences

- The `bookings` table needs a `state` column and an audit trail of state transitions (timestamp, actor, reason).
- `disputed` is a real state with its own UI (Customer-facing "raise issue" flow + admin-facing resolution queue). Don't build it as a flag on `confirmed`.
- Support response-time on `disputed` Bookings is itself an SLA worth tracking — Customer trust depends on it.
- For multi-day treks where the Customer is offline, the 24h dispute window is short. Solution at this stage: Vendor mark_complete fires the WhatsApp prompt immediately but completion isn't locked until end_at + 24h, giving the Customer a window after they're back online. Revisit per-category if launch data shows a problem.

## Revision 2026-06-01 — `pending_payment` + `no_show` (issue #19)

The `booking_state` enum gains two values; `reserved` is deliberately **not** added.

### `no_show` (terminal) — IMPLEMENTED

Vendor attests a customer no-show **after the slot's `end_at`**:

```
confirmed | awaiting_completion ──→ no_show   (terminal)
```

- **Money:** no Customer refund (Customer at fault; the Vendor retains the
  payment via reconciliation). Because `no_show` sets **no `completedAt`**, it
  never enters the T+7 payout countdown (payout-cycles gates on `completedAt`),
  and it is **not** customer-refundable (refund-flow gates on `confirmed`). The
  Vendor's SLA score is **not** penalised (unlike a vendor cancellation).
- **Wiring:** `executeMarkNoShow` (lib/bookings/vendor-actions.ts) + the
  `markNoShowAction` Server Action + a vendor "Mark No-Show" button shown only
  once the slot has ended. Guarded by `isNoShowMarkableState` + a `SLOT_NOT_ENDED`
  check.

### `pending_payment` (pre-confirmation) — SCHEMA + STATE MACHINE ONLY (create-flow flip DEFERRED)

```
pending_payment ──→ confirmed                      (Razorpay capture)
                └─→ cancelled_by_customer/vendor    (dismissal / timeout sweep)
```

- **Intent:** decouple "the booking row exists" from "payment captured" — the
  proper resolution of #15's deferred requirement (charge **before** the booking
  is *confirmed*; today `createBooking` writes `confirmed` at create and #15
  gates only the confirmation *page*).
- **Money:** while `pending_payment` a booking is neither payout- nor
  refund-eligible (no captured funds); an abandoned one must auto-cancel + free
  slot capacity via a sweeper modelled on the partial-pay auto-capture cron.
- **What ships now:** the enum value, the canonical state machine
  (lib/bookings/state-machine.ts), eligibility predicates, and status-badge /
  confirmation presentation for the state (a `pending_payment` booking shows
  "Payment pending", **never** the success check).
- **What is DEFERRED (needs explicit sign-off):** flipping `createBooking` to
  write `pending_payment` and having the webhook transition it to `confirmed`.
  This **reverses the M2 "webhook is record-only, does not change booking state"
  contract** (lib/payments/razorpay-webhook.ts) — a deliberate load-bearing
  decision — and would require coordinated updates to the checkout→confirm flow,
  the slot-capacity-on-pending semantics, the abandonment sweeper, and the
  Revenue-spine E2E. Sequenced as its own change rather than folded into this
  enum addition so the shipped money path stays green.

### Why not `reserved`

`reserve_now_pay_later` is a **`payment_mode`**, not a lifecycle state. An RNPL
booking is `confirmed` (or `pending_payment` until its deferred capture). A
`reserved` state would conflate payment-mode with lifecycle and duplicate
`pending_payment`.
