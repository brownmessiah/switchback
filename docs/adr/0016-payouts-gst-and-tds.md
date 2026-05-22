# Payouts, GST on commission, and TDS

## Context

The plan committed to "T+7 typical, Bank transfer + UPI" for Vendor Payouts but never specified Dispute interaction with the Payout timer, batching strategy, or any tax treatment. Two specific Indian regulatory obligations were absent: 18% IGST on Outvers' commission to Vendors (mandatory regardless of Vendor's GSTIN status) and 1% TDS under Section 194-O on the gross value paid to resident-Indian Vendors (a real legal obligation for e-commerce operators). Getting these wrong is a tax-authority audit risk, not just a feature gap.

## Decision

### Payout timing and Dispute interaction

- **T+7 from Completion** (per ADR-0003).
- **Dispute open at T+7:** Payout held; timer pauses; resumes T+7 after Dispute resolves for Vendor, or Payout cancelled if Customer wins.
- **Dispute opened after Payout issued:** Outvers carries the refund liability (paid from the Refund balance pool). Mitigation: configurable per-category extended dispute window — T+30 for permit-required Bookings and multi-day treks, default T+7 for day trips.
- **First 3 Payouts for an Identity-verified Vendor** queued for manual admin approval; auto thereafter.

### Payout method

- UPI VPA or bank account (IMPS/NEFT), Vendor-selected at onboarding.
- Razorpay X for both rails.
- Destination changes carry a 7-day cooling-off period before the new destination receives funds.

### Batching

- Daily batches at 5pm IST, aggregating Completed Bookings whose T+7 falls on the batch day.
- Optional per-Booking instant Payout (~Rs.5 passthrough fee).

### GST on commission

- 18% IGST applied to commission, regardless of Vendor's GSTIN status.
- Invoice issued either way; GSTIN-holding Vendors can claim input credit on their own returns.
- **Vendor net = booking_gross − commission − (commission × 0.18) − TDS.**

### TDS — Section 194-O

- 1% TDS on gross Booking value to resident Indian Vendors. Calculated on gross, not net.
- Quarterly Form 26Q returns; Form 16A available to Vendors via dashboard.
- Not applicable to foreign Vendors (out of v1 scope anyway).
- Schema: `bookings.tds_amount_snapshot`, `payouts.tds_total`.

### Vendor statements

- Monthly month-end statement: gross, commission, GST, TDS, net payouts; PDF + queryable view.

### Payout failures

- 3 retries with exponential backoff, then admin queue + Vendor notification.

## Why not the alternatives

- **Auto-clawback of already-issued Payouts** — operationally messy and erodes Vendor trust. Better to extend the Customer dispute window for high-risk Bookings so disputes arrive before Payout issues.
- **Per-Booking-only Payouts (no batching)** — Razorpay X fees per transfer would compound; batching is the right default.
- **Skipping TDS deduction** — direct legal exposure under Section 194-O. Not a posture choice.
- **GST only when Vendor has GSTIN** — incorrect interpretation of the law; 18% applies regardless of Vendor's registration status. The difference is whether the Vendor can claim credit on their own return.

## Consequences

- Payouts module (M3 deliverable per the plan) must include the admin approval queue for first-3-Payouts. Without that UI, all Identity-verified Vendor Payouts block.
- Form 26Q filing is a quarterly operational task; build a generator in `lib/tax/tds-returns.ts` to emit the file in the format the Income Tax portal expects. Manual filing in v1; automation deferred.
- `bookings.tds_amount_snapshot` and `bookings.commission_rate_snapshot` are both locked at create — recomputing tax post-hoc is the same hazard as recomputing commission.
- The 7-day cooling-off on destination changes needs to be visible in the Vendor UI ("New UPI will be used from {date}"). Don't make security tradeoffs invisible.
- The extended dispute window (T+30 for treks / permit-required) needs to be communicated to Vendors at onboarding — they need to know cash flow on these Bookings is slower than day-trips.
- Monthly statement generation runs as a scheduled job (1st of each month for prior month); PDF generation via React Email or a similar templating layer.
