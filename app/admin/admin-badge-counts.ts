import { count, eq } from 'drizzle-orm'

import { db } from '@/db/client'
import { bookings, experiences, vendorProfiles } from '@/db/schema'

import type { AdminBadgeCounts } from './admin-sidebar'

/**
 * Query badge counts for the admin sidebar.
 * - pendingKyc: vendors awaiting an accept/reject decision
 * - pendingExperiences: experiences in 'pending_review' status
 * - disputedBookings: bookings in 'disputed' state awaiting resolution
 *
 * The vendor badge counts `application_status = 'pending'`, NOT `kyc_tier =
 * 'phone'`. The tier is a verification level, not a work queue: an approved
 * Vendor legitimately sits at a low tier, and counting them as pending kept
 * the badge permanently lit on vendors no admin needed to look at.
 */
export async function getAdminBadgeCounts(): Promise<AdminBadgeCounts> {
  const [[kycRow], [expRow], [disputeRow]] = await Promise.all([
    db
      .select({ count: count() })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.applicationStatus, 'pending')),
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
