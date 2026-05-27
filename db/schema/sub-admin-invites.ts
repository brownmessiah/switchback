import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

import { timestamps } from './_common'
import { users } from './users'

/**
 * Sub-admin invite tracking per ADR-0006. Stores every invitation
 * issued so the audit trail is preserved even after acceptance or
 * revocation. Status transitions:
 *
 *   pending  -> accepted  (user signs up / is auto-created for demo)
 *   pending  -> revoked   (inviting admin rescinds before acceptance)
 *   accepted -> revoked   (admin removes sub-admin access)
 *
 * The `token` column is unique and used for invite-link flows. For
 * demo / direct-creation mode the token is generated but never emailed.
 */
export const subAdminInvites = pgTable('sub_admin_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  permissions: text('permissions').array().default([]).notNull(),
  invitedByAdminId: text('invited_by_admin_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').unique().notNull(),
  status: text('status').default('pending').notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  ...timestamps,
})

export type SubAdminInvite = typeof subAdminInvites.$inferSelect
export type NewSubAdminInvite = typeof subAdminInvites.$inferInsert
