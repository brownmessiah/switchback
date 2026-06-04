/**
 * Deterministic per-Vendor differentiation for the demo seed (A1 fix —
 * "undifferentiated vendors"). The seed previously left every Vendor on the
 * schema defaults (Commission 20.00% / SLA 100.00% / created_at = now()), so
 * the admin vendor list and the analytics "Vendor growth" chart read as a flat
 * test DB.
 *
 * `vendorVariety(index, count, now?)` derives a stable, differentiated row per
 * Vendor index:
 *   - commissionRate        — cycled through a realistic ladder (12/15/18/20/22%)
 *   - responseTimeSlaScore  — spread across a high-but-imperfect band
 *   - createdAt             — staggered historically so index 0 is the OLDEST
 *                             join and the newest is ~3 weeks back, spanning
 *                             roughly the last 12 months (a real growth curve)
 *
 * Pure + deterministic: the same `(index, count)` always yields the same row,
 * so the idempotent seed produces identical data across reseeds.
 *
 * Used for every demo Vendor pool — the three canonical seed Vendors
 * (db/seed.ts), the catalog Vendors (db/seed-extras.ts), and the dev demo
 * catalog Vendors (db/seed-demo-catalog.ts) — so no surface shows uniform rows.
 */

/** The realistic commission-rate ladder, as numeric(5,2) strings. */
export const COMMISSION_RATE_LADDER = ['12.00', '15.00', '18.00', '20.00', '22.00'] as const

/** SLA / trust-score band, as numeric(5,2) strings (high but not all perfect). */
const SLA_SCORE_LADDER = ['100.00', '98.50', '96.00', '92.50', '88.00', '83.00', '74.00'] as const

/** Oldest demo Vendor joined ~12 months back; newest ~3 weeks back. */
const OLDEST_JOIN_DAYS = 360
const NEWEST_JOIN_DAYS = 21
const DAY_MS = 86_400_000

export interface VendorVarietyRow {
  /** numeric(5,2) commission base rate, e.g. "15.00". */
  readonly commissionRate: string
  /** numeric(5,2) response-time SLA score, e.g. "92.50". */
  readonly responseTimeSlaScore: string
  /** Historical join timestamp (always in the past). */
  readonly createdAt: Date
}

/**
 * Derive a differentiated row for the Vendor at `index` within a pool of
 * `count` Vendors. `now` is injectable for deterministic tests.
 */
export function vendorVariety(index: number, count: number, now: Date = new Date()): VendorVarietyRow {
  const safeCount = Math.max(count, 1)
  const i = ((index % safeCount) + safeCount) % safeCount

  const commissionRate = COMMISSION_RATE_LADDER[i % COMMISSION_RATE_LADDER.length]
  // Offset the SLA cycle from the commission cycle so a Vendor's two metrics
  // don't move in lockstep (more "real" — a cheap-commission Vendor isn't
  // automatically the best responder).
  const responseTimeSlaScore = SLA_SCORE_LADDER[(i + 2) % SLA_SCORE_LADDER.length]

  // Spread join dates linearly from OLDEST (index 0) to NEWEST (index count-1)
  // so a 12-vendor pool lands roughly one join per ~30 days — a populated
  // 12-month growth curve. Single-vendor pools fall back to the oldest date.
  const span = OLDEST_JOIN_DAYS - NEWEST_JOIN_DAYS
  const step = safeCount > 1 ? span / (safeCount - 1) : 0
  const daysAgo = OLDEST_JOIN_DAYS - Math.round(step * i)
  const createdAt = new Date(now.getTime() - daysAgo * DAY_MS)

  return { commissionRate, responseTimeSlaScore, createdAt }
}
