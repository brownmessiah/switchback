import { count, desc, eq, sql, sum } from 'drizzle-orm'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type * as schema from '@/db/schema'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { refundRequests } from '@/db/schema/refund-requests'
import { supportTickets } from '@/db/schema/support-tickets'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'

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

export interface RecentActivityItem {
  readonly type: 'booking' | 'user' | 'vendor'
  readonly label: string
  readonly sublabel: string
  readonly timestamp: Date
}

export interface AdminDashboardData {
  readonly stats: DashboardStats
  readonly pending: PendingCounts
  readonly recentActivity: readonly RecentActivityItem[]
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
    recentActivity: recentActivity.slice(0, 10),
  }
}
