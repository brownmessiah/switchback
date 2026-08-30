# 01 — Implement GST TCS (Section 52) collection + GSTR-8

Status: ready-for-human

## Problem

Switchback collects Customer payments on the Vendor's behalf, making it an "e-commerce operator" under CGST Act Section 52, which **must collect TCS** on the Vendor's supplies and file monthly GSTR-8. The money path did not model TCS at all.

ADR-0016 now documents the obligation (see GST TCS — Section 52).

## Implemented (2026-05-29)

- [x] TCS calculator `lib/payments/tcs-calculator.ts` — 0.5%, integer-rupee floor, `tcs_section_52` basis. Unit-tested (`tcs-calculator.test.ts`, 8 cases).
- [x] Schema: `bookings.tcs_amount_snapshot` + `bookings.tcs_rate_snapshot` (migration `0019_tcs_and_taxpayer_type.sql`), locked by the snapshot trigger (extended in the same migration) and covered by `bookings-snapshot-lock.test.ts`.
- [x] `booking-create` computes + snapshots TCS and records `tcsRupees` / `tcsRatePercent` in the audit payload (integration-tested in `booking-create.test.ts`).

## Still open (why this is ready-for-human, not done)

- [ ] **Confirm the TCS taxable base with the CA.** v1 uses `taxableValueRupees = booking gross` (the Vendor's price). The statutory base is "net taxable value of supplies" — net of GST and net of returns/cancellations. If a Vendor charges GST separately, the base should exclude it. One-line change in `booking-create.ts` (the `quoteTcs({ taxableValueRupees })` call) once confirmed.
- [ ] **Confirm 9(5) does not apply** to adventure experiences (it shouldn't — only hotel accommodation / passenger transport are notified), i.e. TCS regime applies rather than ECO discharging the Vendor's GST.
- [ ] **GSTR-8 generator** `lib/tax/tcs-returns.ts` (monthly filing) — not yet built; mirror the planned `lib/tax/tds-returns.ts`.
- [ ] Vendor monthly statement + dashboard to surface TCS separately (M3 statement work).

## References

- ADR-0016 → "GST TCS — Section 52 (e-commerce operator)" + Amendments (2026-05-29)
- `lib/payments/tcs-calculator.ts`, `lib/payments/booking-create.ts`, `db/migrations/0019_tcs_and_taxpayer_type.sql`
