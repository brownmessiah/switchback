/**
 * Money formatting for admin money queues. Integer-rupee precision (what
 * Razorpay round-trips and the GST/26Q filings carry — see
 * lib/payments/payout-calculator.ts), rendered en-IN with the ₹ glyph.
 *
 * Always paired with `.tabular-nums` at the render site (DESIGN.md §1.3 / §2.2)
 * so columns of figures align.
 */
export function formatRupees(amount: number | string): string {
  const rupees = Math.floor(Number(amount))
  return `₹${rupees.toLocaleString('en-IN')}`
}

/** Signed negative deduction line, e.g. "-₹1,000" for commission/TDS/GST/TCS. */
export function formatRupeesDeduction(amount: number | string): string {
  const rupees = Math.floor(Number(amount))
  return `-₹${rupees.toLocaleString('en-IN')}`
}
