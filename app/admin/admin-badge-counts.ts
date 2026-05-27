import { count, eq } from 'drizzle-orm'

import { db } from '@/db/client'
import { bookings, experiences, vendorProfiles } from '@/db/schema'

import type { AdminBadgeCounts } from './admin-sidebar'

/**
 * Query badge counts for the admin sidebar.
 * - pendingKyc: vendors at 'phone' KYC tier (need identity verification)
 * - pendingExperiences: experiences in 'pending_review' status
 * - disputedBookings: bookings in 'disputed' state awaiting resolution
 */
export async function getAdminBadgeCounts(): Promise<AdminBadgeCounts> {
  const [[kycRow], [expRow], [disputeRow]] = await Promise.all([
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
  ])

  return {
    pendingKyc: kycRow?.count ?? 0,
    pendingExperiences: expRow?.count ?? 0,
    disputedBookings: disputeRow?.count ?? 0,
  }
}
