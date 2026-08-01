import {
  boolean,
  index,
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
 * Income-tax taxpayer classification per ADR-0016. Drives the Section
 * 194-O(2) ₹5L threshold exemption — only individual/HUF Vendors qualify.
 * Nullable on the profile: existing Vendors predate this field, and NULL
 * means "unknown", which the TDS calculator treats conservatively (no
 * exemption, deduct as normal).
 */
export const vendorTaxpayerTypeEnum = pgEnum('vendor_taxpayer_type', [
  'individual',
  'huf',
  'company',
  'firm',
  'other',
])

/**
 * The admin's decision on a Vendor's application to sell (amends ADR-0007).
 *
 * A SEPARATE axis from `kycTier`, on purpose:
 *   - kycTier            = verification LEVEL; drives the ADR-0007 tier caps.
 *   - applicationStatus  = the admin's DECISION; gates whether the Vendor's
 *                          listings may go live at all.
 *
 * A Vendor may always draft and submit Experiences for review — ADR-0007's
 * Tier-2 gate requires at least one submitted Experience before approval is
 * even possible — but nothing is published until this reads 'approved'.
 * Rejection returns queued Experiences to draft; the Vendor can fix the stated
 * problem and re-apply.
 */
export const vendorApplicationStatusEnum = pgEnum('vendor_application_status', [
  'pending',
  'approved',
  'rejected',
])

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

  // ADR-0007 (amended) — the admin's accept/reject decision. Gates publishing;
  // orthogonal to kycTier, which gates the tier caps.
  applicationStatus: vendorApplicationStatusEnum('application_status')
    .default('pending')
    .notNull(),
  /** Admin's stated reason on rejection — shown to the Vendor so they can fix it. */
  applicationDecisionReason: text('application_decision_reason'),
  applicationDecidedAt: timestamp('application_decided_at', { withTimezone: true }),
  /** ON DELETE SET NULL — removing the deciding admin must not remove the Vendor. */
  applicationDecidedBy: text('application_decided_by').references(() => users.id, {
    onDelete: 'set null',
  }),

  // ADR-0007 — KYC state.
  kycTier: kycTierEnum('kyc_tier').default('phone').notNull(),
  pan: text('pan'),
  gstin: text('gstin'),
  udyamId: text('udyam_id'),
  // ADR-0016 — income-tax classification for the Section 194-O(2) exemption.
  taxpayerType: vendorTaxpayerTypeEnum('taxpayer_type'),
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
  // ADR-0016 (2026-06-18) — Razorpay X Contact id, provisioned once per Vendor
  // and cached so a destination change reuses it (no duplicate Contact). See
  // db/schema/vendor-fund-accounts.ts for the per-destination Fund Accounts.
  razorpayContactId: text('razorpay_contact_id'),
  // ADR-0007 — First 3 Payouts after reaching Tier 2 require manual admin approval.
  manualPayoutsRemaining: integer('manual_payouts_remaining').default(3).notNull(),

  // ADR-0007 — Response-time SLA score is orthogonal to KYC tier.
  responseTimeSlaScore: numeric('response_time_sla_score', { precision: 5, scale: 2 })
    .default('100.00')
    .notNull(),

  // Admin-controlled suspension. Suspended vendors cannot accept new
  // bookings; their Experiences should display as paused.
  suspended: boolean('suspended').default(false).notNull(),

  // ── Self-serve account closure (issue 06) ──────────────────────────
  // Soft-archive marker. A row is an "active vendor" only when closedAt
  // IS NULL. ORTHOGONAL to `suspended` (admin-controlled) — both honored.
  // Never deleted: ADR-0016 retention of financial/tax records. Re-onboarding
  // reactivates by clearing closedAt (honors the locked reversible-close
  // decision — see app/vendor/onboarding/actions.ts).
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closureReason: text('closure_reason'),

  ...timestamps,
}, (t) => [
  index('vendor_profiles_by_closed_at').on(t.closedAt),
  // The admin queue reads "who is waiting on a decision".
  index('vendor_profiles_by_application_status').on(t.applicationStatus),
])

export type VendorProfile = typeof vendorProfiles.$inferSelect
export type NewVendorProfile = typeof vendorProfiles.$inferInsert
