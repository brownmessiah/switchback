/**
 * Unit tests for the deterministic vendor-variety helper (A1 — undifferentiated
 * vendors). The seed previously gave every Vendor Commission 20% / SLA 100% /
 * "Joined today", so the admin vendor list + analytics read as a flat test DB.
 *
 * `vendorVariety(index, count)` derives a differentiated
 * `{ commissionRate, responseTimeSlaScore, createdAt }` per Vendor:
 *   - commission rates spread across a realistic ladder (12/15/18/20/22%),
 *   - SLA / trust scores spread (not all 100%),
 *   - join dates staggered historically over roughly the last 12 months
 *     (so the admin "Vendor growth (monthly)" chart has a real shape).
 *
 * Pure + deterministic so the same Vendor index always yields the same row
 * across reseeds (idempotent seed contract).
 */
import { describe, expect, it } from 'vitest'

import { COMMISSION_RATE_LADDER, vendorVariety } from './seed-vendor-variety'

describe('vendorVariety — deterministic per-vendor differentiation (A1)', () => {
  const NOW = new Date('2026-06-04T00:00:00.000Z')

  it('is deterministic — same index yields the same row', () => {
    const a = vendorVariety(3, 12, NOW)
    const b = vendorVariety(3, 12, NOW)
    expect(a).toEqual(b)
  })

  it('draws commission rates from the realistic ladder, not a flat 20%', () => {
    const count = 12
    const rates = new Set(
      Array.from({ length: count }, (_, i) => vendorVariety(i, count, NOW).commissionRate),
    )
    // Every rate must be a member of the ladder.
    for (const r of rates) expect(COMMISSION_RATE_LADDER).toContain(r)
    // At least three DISTINCT commission rates across the vendor set so the
    // admin commission view is no longer "20% everywhere".
    expect(rates.size).toBeGreaterThanOrEqual(3)
  })

  it('produces commission-rate numerics with 2-dp scale (numeric(5,2))', () => {
    for (let i = 0; i < 12; i++) {
      expect(vendorVariety(i, 12, NOW).commissionRate).toMatch(/^\d+\.\d{2}$/)
    }
  })

  it('spreads SLA / trust scores instead of a flat 100%', () => {
    const count = 12
    const scores = new Set(
      Array.from({ length: count }, (_, i) => vendorVariety(i, count, NOW).responseTimeSlaScore),
    )
    expect(scores.size).toBeGreaterThanOrEqual(3)
    for (const s of scores) {
      expect(s).toMatch(/^\d+\.\d{2}$/)
      const n = Number(s)
      // Realistic SLA band: high but not uniformly perfect.
      expect(n).toBeGreaterThanOrEqual(60)
      expect(n).toBeLessThanOrEqual(100)
    }
    // Not EVERY vendor is a perfect 100.00.
    expect([...scores].some((s) => Number(s) < 100)).toBe(true)
  })

  it('staggers join dates historically across roughly the last 12 months', () => {
    const count = 12
    const dates = Array.from({ length: count }, (_, i) => vendorVariety(i, count, NOW).createdAt)
    // Every join date is in the PAST (never "joined today/future").
    for (const d of dates) expect(d.getTime()).toBeLessThan(NOW.getTime())
    // Spread spans many distinct months (a real growth curve, not one spike).
    const months = new Set(dates.map((d) => `${d.getUTCFullYear()}-${d.getUTCMonth()}`))
    expect(months.size).toBeGreaterThanOrEqual(6)
    // The oldest join is at least ~10 months back so the 12-month chart window
    // is genuinely populated, and none is older than ~13 months.
    const oldest = Math.min(...dates.map((d) => d.getTime()))
    const tenMonthsMs = 305 * 86400 * 1000
    const thirteenMonthsMs = 400 * 86400 * 1000
    expect(NOW.getTime() - oldest).toBeGreaterThanOrEqual(tenMonthsMs)
    expect(NOW.getTime() - oldest).toBeLessThanOrEqual(thirteenMonthsMs)
  })

  it('defaults the reference date to now when omitted', () => {
    const before = Date.now()
    const row = vendorVariety(0, 12)
    const after = Date.now()
    expect(row.createdAt.getTime()).toBeLessThanOrEqual(after)
    // Index 0 should be the OLDEST (joined first) — comfortably in the past.
    expect(row.createdAt.getTime()).toBeLessThan(before)
  })
})
