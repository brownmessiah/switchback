/**
 * Compact Indian-rupee formatter for chart axis ticks.
 *
 * The vendor dashboard revenue chart y-axis used a raw
 * `₹${value.toLocaleString('en-IN')}` which produced full-length strings
 * ("₹10,000") that overflowed the narrow recharts axis gutter and rendered
 * clipped/garbled ("0,000", "'7,500"). This collapses values to the Indian
 * compact scale (thousand → K, lakh → L, crore → Cr) so a tick is always a few
 * characters wide and never truncates — while keeping an unambiguous ₹ prefix.
 *
 * Pure logic, unit-tested in `format-axis-tick.test.ts`.
 */

const CRORE = 1_00_00_000
const LAKH = 1_00_000
const THOUSAND = 1_000

/**
 * Render `n` (already scaled into its unit) with at most one decimal place,
 * dropping a redundant trailing `.0` so we get "10K" not "10.0K".
 */
function trimOneDp(n: number): string {
  // toFixed(1) rounds to one decimal; Number() strips a trailing ".0".
  return String(Number(n.toFixed(1)))
}

/**
 * Format a numeric value as a compact rupee axis tick.
 * Examples: 0 → "₹0", 7500 → "₹7.5K", 1_000_000 → "₹10L", 25_000_000 → "₹2.5Cr".
 */
export function formatAxisTick(value: number): string {
  // Chart aggregates can arrive as floats; floor to whole rupees first. The
  // sign is carried out front so a negative reads "-₹2.5K", not "₹-2.5K".
  const sign = value < 0 ? '-' : ''
  const abs = Math.floor(Math.abs(value))

  let body: string
  if (abs >= CRORE) {
    body = `${trimOneDp(abs / CRORE)}Cr`
  } else if (abs >= LAKH) {
    body = `${trimOneDp(abs / LAKH)}L`
  } else if (abs >= THOUSAND) {
    body = `${trimOneDp(abs / THOUSAND)}K`
  } else {
    body = String(abs)
  }

  return `${sign}₹${body}`
}
