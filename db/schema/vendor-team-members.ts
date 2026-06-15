import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { users } from './users'

/**
 * Vendor team-member roles per ADR-0006 (revision 2026-06-15, issue #03).
 * `'owner'` exists in the enum for completeness but is NEVER stored as a row —
 * Owner is resolved implicitly from `vendor_profiles`. Issue #04 owns the
 * invite/management flow that writes the other four roles.
 */
export const vendorMemberRoleEnum = pgEnum('vendor_member_role', [
  'owner',
  'manager',
  'booking_staff',
  'guide',
  'accountant',
])

/**
 * Member status per ADR-0006. Deliberately minimal: deactivating a member
 * (`inactive`) revokes access WITHOUT deleting the row (Story 36). A pending
 * `'invited'` state, if ever needed, is issue #04's to add.
 */
export const vendorMemberStatusEnum = pgEnum('vendor_member_status', ['active', 'inactive'])

/**
 * Multi-seat Vendor accounts per ADR-0006 (revision 2026-06-15). A row grants
 * a human (`member_user_id`) a scoped role on a Vendor account
 * (`vendor_user_id`, = `vendor_profiles.user_id`). Owner is implicit and
 * never stored here. Unique on `(vendor_user_id, member_user_id)`: one human
 * holds at most one role per Vendor account.
 *
 * Defense-in-depth (issue #03 review, FIX 2): migration 0027 carries a CHECK
 * constraint `vendor_team_members_no_owner_role` enforcing `role <> 'owner'` at
 * the DB layer — Owner is resolved implicitly from `vendor_profiles` and must
 * never become a membership row (a future invite bug could otherwise grant
 * DB-level owner). Drizzle does not need the CHECK to typecheck, so it is
 * documented here rather than re-declared.
 */
export const vendorTeamMembers = pgTable(
  'vendor_team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorUserId: text('vendor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    memberUserId: text('member_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: vendorMemberRoleEnum('role').notNull(),
    status: vendorMemberStatusEnum('status').default('active').notNull(),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('vendor_team_members_vendor_member_unique').on(t.vendorUserId, t.memberUserId),
    index('vendor_team_members_by_member').on(t.memberUserId),
  ],
)

export type VendorTeamMember = typeof vendorTeamMembers.$inferSelect
export type NewVendorTeamMember = typeof vendorTeamMembers.$inferInsert
