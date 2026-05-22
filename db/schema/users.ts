import { boolean, pgTable, text } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'

/**
 * Auth identity (ADR-0006). better-auth manages this table.
 * Marketplace roles attach via the per-role profile tables in
 * customer-profiles.ts / vendor-profiles.ts / admin-profiles.ts.
 *
 * Keep this lean — anything role-specific belongs in a profile table.
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  phone: text('phone').unique(),
  phoneVerified: boolean('phone_verified').default(false).notNull(),
  name: text('name'),
  image: text('image'),
  ...timestamps,
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
