import { count, eq, gte, sql, sum } from 'drizzle-orm'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type * as schema from '@/db/schema'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { payments } from '@/db/schema/payments'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'

type DBOrTx = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

// ── Data shapes ───────────────────────────────────────────────────

export interface MonthDataPoint {
  readonly month: string // YYYY-MM
  readonly value: number
}

export interface WeekDataPoint {
  readonly week: string // YYYY-Www (ISO week)
  readonly value: number
}

export interface CategoryDataPoint {
  readonly name: string
  readonly value: number
}

export interface AnalyticsKpi {
  readonly totalRevenue: number
  readonly totalBookings: number
  readonly totalUsers: number
  readonly totalVendors: number
  readonly averageBookingValue: number
  readonly publishedExperiences: number
}

export interface AnalyticsData {
  readonly kpi: AnalyticsKpi
  readonly revenueTrend: readonly MonthDataPoint[]
  readonly bookingVolume: readonly WeekDataPoint[]
  readonly vendorGrowth: readonly MonthDataPoint[]
  readonly categoryPerformance: readonly CategoryDataPoint[]
}

// ── KPI loader ────────────────────────────────────────────────────

export async function loadAnalyticsKpi(db: DBOrTx): Promise<AnalyticsKpi> {
  const [
    [revenueRow],
    [userRow],
    [vendorRow],
    [expRow],
  ] = await Promise.all([
    db
      .select({
        count: count(),
        revenue: sum(bookings.grossTotalSnapshot),
      })
      .from(bookings),
    db.select({ count: count() }).from(users),
    db.select({ count: count() }).from(vendorProfiles),
    db
      .select({ count: count() })
      .from(experiences)
      .where(eq(experiences.status, 'published')),
  ])

  const totalBookings = revenueRow?.count ?? 0
  const totalRevenue = Math.floor(Number(revenueRow?.revenue ?? 0))
  const averageBookingValue = totalBookings > 0 ? Math.floor(totalRevenue / totalBookings) : 0

  return {
    totalRevenue,
    totalBookings,
    totalUsers: userRow?.count ?? 0,
    totalVendors: vendorRow?.count ?? 0,
    averageBookingValue,
    publishedExperiences: expRow?.count ?? 0,
  }
}

// ── Revenue trend (monthly, last 12 months) ───────────────────────

export async function loadRevenueTrend(db: DBOrTx): Promise<readonly MonthDataPoint[]> {
  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
  twelveMonthsAgo.setDate(1)
  twelveMonthsAgo.setHours(0, 0, 0, 0)
  const cutoff = twelveMonthsAgo.toISOString()

  const rows = await db
    .select({
      month: sql<string>`to_char(${payments.capturedAt}, 'YYYY-MM')`.as('month'),
      total: sum(payments.amount),
    })
    .from(payments)
    .where(
      sql`${payments.captureTrigger} <> 'refund_reverse' AND ${payments.capturedAt} >= ${cutoff}::timestamptz`,
    )
    .groupBy(sql`to_char(${payments.capturedAt}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${payments.capturedAt}, 'YYYY-MM')`)

  return fillMonths(twelveMonthsAgo, new Date(), rows, 'total')
}

// ── Booking volume (weekly, last 12 weeks) ────────────────────────

export async function loadBookingVolume(db: DBOrTx): Promise<readonly WeekDataPoint[]> {
  const twelveWeeksAgo = new Date()
  twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84) // 12 weeks
  twelveWeeksAgo.setHours(0, 0, 0, 0)
  const cutoff = twelveWeeksAgo.toISOString()

  const rows = await db
    .select({
      week: sql<string>`to_char(${bookings.confirmedAt}, 'IYYY-"W"IW')`.as('week'),
      count: count(),
    })
    .from(bookings)
    .where(sql`${bookings.confirmedAt} >= ${cutoff}::timestamptz`)
    .groupBy(sql`to_char(${bookings.confirmedAt}, 'IYYY-"W"IW')`)
    .orderBy(sql`to_char(${bookings.confirmedAt}, 'IYYY-"W"IW')`)

  return rows.map((r) => ({
    week: r.week,
    value: r.count,
  }))
}

// ── Vendor growth (monthly, last 12 months) ───────────────────────

export async function loadVendorGrowth(db: DBOrTx): Promise<readonly MonthDataPoint[]> {
  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
  twelveMonthsAgo.setDate(1)
  twelveMonthsAgo.setHours(0, 0, 0, 0)
  const cutoff = twelveMonthsAgo.toISOString()

  const rows = await db
    .select({
      month: sql<string>`to_char(${vendorProfiles.createdAt}, 'YYYY-MM')`.as('month'),
      count: count(),
    })
    .from(vendorProfiles)
    .where(sql`${vendorProfiles.createdAt} >= ${cutoff}::timestamptz`)
    .groupBy(sql`to_char(${vendorProfiles.createdAt}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${vendorProfiles.createdAt}, 'YYYY-MM')`)

  return fillMonths(twelveMonthsAgo, new Date(), rows, 'count')
}

// ── Category performance (bookings by activity slug) ──────────────

export async function loadCategoryPerformance(
  db: DBOrTx,
): Promise<readonly CategoryDataPoint[]> {
  const rows = await db
    .select({
      name: experiences.activitySlug,
      count: count(),
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .groupBy(experiences.activitySlug)
    .orderBy(sql`count(*) DESC`)
    .limit(10)

  return rows.map((r) => ({
    name: r.name,
    value: r.count,
  }))
}

// ── Composite loader ──────────────────────────────────────────────

export async function loadAnalytics(db: DBOrTx): Promise<AnalyticsData> {
  const [kpi, revenueTrend, bookingVolume, vendorGrowth, categoryPerformance] =
    await Promise.all([
      loadAnalyticsKpi(db),
      loadRevenueTrend(db),
      loadBookingVolume(db),
      loadVendorGrowth(db),
      loadCategoryPerformance(db),
    ])

  return { kpi, revenueTrend, bookingVolume, vendorGrowth, categoryPerformance }
}

// ── Helpers ───────────────────────────────────────────────────────

function fillMonths(
  from: Date,
  to: Date,
  rawData: readonly Record<string, unknown>[],
  valueKey: string,
): MonthDataPoint[] {
  const dataMap = new Map<string, number>()
  for (const row of rawData) {
    const monthStr = String(row.month ?? row.month)
    dataMap.set(monthStr, Math.floor(Number(row[valueKey] ?? 0)))
  }

  const result: MonthDataPoint[] = []
  const current = new Date(from.getFullYear(), from.getMonth(), 1)
  const end = new Date(to.getFullYear(), to.getMonth(), 1)

  while (current <= end) {
    const monthStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`
    result.push({
      month: monthStr,
      value: dataMap.get(monthStr) ?? 0,
    })
    current.setMonth(current.getMonth() + 1)
  }

  return result
}
