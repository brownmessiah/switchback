import { boolean, pgTable, text } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'

/**
 * Auth identity (ADR-0006). better-auth manages this table via the
 * Drizzle adapter. Column names match better-auth's expected shape
 * (`phoneNumber`/`phoneNumberVerified` not `phone`/`phoneVerified`)
 * because the better-auth phoneNumber plugin reads these columns
 * directly.
 *
 * Marketplace roles attach via the per-role profile tables in
 * customer-profiles.ts / vendor-profiles.ts / admin-profiles.ts.
 *
 * Keep this lean — anything role-specific belongs in a profile table.
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  phoneNumber: text('phone_number').unique(),
  phoneNumberVerified: boolean('phone_number_verified').default(false).notNull(),
  name: text('name'),
  image: text('image'),
  ...timestamps,
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
