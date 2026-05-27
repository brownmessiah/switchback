import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { users } from './users'

/**
 * Three-tier verification badge per ADR-0007.
 * - phone: signup-only; cannot publish or accept Bookings.
 * - identity: Aadhaar+PAN gated; Tier-2 caps apply (single-day,
 *   Rs.5K/person, 8 participants).
 * - business: video call + GSTIN-or-Udyam + cert; unrestricted.
 */
export const kycTierEnum = pgEnum('kyc_tier', ['phone', 'identity', 'business'])

/**
 * Payout method per ADR-0016. UPI VPA or bank account (IMPS/NEFT), both
 * disbursed through Razorpay X.
 */
export const payoutMethodEnum = pgEnum('payout_method', ['upi', 'bank_account'])

/**
 * Vendor-role data per ADR-0006 + ADR-0007 + ADR-0008 + ADR-0016.
 * FK to users.id; cascade on delete.
 *
 * Holds the per-Vendor commission base rate (default 20%) that the
 * commission-resolution chain in ADR-0008 falls back to when no
 * festival tier or per-Experience override fires.
 */
export const vendorProfiles = pgTable('vendor_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  businessName: text('business_name').notNull(),
  slug: text('slug').notNull().unique(),
  about: text('about'),

  // ADR-0007 — KYC state.
  kycTier: kycTierEnum('kyc_tier').default('phone').notNull(),
  pan: text('pan'),
  gstin: text('gstin'),
  udyamId: text('udyam_id'),
  aadhaarVerifiedAt: timestamp('aadhaar_verified_at', { withTimezone: true }),
  videoCallVerifiedAt: timestamp('video_call_verified_at', { withTimezone: true }),

  // ADR-0008 — Commission base rate; layered by festival_tiers + experience override.
  commissionRate: numeric('commission_rate', { precision: 5, scale: 2 })
    .default('20.00')
    .notNull(),

  // ADR-0016 — Payout destination + cooling-off + manual-approval queue.
  payoutMethod: payoutMethodEnum('payout_method'),
  payoutDestination: jsonb('payout_destination'),
  payoutDestinationChangedAt: timestamp('payout_destination_changed_at', {
    withTimezone: true,
  }),
  // ADR-0007 — First 3 Payouts after reaching Tier 2 require manual admin approval.
  manualPayoutsRemaining: integer('manual_payouts_remaining').default(3).notNull(),

  // ADR-0007 — Response-time SLA score is orthogonal to KYC tier.
  responseTimeSlaScore: numeric('response_time_sla_score', { precision: 5, scale: 2 })
    .default('100.00')
    .notNull(),

  // Admin-controlled suspension. Suspended vendors cannot accept new
  // bookings; their Experiences should display as paused.
  suspended: boolean('suspended').default(false).notNull(),

  ...timestamps,
})

export type VendorProfile = typeof vendorProfiles.$inferSelect
export type NewVendorProfile = typeof vendorProfiles.$inferInsert
