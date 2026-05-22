import { pgTable, text } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { users } from './users'

/**
 * Admin-role data per ADR-0006. Sub-admin is NOT a separate role — it
 * is an Admin whose `permissions` array is a strict subset of full-admin
 * powers. Promotion from sub-admin to full admin is a permissions diff,
 * not a row migration.
 *
 * `invitedByUserId` records who created this admin so the invite audit
 * trail (per ADR-0006) is intrinsic to the row, not parked in an
 * external audit table.
 */
export const adminProfiles = pgTable('admin_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  permissions: text('permissions').array().default([]).notNull(),
  invitedByUserId: text('invited_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  ...timestamps,
})

export type AdminProfile = typeof adminProfiles.$inferSelect
export type NewAdminProfile = typeof adminProfiles.$inferInsert
