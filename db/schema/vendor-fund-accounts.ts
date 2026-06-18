import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { users } from './users'

/**
 * Provisioned Razorpay X Fund Accounts, with history, per ADR-0016
 * (2026-06-18 amendment).
 *
 * Entity provisioning is eager: when a Vendor sets or changes their payout
 * destination we create a Razorpay X Fund Account concurrently with the 7-day
 * cooling-off, so the account is ready by the time funds may flow. Each
 * distinct destination a Vendor has ever used gets its own row, keyed by
 * `(vendorUserId, destinationFingerprint)` — the fingerprint is the shared,
 * shape-stable hash from `lib/payments/payout-destination.ts`.
 *
 * History is RETAINED: a Booking that snapshotted an older destination still
 * resolves to the Fund Account provisioned for that destination. The unique
 * index dedupes a single destination per Vendor (so a change-back reuses the
 * retained row rather than inserting a duplicate) while keeping rows for
 * distinct destinations.
 *
 * `coolingOffUntil` stamps when this destination becomes eligible to receive
 * funds (= the change time + 7 days). The Payout Batch path only READS
 * `razorpayFundAccountId`; a missing / legacy / still-cooling-off account
 * drops the Payout to the admin queue rather than provisioning mid-money-path.
 */
export const vendorFundAccounts = pgTable(
  'vendor_fund_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorUserId: text('vendor_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    destinationFingerprint: text('destination_fingerprint').notNull(),
    razorpayFundAccountId: text('razorpay_fund_account_id').notNull(),
    coolingOffUntil: timestamp('cooling_off_until', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    // Dedupe a destination per Vendor while retaining history of distinct ones.
    uniqueIndex('vendor_fund_accounts_vendor_destination').on(
      t.vendorUserId,
      t.destinationFingerprint,
    ),
    index('vendor_fund_accounts_by_vendor').on(t.vendorUserId),
  ],
)

export type VendorFundAccount = typeof vendorFundAccounts.$inferSelect
export type NewVendorFundAccount = typeof vendorFundAccounts.$inferInsert
