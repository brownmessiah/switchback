# Tax compliance gaps (money path)

Surfaced 2026-05-29 while fact-checking the operator setup checklist (`docs/ops/manual-setup-checklist.md`) against current Indian tax law. ADR-0016 was found stale/incomplete and has been corrected; the **code** still has two gaps that affect money correctness. Both are load-bearing (payouts / GST / TDS) — implement under TDD with the snapshot-at-create immutability rule.

## Background

- TDS Section 194-O rate dropped 1% → **0.1%** (Finance Act 2024, w.e.f. 1 Oct 2024). The code (`lib/payments/tds-calculator.ts`) already uses 0.1%; ADR-0016 had lagged and is now fixed.
- GST **TCS under Section 52** (0.5%, monthly GSTR-8) applies to Outvers as an e-commerce operator collecting consideration on vendors' behalf. It was absent from ADR-0016 **and** the code. ADR now documents it.
- Section 194-O has a **₹5L individual/HUF threshold exemption** the code does not apply.

## Issues

1. `issues/01-gst-tcs-section-52.md` — implement GST TCS collection + snapshot + GSTR-8 generator. **needs-info** (CA must confirm taxable base).
2. `issues/02-tds-194o-threshold-exemption.md` — apply the ₹5L individual/HUF 194-O exemption. **ready-for-agent**.

## References

- ADR-0016 (updated 2026-05-29, see its Amendments section)
- `lib/payments/tds-calculator.ts`, `lib/payments/gst-calculator.ts`, `lib/payments/booking-create.ts`
