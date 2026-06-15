import { and, count, eq, gte, inArray, lt, lte, sql, sum } from 'drizzle-orm'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'

import { type DayDataPoint, fillDays } from './dashboard-loader'

/**
 * Headline analytics figures for the Vendor Analytics surface.
 *
 * Kept minimal on purpose — issues 02/03 extend this interface with trended
 * Key Metrics and breakdowns. For now it carries only the two headline KPIs
 * plus an explicit "no data" signal so the page can render an honest empty
 * state instead of a fabricated value.
 *
 * `totalRevenue` is GROSS Vendor-attributable Booking value (before
 * Commission / GST / TDS / TCS — those deductions live on the Payouts ledger
 * per ADR-0016). It is computed IDENTICALLY to the dashboard loader's
 * `totalRevenue`, so the two surfaces never disagree on the headline number.
 */
export interface VendorAnalyticsData {
  readonly totalRevenue: number
  readonly totalBookings: number
  /** True iff the Vendor has at least one Booking. */
  readonly hasData: boolean
  /** Trended Key Metrics grid (issue 02), all derived from real Bookings. */
  readonly keyMetrics: VendorKeyMetrics
  /**
   * Charts + breakdowns (issue 03), all derived from real Bookings — GROSS
   * revenue (ADR-0016), no fabricated rows.
   *
   *  - `revenueByDay`   — gross revenue per day over the last 30 days, FILLED so
   *                       every day appears (0 for gaps). Sums to the same gross
   *                       as `keyMetrics.last30Revenue`.
   *  - `revenueByMonth` — gross revenue per month over a rolling 12 months,
   *                       FILLED (0 for empty months), chronological. Each point
   *                       is a `YYYY-MM-01` DayDataPoint for the reused chart.
   *  - `bookingStatusBreakdown` — Booking counts grouped by state; only states
   *                       that actually occur (≥1 Booking) are emitted.
   *  - `revenueByExperience`    — per-Experience Booking count + gross revenue,
   *                       ordered by revenue desc. Experiences with no Bookings
   *                       are omitted (the join is inner — honest, no 0/0 noise).
   */
  readonly revenueByDay: readonly DayDataPoint[]
  readonly revenueByMonth: readonly DayDataPoint[]
  readonly bookingStatusBreakdown: readonly BookingStatusCount[]
  readonly revenueByExperience: readonly ExperienceRevenue[]
}

/** One Booking-state bucket for the status breakdown (only occurring states). */
export interface BookingStatusCount {
  readonly state: string
  readonly count: number
}

/** One Experience's Booking count + gross revenue for the by-Experience list. */
export interface ExperienceRevenue {
  readonly experienceId: string
  readonly title: string
  readonly bookings: number
  readonly revenue: number
}

/** Raw all-time aggregate row feeding the headline KPIs. The `count()` may be
 *  null and `SUM()` may be null when the join returns no rows — the shaper
 *  applies the safe fallbacks in one place. */
interface RawAnalyticsStats {
  allTimeStats?: { total?: number | null; revenue?: string | number | null }
}

/**
 * Apply the defensive fallbacks and derive the headline analytics shape.
 *
 * Exported as a PURE function so the zero/empty path (a brand-new Vendor with
 * no Bookings, or a driver surfacing null from SUM()/COUNT()) is unit-testable
 * without a DB. Revenue is floored to integer rupees and treated as GROSS —
 * no Commission/GST/TDS/TCS re-derivation. `hasData` is true iff there is at
 * least one Booking.
 */
export function shapeAnalytics(raw: RawAnalyticsStats): VendorAnalyticsHeadline {
  const { allTimeStats } = raw
  const totalBookings = allTimeStats?.total ?? 0
  const totalRevenue = Math.floor(Number(allTimeStats?.revenue ?? 0))
  return {
    totalBookings,
    totalRevenue,
    hasData: totalBookings > 0,
  }
}

/** The three headline figures shared with the page's KPI row + empty-state gate.
 *  Picked from the full data shape so the headline shaper stays narrowly typed
 *  even as #02/#03 add Key Metrics + charts/breakdowns to VendorAnalyticsData. */
type VendorAnalyticsHeadline = Pick<
  VendorAnalyticsData,
  'totalRevenue' | 'totalBookings' | 'hasData'
>

// ─────────────────────────────────────────────────────────────────────────
// Trended Key Metrics (issue 02)
//
// Every figure below is derived from REAL Bookings — no ML, no fabrication.
// Revenue is GROSS everywhere (ADR-0016): we never re-derive commission / GST /
// TDS / TCS and never surface a "net" or "you keep X%" figure here.
// ─────────────────────────────────────────────────────────────────────────

/** Window length (days) for the trended Last-30-days metrics. */
export const WINDOW_DAYS = 30
/** Window length (days) for the Upcoming / New-bookings metrics. */
export const SHORT_WINDOW_DAYS = 7
/** Window length (months) for the Monthly Revenue chart (rolling 12 months). */
export const MONTHS_WINDOW = 12

/**
 * Fill a month range with data points, inserting 0 for months with no rows.
 *
 * The month analogue of `fillDays` for the Monthly Revenue chart: each emitted
 * point is the FIRST DAY of its month (`YYYY-MM-01`) so it slots straight into
 * the reused `TrendChart` (which expects `DayDataPoint`), and every month in
 * `[from, to]` materialises chronologically — months with no Bookings show as 0
 * rather than disappearing. Raw rows key their month as `YYYY-MM`; a null/absent
 * aggregate coerces to 0 (never NaN). Pure + exported for direct unit testing.
 */
export function fillMonths(
  from: Date,
  to: Date,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawData: readonly Record<string, any>[],
  valueKey: string,
): DayDataPoint[] {
  const dataMap = new Map<string, number>()
  for (const row of rawData) {
    const monthKey = String(row.month)
    dataMap.set(monthKey, Math.floor(Number(row[valueKey] ?? 0)))
  }

  const result: DayDataPoint[] = []
  // Walk month-by-month at UTC noon so a DST/timezone shift can never roll the
  // cursor back into the previous month and duplicate/skip a point.
  const current = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1, 12),
  )
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1, 12))
  while (current <= end) {
    const y = current.getUTCFullYear()
    const m = String(current.getUTCMonth() + 1).padStart(2, '0')
    result.push({ date: `${y}-${m}-01`, value: dataMap.get(`${y}-${m}`) ?? 0 })
    current.setUTCMonth(current.getUTCMonth() + 1)
  }
  return result
}

/**
 * Booking states that count as a cancellation for the Cancellation Rate.
 *
 * The three `cancelled_*` states ONLY. `no_show` is deliberately EXCLUDED — a
 * Vendor-attested customer no-show is not a cancellation (the slot was held and
 * the customer simply failed to show), so folding it in would overstate the
 * rate (ADR-0003).
 */
export const CANCELLED_STATES = [
  'cancelled_by_customer',
  'cancelled_by_vendor',
  'cancelled_post_experience',
] as const

/**
 * Honest period-over-period delta.
 *
 * Returns `{ percentChange: null, hasPrior: false }` when the prior window had
 * NO data — we refuse to fabricate a "+100%" out of a zero base. Otherwise the
 * percent change is `((current - prior) / prior) * 100` and `hasPrior` is true.
 * Pure + exported so the zero-base honesty path is unit-tested without a DB.
 */
export function computePercentChange(
  current: number,
  prior: number,
): { percentChange: number | null; hasPrior: boolean } {
  if (prior === 0) {
    return { percentChange: null, hasPrior: false }
  }
  return { percentChange: ((current - prior) / prior) * 100, hasPrior: true }
}

/**
 * Average of a total over a count, floored to integer rupees. Returns 0 when
 * the count is 0 — no divide-by-zero, no NaN. Pure + exported for testing.
 */
export function computeAverage(total: number, count: number): number {
  if (count === 0) return 0
  return Math.floor(total / count)
}

/**
 * A numerator/denominator ratio expressed as a percentage. Returns 0 when the
 * denominator is 0 — no divide-by-zero, no NaN. Pure + exported for testing.
 */
export function computeRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return (numerator / denominator) * 100
}

/**
 * Full trended Key Metrics shape rendered as the Analytics metric-card grid.
 *
 * `last30RevenueChange` / `last30BookingsChange` are `null` (and
 * `hasPriorPeriod` is false) when the prior 30-day window was empty — the page
 * MUST render a neutral "no prior-period data" hint rather than a fake percent.
 */
export interface VendorKeyMetrics {
  /** Gross Booking revenue confirmed in the last 30 days. */
  readonly last30Revenue: number
  /** Booking count confirmed in the last 30 days. */
  readonly last30Bookings: number
  /** Percent change in revenue vs the prior 30-day window, or null if no prior data. */
  readonly last30RevenueChange: number | null
  /** Percent change in bookings vs the prior 30-day window, or null if no prior data. */
  readonly last30BookingsChange: number | null
  /** True iff the prior 30-day window had at least one Booking to compare against. */
  readonly hasPriorPeriod: boolean
  /** All-time average gross value per Booking, floored to integer rupees. */
  readonly avgBookingValue: number
  /** Confirmed Bookings whose slot starts within the next 7 days. */
  readonly upcoming7Confirmed: number
  /** Bookings confirmed in the last 7 days. */
  readonly newBookings7: number
  /** Cancellation rate (%) = cancelled Bookings / all-time Bookings. */
  readonly cancellationRate: number
  /** Count of Customers with more than one Booking with this Vendor. */
  readonly repeatCustomers: number
}

/** Raw aggregate rows feeding the Key Metrics shaper. Any may be missing when a
 *  query returns no row, and numeric aggregates may be null — the shaper applies
 *  the safe fallbacks in one place. */
interface RawKeyMetrics {
  /** Last-30-day window (by confirmedAt). */
  current30?: { total?: number | null; revenue?: string | number | null }
  /** Prior-30-day window (by confirmedAt). */
  prior30?: { total?: number | null; revenue?: string | number | null }
  /** All-time totals from the headline (#01) — keeps the average consistent. */
  totalRevenue: number
  totalBookings: number
  /** Confirmed Bookings with slots in the next 7 days. */
  upcoming7?: { total?: number | null }
  /** Bookings confirmed in the last 7 days. */
  new7?: { total?: number | null }
  /** All-time cancelled Bookings (the three cancelled_* states). */
  cancelled?: { total?: number | null }
  /** Count of distinct Customers with > 1 Booking. */
  repeatCustomers?: number | null
}

/**
 * Apply the defensive fallbacks and derive the trended Key Metrics shape.
 *
 * Exported as a PURE function so every zero-base path (a brand-new Vendor, a
 * null SUM()/COUNT(), an empty prior window) is unit-testable without a DB.
 * Revenue is floored to integer rupees and treated as GROSS. The prior-period
 * deltas are computed via `computePercentChange`, which yields `null` (no fake
 * "+100%") whenever the prior window was empty.
 */
export function shapeKeyMetrics(raw: RawKeyMetrics): VendorKeyMetrics {
  const last30Revenue = Math.floor(Number(raw.current30?.revenue ?? 0))
  const last30Bookings = raw.current30?.total ?? 0
  const prior30Revenue = Math.floor(Number(raw.prior30?.revenue ?? 0))
  const prior30Bookings = raw.prior30?.total ?? 0

  const revenueDelta = computePercentChange(last30Revenue, prior30Revenue)
  const bookingsDelta = computePercentChange(last30Bookings, prior30Bookings)
  // The prior period has data when EITHER prior figure is non-zero. We key the
  // shared "no comparison" hint off bookings, the primary count.
  const hasPriorPeriod = bookingsDelta.hasPrior

  return {
    last30Revenue,
    last30Bookings,
    last30RevenueChange: revenueDelta.percentChange,
    last30BookingsChange: bookingsDelta.percentChange,
    hasPriorPeriod,
    avgBookingValue: computeAverage(raw.totalRevenue, raw.totalBookings),
    upcoming7Confirmed: raw.upcoming7?.total ?? 0,
    newBookings7: raw.new7?.total ?? 0,
    cancellationRate: computeRate(raw.cancelled?.total ?? 0, raw.totalBookings),
    repeatCustomers: raw.repeatCustomers ?? 0,
  }
}

/**
 * Load the Vendor Analytics headline figures in a single call.
 *
 * Accepts a Drizzle DB handle so tests can pass PGlite (matches the dashboard
 * loader). Total Revenue and Total Bookings are computed over
 * `bookings INNER JOIN experiences` scoped to the Vendor — the same join and
 * the same gross-sum the dashboard uses for its headline numbers.
 */
export async function loadVendorAnalytics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  vendorUserId: string,
): Promise<VendorAnalyticsData> {
  const now = new Date()
  const last30Start = new Date(now)
  last30Start.setDate(last30Start.getDate() - WINDOW_DAYS)
  const prior60Start = new Date(now)
  prior60Start.setDate(prior60Start.getDate() - WINDOW_DAYS * 2)
  const last7Start = new Date(now)
  last7Start.setDate(last7Start.getDate() - SHORT_WINDOW_DAYS)
  const next7End = new Date(now)
  next7End.setDate(next7End.getDate() + SHORT_WINDOW_DAYS)
  // Day floor for the revenue-by-day fill (matches the dashboard's todayStart so
  // the series carries exactly 31 points: 30 days back + today).
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayTrendStart = new Date(todayStart)
  dayTrendStart.setDate(dayTrendStart.getDate() - WINDOW_DAYS)
  // Rolling 12-month window for the monthly series: first day (UTC) of the month
  // that is (MONTHS_WINDOW − 1) months before this month, through today. Built in
  // UTC so it lines up exactly with fillMonths' UTC month-walk (a local-midnight
  // first-of-month would land on the prior day in a +UTC offset and emit 13).
  const monthsStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_WINDOW - 1), 1, 12),
  )

  // All-time headline totals — identical join + gross-sum as #01 / the dashboard.
  const [allTimeStats] = await db
    .select({
      total: count(),
      revenue: sum(bookings.grossTotalSnapshot),
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(eq(experiences.vendorUserId, vendorUserId))

  // Last-30-day window, BY confirmedAt. confirmedAt defaults to now() at create,
  // so it is the Booking's creation-style timestamp and the same field the
  // dashboard windows its trend on — the two surfaces stay consistent.
  const [current30] = await db
    .select({
      total: count(),
      revenue: sum(bookings.grossTotalSnapshot),
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        gte(bookings.confirmedAt, last30Start),
        lte(bookings.confirmedAt, now),
      ),
    )

  // Prior-30-day window [now-60d, now-30d) — the comparison baseline.
  const [prior30] = await db
    .select({
      total: count(),
      revenue: sum(bookings.grossTotalSnapshot),
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        gte(bookings.confirmedAt, prior60Start),
        lt(bookings.confirmedAt, last30Start),
      ),
    )

  // Upcoming 7 days: CONFIRMED Bookings whose slot starts within [now, now+7d].
  // Joined to availability_slots like the dashboard's pendingBookings query.
  const [upcoming7] = await db
    .select({ total: count() })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        eq(bookings.state, 'confirmed'),
        gte(availabilitySlots.startAt, now),
        lte(availabilitySlots.startAt, next7End),
      ),
    )

  // New Bookings: confirmed in the last 7 days (by confirmedAt — consistent
  // with the dashboard's "today's bookings" which also windows on confirmedAt).
  const [new7] = await db
    .select({ total: count() })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        gte(bookings.confirmedAt, last7Start),
        lte(bookings.confirmedAt, now),
      ),
    )

  // Cancellations: the three cancelled_* states only (no_show is NOT a
  // cancellation — see CANCELLED_STATES). Denominator is all-time totalBookings.
  const [cancelled] = await db
    .select({ total: count() })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        inArray(bookings.state, [...CANCELLED_STATES]),
      ),
    )

  // Repeat Customers: distinct Customers (for this Vendor's Bookings) with more
  // than one Booking. Grouped subquery → count the groups whose count > 1.
  const repeatRows = await db
    .select({ customerUserId: bookings.customerUserId, c: count() })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(eq(experiences.vendorUserId, vendorUserId))
    .groupBy(bookings.customerUserId)
    .having(sql`count(*) > 1`)
  const repeatCustomers = repeatRows.length

  // ── Charts + breakdowns (issue 03) — READ-ONLY GROSS aggregates ──

  // Revenue by day (last 30 days), grouped by date(confirmedAt). Filled below so
  // every day in the window materialises (0 for gaps) — same window + field as
  // #02's last30Revenue, so the series sums to that metric (internal consistency).
  const revenueByDayRaw = await db
    .select({
      date: sql<string>`date(${bookings.confirmedAt})`.as('date'),
      total: sum(bookings.grossTotalSnapshot),
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        gte(bookings.confirmedAt, last30Start),
        lte(bookings.confirmedAt, now),
      ),
    )
    .groupBy(sql`date(${bookings.confirmedAt})`)
    .orderBy(sql`date(${bookings.confirmedAt})`)

  // Revenue by month over the rolling 12-month window, grouped by month of
  // confirmedAt (rendered as `YYYY-MM`). Filled below so every month appears.
  const revenueByMonthRaw = await db
    .select({
      month: sql<string>`to_char(${bookings.confirmedAt}, 'YYYY-MM')`.as('month'),
      total: sum(bookings.grossTotalSnapshot),
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        gte(bookings.confirmedAt, monthsStart),
        lte(bookings.confirmedAt, now),
      ),
    )
    .groupBy(sql`to_char(${bookings.confirmedAt}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${bookings.confirmedAt}, 'YYYY-MM')`)

  // Booking status breakdown: count() grouped by state. Only states that occur
  // (≥1 Booking) come back — no fabricated zero rows.
  const statusRows = await db
    .select({ state: bookings.state, count: count() })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(eq(experiences.vendorUserId, vendorUserId))
    .groupBy(bookings.state)
    .orderBy(sql`count(*) DESC`)

  // Revenue by Experience: per-Experience Booking count + gross, ordered by
  // revenue desc. INNER JOIN → only Experiences with ≥1 Booking appear (honest,
  // no 0/0 noise for never-booked Experiences).
  const experienceRows = await db
    .select({
      experienceId: experiences.id,
      title: experiences.title,
      bookings: count(),
      revenue: sum(bookings.grossTotalSnapshot),
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(eq(experiences.vendorUserId, vendorUserId))
    .groupBy(experiences.id, experiences.title)
    .orderBy(sql`sum(${bookings.grossTotalSnapshot}) DESC`)

  const headline = shapeAnalytics({ allTimeStats })

  return {
    ...headline,
    keyMetrics: shapeKeyMetrics({
      current30,
      prior30,
      totalRevenue: headline.totalRevenue,
      totalBookings: headline.totalBookings,
      upcoming7,
      new7,
      cancelled,
      repeatCustomers,
    }),
    revenueByDay: fillDays(dayTrendStart, todayStart, revenueByDayRaw, 'total'),
    revenueByMonth: fillMonths(monthsStart, now, revenueByMonthRaw, 'total'),
    bookingStatusBreakdown: shapeStatusBreakdown(statusRows),
    revenueByExperience: shapeExperienceRevenue(experienceRows),
  }
}

/** Raw status-count rows from the grouped query (count may surface as string). */
interface RawStatusRow {
  state: string
  count: number | string | null
}

/**
 * Shape the Booking-status breakdown rows: coerce the grouped count to an
 * integer and drop any defensive zero/empty buckets. Pure + exported so the
 * coercion + drop-empty behaviour is unit-testable without a DB.
 */
export function shapeStatusBreakdown(
  rows: readonly RawStatusRow[],
): BookingStatusCount[] {
  return rows
    .map((r) => ({ state: r.state, count: Number(r.count ?? 0) }))
    .filter((r) => r.count > 0)
}

/** Raw per-Experience rows from the grouped query (numeric aggregates as string). */
interface RawExperienceRow {
  experienceId: string
  title: string
  bookings: number | string | null
  revenue: number | string | null
}

/**
 * Shape the revenue-by-Experience rows: floor gross to integer rupees, coerce
 * the count, and keep the revenue-desc order. Pure + exported so the null
 * SUM()/COUNT() coercion paths are unit-testable without a DB.
 */
export function shapeExperienceRevenue(
  rows: readonly RawExperienceRow[],
): ExperienceRevenue[] {
  return rows.map((r) => ({
    experienceId: r.experienceId,
    title: r.title,
    bookings: Number(r.bookings ?? 0),
    revenue: Math.floor(Number(r.revenue ?? 0)),
  }))
}
