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
