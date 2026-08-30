import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { users } from './users'

/**
 * Promo codes per ADR-0004. Credit-grant model — redemption issues
 * Switchback credit into the customer's wallet. Admin-created, with
 * global and per-user usage limits.
 *
 * The `current_uses` column is atomically incremented via
 * `UPDATE ... WHERE current_uses < max_total_uses RETURNING` to
 * prevent race conditions on concurrent redemptions.
 */
export const promoCodes = pgTable(
  'promo_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').unique().notNull(),
    creditAmount: numeric('credit_amount', { precision: 14, scale: 2 }).notNull(),
    minBookingAmount: numeric('min_booking_amount', { precision: 14, scale: 2 }),
    maxTotalUses: integer('max_total_uses'),
    currentUses: integer('current_uses').default(0).notNull(),
    perUserLimit: integer('per_user_limit').default(1).notNull(),
    active: boolean('active').default(true).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdByAdminId: text('created_by_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index('promo_codes_by_code').on(t.code),
    index('promo_codes_by_active').on(t.active),
  ],
)

export type PromoCode = typeof promoCodes.$inferSelect
export type NewPromoCode = typeof promoCodes.$inferInsert
