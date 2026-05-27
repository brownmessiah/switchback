import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

import { promoCodes } from './promo-codes'
import { users } from './users'
import { walletTransactions } from './wallet-transactions'

/**
 * Promo redemption log. Each row records a single customer redeeming a
 * promo code. The unique constraint on (promo_code_id, customer_user_id)
 * enforces the per_user_limit=1 default at the DB layer.
 *
 * For per_user_limit > 1, the application layer checks the count of
 * existing redemptions before inserting. The unique constraint still
 * prevents duplicate (code, user) pairs from concurrent requests via
 * a partial approach — the code checks the count within the same tx
 * that does the atomic counter increment.
 */
export const promoRedemptions = pgTable(
  'promo_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    promoCodeId: uuid('promo_code_id')
      .references(() => promoCodes.id, { onDelete: 'cascade' })
      .notNull(),
    customerUserId: text('customer_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    walletTransactionId: uuid('wallet_transaction_id')
      .references(() => walletTransactions.id, { onDelete: 'set null' }),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    unique('promo_redemption_user_code').on(t.promoCodeId, t.customerUserId),
  ],
)

export type PromoRedemption = typeof promoRedemptions.$inferSelect
export type NewPromoRedemption = typeof promoRedemptions.$inferInsert
