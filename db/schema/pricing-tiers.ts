import { sql } from 'drizzle-orm'
import { check, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'

/**
 * Time-windowed per-participant price overrides per ADR-0011.
 * Parallel structure to commission_tiers (ADR-0008) — kept separate
 * because the value is a per-person price (numeric(12,2)) not a
 * percentage rate, and the resolution chains have different audit
 * semantics.
 *
 * Resolution order at Booking-create is: pricing tier → slot-specific
 * override → Experience tier-based price (group-size bracket) →
 * Experience base price (1-2 bracket as the floor). First non-null
 * wins. Resolved value snapshots onto bookings.price_per_participant_snapshot.
 */
export const pricingTiers = pgTable(
  'pricing_tiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    appliesToCategories: text('applies_to_categories').array().default([]).notNull(),
    appliesToVendorIds: text('applies_to_vendor_ids').array().default([]).notNull(),
    // Experience IDs are uuid — match the type to reject malformed scope filters.
    appliesToExperienceIds: uuid('applies_to_experience_ids').array().default([]).notNull(),
    pricePerPersonOverride: numeric('price_per_person_override', { precision: 12, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    createdByAdminUserId: text('created_by_admin_user_id').notNull(),
    ...timestamps,
  },
  (t) => [
    check('pricing_tier_time_ordered', sql`${t.endAt} > ${t.startAt}`),
    check('non_negative_price_override', sql`${t.pricePerPersonOverride} >= 0`),
    index('pricing_tiers_active_window').on(t.startAt, t.endAt),
  ],
)

export type PricingTier = typeof pricingTiers.$inferSelect
export type NewPricingTier = typeof pricingTiers.$inferInsert
