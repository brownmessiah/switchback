# 02 — Apply the ₹5L individual/HUF 194-O threshold exemption

Status: ready-for-human

## Problem

`lib/payments/tds-calculator.ts` deducted 0.1% TDS on **every** resident-Vendor Booking. Section 194-O(2) exempts a resident **individual / HUF** participant whose gross supplies through the platform are **≤ ₹5,00,000 in the FY** (PAN/Aadhaar furnished). The code over-deducted for small individual Vendors.

ADR-0016 now documents the exemption (see TDS — Section 194-O).

## Implemented (2026-05-29)

- [x] `quoteTds` takes `vendorTaxpayerType` + `vendorFyGrossRupees`; returns 0 TDS with basis `section_194o_below_threshold` for individual/HUF ≤ ₹5L (PAN required, checked first). Backward compatible — omitting the args deducts as before. Unit-tested (8 new cases in `tds-calculator.test.ts`).
- [x] Schema: `vendor_profiles.taxpayer_type` enum (`individual|huf|company|firm|other`, nullable) — migration `0019`.
- [x] `booking-create` reads `vendor.taxpayerType` and, only for individual/HUF, computes the FY-cumulative gross (prior FY bookings + this one) via a joined SUM and passes it to `quoteTds`. Integration-tested: exemption under ₹5L, accumulation crossing ₹5L across two bookings, company-not-exempt.

## Still open (why this is ready-for-human, not done)

- [ ] **Confirm the FY-gross state-set with the CA.** v1 counts **all** of the Vendor's bookings in the FY regardless of state (the conservative read — favours deducting). If cancelled/refunded bookings should be excluded from "turnover," adjust the WHERE clause in `booking-create.ts`.
- [ ] **Confirm the crossing rule:** v1 deducts on the full gross of every Booking from the one that crosses ₹5L onward (conservative). Confirm vs deduct-only-on-excess.
- [ ] **FY boundary:** v1 uses 1 April 00:00 **UTC** (`indianFinancialYearStartUtc`). Switch to IST if the ~5.5h boundary window matters.
- [ ] Vendor onboarding UI must capture `taxpayer_type` (else NULL → no exemption → conservative deduct, which is safe but denies relief to small individual Vendors).

## References

- ADR-0016 → "TDS — Section 194-O" + Amendments (2026-05-29)
- `lib/payments/tds-calculator.ts`, `lib/payments/booking-create.ts`, `db/schema/vendor-profiles.ts`
