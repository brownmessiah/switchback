import { sql } from 'drizzle-orm'
import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { users } from './users'

/**
 * better-auth canonical tables. These are NOT exported from the
 * `db/schema/index.ts` barrel under domain-named exports — they
 * back the auth surface only, and are referenced by `lib/auth/index.ts`
 * via the Drizzle adapter.
 *
 * Shapes follow better-auth 1.6.x's defaults. See:
 *   node_modules/better-auth/dist/db/schema.d.mts
 * Plus the phoneNumber plugin schema fragment:
 *   node_modules/better-auth/dist/plugins/phone-number/schema.d.mts
 */

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index('sessions_by_user').on(t.userId),
    index('sessions_by_expires').on(t.expiresAt),
  ],
)

/**
 * One row per (provider, accountId) link. Used for Google OAuth (one
 * row per Google sub) and for the phoneNumber plugin (uses
 * providerId='phone-number'). Sensitive tokens are stored encrypted
 * at rest by better-auth when the secret key is set.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    providerId: text('provider_id').notNull(),
    accountId: text('account_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index('accounts_by_user').on(t.userId),
    index('accounts_by_provider').on(t.providerId, t.accountId),
  ],
)

/**
 * Single-use verification tokens — used by the phoneNumber plugin
 * (when not delegating verification to the SMS provider) and for
 * email verification flows. Tokens are short-lived and expire by
 * the timestamp here.
 */
export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [index('verifications_by_identifier').on(t.identifier)],
)

// Re-export for use in db/client.ts schema record.
// Note: deliberately NOT re-exported from db/schema/index.ts as a
// domain concern; the auth tables are an infrastructure detail.
export type Session = typeof sessions.$inferSelect
export type Account = typeof accounts.$inferSelect
export type Verification = typeof verifications.$inferSelect

// Silence the "unused boolean import" warning — boolean isn't used here
// but reserved if we add an account-verified flag later.
export const _internalReservedBoolean: typeof boolean = boolean
