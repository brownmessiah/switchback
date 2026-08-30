# Payouts, GST on commission, and TDS

## Context

The plan committed to "T+7 typical, Bank transfer + UPI" for Vendor Payouts but never specified Dispute interaction with the Payout timer, batching strategy, or any tax treatment. Three Indian regulatory obligations were absent: 18% IGST on Switchback' commission to Vendors (mandatory regardless of Vendor's GSTIN status), TDS under Section 194-O on the gross value paid to resident-Indian Vendors, and GST TCS under Section 52 on Vendors' supplies made through the platform — all real legal obligations for e-commerce operators. Getting these wrong is a tax-authority audit risk, not just a feature gap. (See **Amendments** at the foot of this ADR for post-decision rate corrections.)

## Decision

### Payout timing and Dispute interaction

- **T+7 from Completion** (per ADR-0003).
- **Dispute open at T+7:** Payout held; timer pauses; resumes T+7 after Dispute resolves for Vendor, or Payout cancelled if Customer wins.
- **Dispute opened after Payout issued:** Switchback carries the refund liability (paid from the Refund balance pool). Mitigation: configurable per-category extended dispute window — T+30 for permit-required Bookings and multi-day treks, default T+7 for day trips.
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
- **Vendor net = booking_gross − commission − (commission × 0.18) − TDS (194-O) − TCS (Section 52).**

### GST TCS — Section 52 (e-commerce operator)

- Switchback collects Customer payments on the Vendor's behalf, so it is an "e-commerce operator" under CGST Act Section 52 and **must collect TCS** on the Vendor's supplies made through the platform.
- **Rate: 0.5%** (0.25% CGST + 0.25% SGST intra-state, or 0.5% IGST inter-state) on the **net taxable value** of the Vendor's supply, net of returns (reduced from 1% w.e.f. 10 Jul 2024). Confirm the exact taxable base with the CA before implementation.
- **Separate from and additional to** the 18% IGST on Switchback' own commission. TCS is withheld from the Vendor's payout and deposited against the Vendor's GSTIN; the Vendor claims it as input credit on their own return.
- Adventure Experiences are **not** a Section 9(5) notified service (unlike hotel accommodation / passenger transport), so the TCS regime applies — Switchback does not discharge the Vendor's output GST itself.
- **Monthly GSTR-8** by the 10th of the following month; per-Vendor TCS statements feed the Vendor's GST credit.
- Schema: snapshot `bookings.tcs_amount_snapshot` and `bookings.tcs_rate_snapshot` at Booking-create — same immutability rule as commission/TDS.

### TDS — Section 194-O

- **0.1% TDS** on gross Booking value to resident Indian Vendors, calculated on gross not net (reduced from 1% by Finance Act 2024, w.e.f. 1 Oct 2024).
- **Threshold exemption:** no 194-O deduction for a resident **individual / HUF** Vendor whose gross supplies through the platform are ≤ ₹5,00,000 in the financial year **and** who has furnished PAN/Aadhaar. Above the threshold, deduct on the full gross.
- **Section 206AA:** if a Vendor has not furnished PAN, the statutory rate is 5% (v1 blocks Booking-create instead — see `lib/payments/tds-calculator.ts`).
- Quarterly Form 26Q returns; Form 16A available to Vendors via dashboard.
- Not applicable to foreign Vendors (out of v1 scope anyway).
- Schema: `bookings.tds_amount_snapshot`, `payouts.tds_total`.

### Vendor statements

- Monthly month-end statement: gross, commission, commission GST (18%), GST TCS (0.5%), income-tax TDS (194-O), net payout; PDF + queryable view.

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
- `bookings.tds_amount_snapshot` and `bookings.commission_rate_snapshot` are both locked at create — recomputing tax post-hoc is the same hazard as recomputing commission. `bookings.tcs_amount_snapshot` / `bookings.tcs_rate_snapshot` follow the same rule.
- **GST TCS is a monthly obligation** (GSTR-8). Build a generator (e.g. `lib/tax/tcs-returns.ts`) alongside the 26Q one. **Code gap:** `lib/payments/gst-calculator.ts` currently models only the 18% commission GST and does not compute TCS — tracked in `.scratch/tax-compliance-gaps/`.
- **Code gap:** `lib/payments/tds-calculator.ts` implements the 0.1% rate correctly but does not apply the ₹5L individual/HUF 194-O threshold exemption — it over-deducts for small individual Vendors. Tracked in `.scratch/tax-compliance-gaps/`.
- The 7-day cooling-off on destination changes needs to be visible in the Vendor UI ("New UPI will be used from {date}"). Don't make security tradeoffs invisible.
- The extended dispute window (T+30 for treks / permit-required) needs to be communicated to Vendors at onboarding — they need to know cash flow on these Bookings is slower than day-trips.
- Monthly statement generation runs as a scheduled job (1st of each month for prior month); PDF generation via React Email or a similar templating layer.

## Amendments

- **2026-05-29:** Corrected the Section 194-O TDS rate from 1% to **0.1%** (Finance Act 2024, effective 1 Oct 2024) — the code (`lib/payments/tds-calculator.ts`) already used 0.1%; this ADR had lagged. Added the **₹5L individual/HUF 194-O threshold exemption** and the **GST TCS obligation (Section 52, 0.5%, monthly GSTR-8)**, both of which the original decision and the code omitted. Open code gaps (TCS not implemented; 194-O threshold not implemented) are tracked in `.scratch/tax-compliance-gaps/`.

- **2026-06-18 — Razorpay X payout-leg implementation.** The original decision specified _timing, batching, and tax_ but left the Razorpay X wiring unspecified; the code shipped with a `TODO: Razorpay X disbursement` at `app/admin/payouts/actions.ts`. This amendment locks the implementation model (full record in `.scratch/razorpay-integration/`):
  - **Two-level model.** A **Payout** is the per-Booking owed amount (the existing `bookings.payoutState`, carrying its own net/TDS/TCS for statements + Form 26Q). A **Payout Batch** is the unit actually sent to Razorpay X: **one transfer per `(Vendor, payout destination)` per daily 5pm-IST batch**, summing the matured Payouts that share that destination. New `payouts` aggregate table (this is the `payouts.tds_total` row referenced above) + `bookings.payout_batch_id` FK.
  - **Grouping key is `(vendor, destination)`, not `(vendor)`** — because each Booking snapshots `payout_destination_snapshot` at create (the anti-takeover rule), two Bookings for one Vendor can carry different destinations and must split across transfers.
  - **Entity provisioning is eager.** One Razorpay X **Contact** per Vendor (`vendor_profiles.razorpay_contact_id`); a **Fund Account** created when a destination is set/changed (concurrent with the 7-day cooling-off), persisted with history in a new `vendor_fund_accounts` table keyed by `(vendor, destination fingerprint)`. The batch only _reads_ `fund_account_id`; a missing/legacy/cooling-off account drops the Payout to the admin queue rather than provisioning mid-money-path.
  - **At-most-once disbursement.** Unique index `payouts (vendor, destination, batch_day)` + Razorpay X `X-Payout-Idempotency` header keyed on `payouts.id` + `reference_id = payouts.id`. Safe under cron retry/overlap.
  - **Separate webhook trust boundary.** Razorpay X payout webhooks land on their own endpoint `/api/webhooks/razorpayx` with their own secret `RAZORPAYX_WEBHOOK_SECRET`, distinct from the PG webhook. `payout_state` gains `processing | paid | failed | reversed`. `payout.reversed` is admin-gated — never silently re-transferred.
  - **Hardening.** The collection-leg client's silent demo-stub fallback (`getRazorpayClient()` fabricating fake ids when creds are absent) must **throw in production** — only `RAZORPAY_TEST_MODE` (non-prod) may use the stub. New `RAZORPAYX_ACCOUNT_NUMBER` (source virtual account) is a launch-blocking ops dependency, not a build blocker (test mode covers the build).
