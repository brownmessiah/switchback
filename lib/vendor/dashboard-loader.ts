import { and, count, eq, gte, lt, sql, sum } from 'drizzle-orm'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { payments } from '@/db/schema/payments'
import { vendorProfiles } from '@/db/schema/vendor-profiles'

/**
 * A single day's data point for the 30-day trend charts.
 */
export interface DayDataPoint {
  readonly date: string // YYYY-MM-DD
  readonly value: number
}

/**
 * Action items that need the vendor's attention.
 */
export interface ActionItem {
  readonly id: string
  readonly type: 'unconfirmed_booking' | 'calendar_gap'
  readonly title: string
  readonly subtitle: string
}

/**
 * Full dashboard stats shape returned by the loader.
 */
export interface VendorDashboardData {
  readonly businessName: string | null
  readonly kycTier: string
  readonly listingsCount: number
  readonly totalBookings: number
  readonly totalRevenue: number

  // Enhanced stat cards
  readonly todayBookings: number
  readonly monthRevenue: number
  readonly slaScore: number
  readonly pendingActionsCount: number

  // 30-day trends
  readonly bookingsTrend: readonly DayDataPoint[]
  readonly revenueTrend: readonly DayDataPoint[]

  // Action items
  readonly actionItems: readonly ActionItem[]

  // Upcoming bookings (existing)
  readonly upcomingBookings: readonly {
    readonly bookingId: string
    readonly participantCount: number
    readonly state: string
    readonly gross: number
    readonly slotStart: Date | null
    readonly expTitle: string
  }[]
}

/**
 * Load all vendor dashboard data in a single call.
 * Accepts a Drizzle DB handle so tests can pass PGlite.
 */
export async function loadVendorDashboard(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  vendorUserId: string,
): Promise<VendorDashboardData> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const thirtyDaysAgo = new Date(todayStart)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const ninetyDaysFromNow = new Date(todayStart)
  ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90)

  // Vendor profile
  const [vendor] = await db
    .select({
      businessName: vendorProfiles.businessName,
      kycTier: vendorProfiles.kycTier,
      responseTimeSlaScore: vendorProfiles.responseTimeSlaScore,
    })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  // Experience count
  const [expCount] = await db
    .select({ count: count() })
    .from(experiences)
    .where(eq(experiences.vendorUserId, vendorUserId))

  // Total bookings + revenue (all time)
  const [allTimeStats] = await db
    .select({
      total: count(),
      revenue: sum(bookings.grossTotalSnapshot),
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(eq(experiences.vendorUserId, vendorUserId))

  // Today's bookings (confirmed today by confirmedAt)
  const [todayStats] = await db
    .select({ count: count() })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        gte(bookings.confirmedAt, todayStart),
      ),
    )

  // Month revenue (payments captured this month)
  const [monthRevenueResult] = await db
    .select({ revenue: sum(payments.amount) })
    .from(payments)
    .innerJoin(bookings, eq(payments.bookingId, bookings.id))
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        gte(payments.capturedAt, monthStart),
        // Exclude refund_reverse entries (negative amounts)
        sql`${payments.captureTrigger} <> 'refund_reverse'`,
      ),
    )

  // Pending actions: bookings in 'confirmed' state with slots in the future
  // that the vendor needs to acknowledge
  const pendingBookings = await db
    .select({
      bookingId: bookings.id,
      expTitle: experiences.title,
      slotStart: availabilitySlots.startAt,
      participantCount: bookings.participantCount,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        eq(bookings.state, 'confirmed'),
        gte(availabilitySlots.startAt, now),
      ),
    )
    .orderBy(availabilitySlots.startAt)
    .limit(10)

  // Calendar gaps: open slots with 0 bookings in the next 90 days
  const calendarGaps = await db
    .select({
      slotId: availabilitySlots.id,
      startAt: availabilitySlots.startAt,
      capacity: availabilitySlots.capacity,
      capacityTaken: availabilitySlots.capacityTaken,
      expTitle: experiences.title,
    })
    .from(availabilitySlots)
    .innerJoin(experiences, eq(availabilitySlots.experienceId, experiences.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        eq(availabilitySlots.status, 'open'),
        eq(availabilitySlots.capacityTaken, 0),
        gte(availabilitySlots.startAt, now),
        lt(availabilitySlots.startAt, ninetyDaysFromNow),
      ),
    )
    .orderBy(availabilitySlots.startAt)
    .limit(10)

  // 30-day bookings trend (grouped by day)
  const bookingsTrendRaw = await db
    .select({
      date: sql<string>`date(${bookings.confirmedAt})`.as('date'),
      count: count(),
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        gte(bookings.confirmedAt, thirtyDaysAgo),
      ),
    )
    .groupBy(sql`date(${bookings.confirmedAt})`)
    .orderBy(sql`date(${bookings.confirmedAt})`)

  // 30-day revenue trend (grouped by day, from payments)
  const revenueTrendRaw = await db
    .select({
      date: sql<string>`date(${payments.capturedAt})`.as('date'),
      total: sum(payments.amount),
    })
    .from(payments)
    .innerJoin(bookings, eq(payments.bookingId, bookings.id))
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        gte(payments.capturedAt, thirtyDaysAgo),
        sql`${payments.captureTrigger} <> 'refund_reverse'`,
      ),
    )
    .groupBy(sql`date(${payments.capturedAt})`)
    .orderBy(sql`date(${payments.capturedAt})`)

  // Upcoming bookings (existing feature — keep it)
  const upcomingBookings = await db
    .select({
      bookingId: bookings.id,
      participantCount: bookings.participantCount,
      state: bookings.state,
      gross: bookings.grossTotalSnapshot,
      slotStart: availabilitySlots.startAt,
      expTitle: experiences.title,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        gte(availabilitySlots.startAt, now),
      ),
    )
    .orderBy(availabilitySlots.startAt)
    .limit(5)

  // Fill the 30-day date range (include days with zero bookings/revenue)
  const bookingsTrend = fillDays(thirtyDaysAgo, todayStart, bookingsTrendRaw, 'count')
  const revenueTrend = fillDays(thirtyDaysAgo, todayStart, revenueTrendRaw, 'total')

  // Build action items
  const actionItems: ActionItem[] = []
  for (const b of pendingBookings) {
    actionItems.push({
      id: b.bookingId,
      type: 'unconfirmed_booking',
      title: `Booking for ${b.expTitle}`,
      subtitle: `${b.participantCount} guests on ${formatDate(b.slotStart)}`,
    })
  }
  for (const g of calendarGaps) {
    actionItems.push({
      id: g.slotId,
      type: 'calendar_gap',
      title: `No bookings: ${g.expTitle}`,
      subtitle: `${formatDate(g.startAt)} — ${g.capacity} spots available`,
    })
  }

  return {
    ...shapeDashboardStats({
      vendor,
      expCount,
      allTimeStats,
      todayStats,
      monthRevenueResult,
    }),
    pendingActionsCount: pendingBookings.length,
    bookingsTrend,
    revenueTrend,
    actionItems,
    upcomingBookings: (upcomingBookings as RawUpcomingBooking[]).map(
      mapUpcomingBooking,
    ),
  }
}

/** Raw aggregate rows feeding the stat cards. Any may be undefined when a
 *  query returns no row, and numeric aggregates may be null — the shaper
 *  applies the safe fallbacks in one place. */
interface RawDashboardStats {
  vendor?: {
    businessName?: string | null
    kycTier?: string | null
    responseTimeSlaScore?: string | number | null
  }
  expCount?: { count?: number | null }
  allTimeStats?: { total?: number | null; revenue?: string | number | null }
  todayStats?: { count?: number | null }
  monthRevenueResult?: { revenue?: string | number | null }
}

type DashboardStatCards = Pick<
  VendorDashboardData,
  | 'businessName'
  | 'kycTier'
  | 'listingsCount'
  | 'totalBookings'
  | 'totalRevenue'
  | 'todayBookings'
  | 'monthRevenue'
  | 'slaScore'
>

/**
 * Apply the defensive fallbacks for the headline stat cards. Exported so the
 * "missing/null aggregate row" paths (e.g. a brand-new vendor with no rows,
 * or a driver surfacing null from SUM()) are unit-testable without forcing
 * the DB to violate its own NOT NULL constraints.
 */
export function shapeDashboardStats(raw: RawDashboardStats): DashboardStatCards {
  const { vendor, expCount, allTimeStats, todayStats, monthRevenueResult } = raw
  return {
    businessName: vendor?.businessName ?? null,
    kycTier: vendor?.kycTier ?? 'phone',
    listingsCount: expCount?.count ?? 0,
    totalBookings: allTimeStats?.total ?? 0,
    totalRevenue: Math.floor(Number(allTimeStats?.revenue ?? 0)),
    todayBookings: todayStats?.count ?? 0,
    monthRevenue: Math.floor(Number(monthRevenueResult?.revenue ?? 0)),
    slaScore: Number(vendor?.responseTimeSlaScore ?? 100),
  }
}

interface RawUpcomingBooking {
  bookingId: string
  participantCount: number
  state: string
  gross: string | null
  slotStart: Date | null
  expTitle: string
}

/**
 * Map one raw upcoming-booking row to the API shape, flooring the gross to
 * integer rupees and defaulting a missing gross to 0. Exported for direct
 * testing of the `gross ?? 0` fallback.
 */
export function mapUpcomingBooking(
  b: RawUpcomingBooking,
): VendorDashboardData['upcomingBookings'][number] {
  return {
    bookingId: b.bookingId,
    participantCount: b.participantCount,
    state: b.state,
    gross: Math.floor(Number(b.gross ?? 0)),
    slotStart: b.slotStart,
    expTitle: b.expTitle,
  }
}

/**
 * Fill a date range with data points, inserting 0 for missing days.
 *
 * Exported for direct unit testing of the day-fill + null-value defensive
 * paths: trend rows from the DB can carry a null aggregate value, and
 * gap days must materialise as 0 rather than disappearing.
 */
export function fillDays(
  from: Date,
  to: Date,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawData: readonly Record<string, any>[],
  valueKey: string,
): DayDataPoint[] {
  const dataMap = new Map<string, number>()
  for (const row of rawData) {
    const dateStr = String(row.date)
    dataMap.set(dateStr, Number(row[valueKey] ?? 0))
  }

  const result: DayDataPoint[] = []
  const current = new Date(from)
  while (current <= to) {
    const dateStr = current.toISOString().slice(0, 10)
    result.push({
      date: dateStr,
      value: dataMap.get(dateStr) ?? 0,
    })
    current.setDate(current.getDate() + 1)
  }
  return result
}

/**
 * Format a slot date for action-item subtitles. Returns an em dash for a
 * missing date. Exported for direct unit testing of the null path.
 */
export function formatDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/**
 * Determine SLA badge color.
 * green >= 90%, yellow >= 70%, red < 70%
 */
export function slaColor(score: number): 'green' | 'yellow' | 'red' {
  if (score >= 90) return 'green'
  if (score >= 70) return 'yellow'
  return 'red'
}
