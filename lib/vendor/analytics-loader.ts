import { count, eq, sum } from 'drizzle-orm'

import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'

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
export function shapeAnalytics(raw: RawAnalyticsStats): VendorAnalyticsData {
  const { allTimeStats } = raw
  const totalBookings = allTimeStats?.total ?? 0
  const totalRevenue = Math.floor(Number(allTimeStats?.revenue ?? 0))
  return {
    totalBookings,
    totalRevenue,
    hasData: totalBookings > 0,
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
  const [allTimeStats] = await db
    .select({
      total: count(),
      revenue: sum(bookings.grossTotalSnapshot),
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(eq(experiences.vendorUserId, vendorUserId))

  return shapeAnalytics({ allTimeStats })
}
