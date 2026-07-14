/**
 * Pure URL-param parsing helpers for /search (home-redesign issue 10).
 *
 * `parseDateParam` — the ADR-0020 date contract: UTC `YYYY-MM-DD`, strictly
 * validated (shape AND a real calendar date), past dates collapse to
 * `undefined` (a filtered view of nothing useful, not an error).
 *
 * `parseFiniteNumber` — hardening carried in from the issue-07 review: raw
 * `Number(...)` let `?groupSize=abc` reach SQL as `NaN` (a Postgres error →
 * 500 on a hand-edited URL). Junk collapses to `undefined` (unfiltered).
 */

export function parseDateParam(
  raw: string | undefined,
  todayKey: string,
): string | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined
  const [y, m, d] = raw.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d))
  const isRealDate =
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m! - 1 &&
    dt.getUTCDate() === d
  if (!isRealDate) return undefined
  // ISO date strings compare lexicographically — no Date math needed.
  if (raw < todayKey) return undefined
  // Far-horizon clamp: the UI offers 2 months and slots materialize ~90
  // days out (ADR-0020); beyond a year is always empty. It also keeps
  // extreme years ('9999-12-31') from serializing to expanded-year ISO
  // strings Postgres rejects — which would fire the DB-outage error log on
  // an attacker-repeatable URL.
  const MAX_HORIZON_MS = 366 * 24 * 60 * 60 * 1000
  if (dt.getTime() - Date.parse(`${todayKey}T00:00:00.000Z`) > MAX_HORIZON_MS) {
    return undefined
  }
  return raw
}

export function parseFiniteNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}
