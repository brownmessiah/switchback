import { sql } from 'drizzle-orm'
import { check, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'

/**
 * Time-windowed commission overrides per ADR-0008. Resolution order at
 * Booking-create is: festival tier → per-Experience override →
 * per-Vendor base rate → platform default. First non-null wins.
 *
 * Empty `applies_to_*` arrays mean "all" — that scope dimension is
 * unconstrained. e.g. a "Diwali 2026" festival tier with all empty
 * filters fires on every Booking in the window.
 *
 * created_by_admin_user_id is text to mirror users.id type. No FK
 * (set null on user delete would lose the audit trail — admins are
 * never hard-deleted anyway).
 */
export const commissionTiers = pgTable(
  'commission_tiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    appliesToCategories: text('applies_to_categories').array().default([]).notNull(),
    appliesToVendorIds: text('applies_to_vendor_ids').array().default([]).notNull(),
    appliesToExperienceIds: text('applies_to_experience_ids').array().default([]).notNull(),
    rateOverride: numeric('rate_override', { precision: 5, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    createdByAdminUserId: text('created_by_admin_user_id').notNull(),
    ...timestamps,
  },
  (t) => [
    check('commission_tier_time_ordered', sql`${t.endAt} > ${t.startAt}`),
    check(
      'commission_rate_in_range',
      sql`${t.rateOverride} >= 0 AND ${t.rateOverride} <= 100`,
    ),
  ],
)

export type CommissionTier = typeof commissionTiers.$inferSelect
export type NewCommissionTier = typeof commissionTiers.$inferInsert
