import { and, count, desc, eq, sql, sum } from 'drizzle-orm'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type * as schema from '@/db/schema'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { refundRequests } from '@/db/schema/refund-requests'
import { supportTickets } from '@/db/schema/support-tickets'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { computeVendorNetPayout } from '@/lib/payments/payout-calculator'

type DBOrTx = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

// ── Types ─────────────────────────────────────────────────────────

export interface DashboardStats {
  readonly userCount: number
  readonly vendorCount: number
  readonly experienceCount: number
  readonly bookingCount: number
  readonly totalRevenue: number
}

export interface PendingCounts {
  readonly pendingKyc: number
  readonly pendingExperiences: number
  readonly disputedBookings: number
  readonly pendingRefunds: number
  readonly openTickets: number
  readonly pendingPayouts: number
}

/**
 * Money-correctness KPIs for the Admin "Money Command Center" home
 * (DESIGN.md §6 archetype #57-A). All figures are integer rupees, derived
 * READ-ONLY from the snapshot columns the money path already locked at
 * Booking-create — this loader never writes and never re-prices a Booking.
 *
 * Scope of the payout-side figures (pendingPayouts / commission / gstTdsDue /
 * netRevenue): the SAME population the action-rail "Pending payouts" count
 * uses — Bookings in state `completed` with `payout_state = 'pending'`
 * (ADR-0016). For each such Booking the per-Booking split is derived by the
 * shared, pure `computeVendorNetPayout` (the exact math the Payout queue and
 * the M3 disbursement batch use), so the dashboard can never disagree with
 * the queue it links into.
 *
 *  - pendingPayouts  = Σ netPayoutRupees   (owed to Vendors, not yet disbursed)
 *  - commission      = Σ commissionRupees  (Switchback platform commission earned)
 *  - gstTdsDue       = Σ (gstOnCommission + tds + tcs)  (statutory amounts to remit;
 *                      a LIABILITY/remittance figure, never platform income)
 *  - netRevenue      = commission − gstOnCommission     (platform-RETAINED take —
 *                      commission less the GST the platform must remit on it; the
 *                      Vendor's TDS §194-O and TCS §52 are excluded entirely, and
 *                      the statutory dues are NOT added back in)
 *
 * refundLiability is an INDEPENDENT population — Σ of `amount` on
 * refund_requests still in state `pending` (owed back to Customers; ADR-0004),
 * matching the action-rail "Pending refunds" count.
 */
export interface MoneyKpis {
  readonly pendingPayouts: number
  readonly refundLiability: number
  readonly commission: number
  readonly gstTdsDue: number
  readonly netRevenue: number
}

export interface RecentActivityItem {
  readonly type: 'booking' | 'user' | 'vendor'
  readonly label: string
  readonly sublabel: string
  readonly timestamp: Date
}

export interface AdminDashboardData {
  readonly stats: DashboardStats
  readonly pending: PendingCounts
  readonly money: MoneyKpis
  readonly recentActivity: readonly RecentActivityItem[]
}

// ── Money KPI loader ──────────────────────────────────────────────

/**
 * Aggregate the money-correctness KPIs (see {@link MoneyKpis}).
 *
 * READ-ONLY. Pulls the raw snapshot columns for the payout-pending population
 * and reduces them through the shared pure `computeVendorNetPayout`, plus the
 * pending refund-liability sum. No write, no change to the payout calculator.
 */
export async function loadMoneyKpis(db: DBOrTx): Promise<MoneyKpis> {
  const [payoutRows, [refundRow]] = await Promise.all([
    db
      .select({
        gross: bookings.grossTotalSnapshot,
        commissionRate: bookings.commissionRateSnapshot,
        gstRate: bookings.gstRateOnCommissionSnapshot,
        tds: bookings.tdsAmountSnapshot,
        tcs: bookings.tcsAmountSnapshot,
      })
      .from(bookings)
      .where(
        and(eq(bookings.state, 'completed'), eq(bookings.payoutState, 'pending')),
      ),
    db
      .select({ liability: sum(refundRequests.amount) })
      .from(refundRequests)
      .where(eq(refundRequests.state, 'pending')),
  ])

  let pendingPayouts = 0
  let commission = 0
  let gstOnCommission = 0
  let gstTdsDue = 0

  for (const row of payoutRows) {
    const split = computeVendorNetPayout({
      grossRupees: Math.floor(Number(row.gross ?? 0)),
      commissionRatePercent: row.commissionRate ?? '0',
      gstRateOnCommissionPercent: row.gstRate ?? '0',
      tdsRupees: Math.floor(Number(row.tds ?? 0)),
      tcsRupees: Math.floor(Number(row.tcs ?? 0)),
    })
    pendingPayouts += split.netPayoutRupees
    commission += split.commissionRupees
    gstOnCommission += split.gstOnCommissionRupees
    gstTdsDue += split.gstOnCommissionRupees + split.tdsRupees + split.tcsRupees
  }

  const refundLiability = Math.floor(Number(refundRow?.liability ?? 0))

  return {
    pendingPayouts,
    refundLiability,
    commission,
    gstTdsDue,
    // Platform-RETAINED take (ADR-0016): the platform keeps its commission less
    // the GST it must remit on that commission. TDS §194-O and TCS §52 are the
    // Vendor's taxes (withheld and credited to the Vendor), and GST-on-commission
    // is the platform's output-tax liability — none are platform income, so the
    // statutory dues are NOT added here (that would double-count `gstTdsDue`).
    netRevenue: commission - gstOnCommission,
  }
}

// ── Loader ────────────────────────────────────────────────────────

export async function loadAdminDashboard(db: DBOrTx): Promise<AdminDashboardData> {
  const [
    [userRow],
    [vendorRow],
    [expRow],
    [bookingRow],
    [kycRow],
    [pendingExpRow],
    [disputeRow],
    [refundRow],
    [ticketRow],
    [payoutRow],
    money,
    recentBookings,
    recentUsers,
    recentVendors,
  ] = await Promise.all([
    // Stats
    db.select({ count: count() }).from(users),
    db.select({ count: count() }).from(vendorProfiles),
    db.select({ count: count() }).from(experiences),
    db
      .select({ count: count(), revenue: sum(bookings.grossTotalSnapshot) })
      .from(bookings),

    // Pending counts
    db
      .select({ count: count() })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.kycTier, 'phone')),
    db
      .select({ count: count() })
      .from(experiences)
      .where(eq(experiences.status, 'pending_review')),
    db
      .select({ count: count() })
      .from(bookings)
      .where(eq(bookings.state, 'disputed')),
    db
      .select({ count: count() })
      .from(refundRequests)
      .where(eq(refundRequests.state, 'pending')),
    db
      .select({ count: count() })
      .from(supportTickets)
      .where(eq(supportTickets.status, 'open')),
    db
      .select({ count: count() })
      .from(bookings)
      .where(
        sql`${bookings.state} = 'completed' AND ${bookings.payoutState} = 'pending'`,
      ),

    // Money-correctness KPIs (read-only; reuses the payout calculator)
    loadMoneyKpis(db),

    // Recent activity
    db
      .select({
        id: bookings.id,
        grossTotal: bookings.grossTotalSnapshot,
        state: bookings.state,
        createdAt: bookings.createdAt,
        customerName: users.name,
        experienceTitle: experiences.title,
      })
      .from(bookings)
      .innerJoin(users, eq(bookings.customerUserId, users.id))
      .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
      .orderBy(desc(bookings.createdAt))
      .limit(5),
    db
      .select({ id: users.id, name: users.name, createdAt: users.createdAt })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(5),
    db
      .select({
        userId: vendorProfiles.userId,
        businessName: vendorProfiles.businessName,
        createdAt: vendorProfiles.createdAt,
      })
      .from(vendorProfiles)
      .orderBy(desc(vendorProfiles.createdAt))
      .limit(5),
  ])

  // Merge and sort recent activity
  const recentActivity: RecentActivityItem[] = []

  for (const b of recentBookings) {
    recentActivity.push({
      type: 'booking',
      label: `New booking: ${b.experienceTitle}`,
      sublabel: `${b.customerName ?? 'Customer'} — ₹${Number(b.grossTotal).toLocaleString('en-IN')}`,
      timestamp: b.createdAt,
    })
  }
  for (const u of recentUsers) {
    recentActivity.push({
      type: 'user',
      label: `New user: ${u.name ?? 'Anonymous'}`,
      sublabel: `User ID: ${u.id.slice(0, 8)}...`,
      timestamp: u.createdAt,
    })
  }
  for (const v of recentVendors) {
    recentActivity.push({
      type: 'vendor',
      label: `New vendor: ${v.businessName}`,
      sublabel: `Vendor ID: ${v.userId.slice(0, 8)}...`,
      timestamp: v.createdAt,
    })
  }

  recentActivity.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

  return {
    stats: {
      userCount: userRow?.count ?? 0,
      vendorCount: vendorRow?.count ?? 0,
      experienceCount: expRow?.count ?? 0,
      bookingCount: bookingRow?.count ?? 0,
      totalRevenue: Math.floor(Number(bookingRow?.revenue ?? 0)),
    },
    pending: {
      pendingKyc: kycRow?.count ?? 0,
      pendingExperiences: pendingExpRow?.count ?? 0,
      disputedBookings: disputeRow?.count ?? 0,
      pendingRefunds: refundRow?.count ?? 0,
      openTickets: ticketRow?.count ?? 0,
      pendingPayouts: payoutRow?.count ?? 0,
    },
    money,
    recentActivity: recentActivity.slice(0, 10),
  }
}
