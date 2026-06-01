import { sql } from 'drizzle-orm'
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { experiences } from './experiences'
import { users } from './users'

/**
 * TripGroup model (ADR-0009). A Customer-led entity that lives from "I'm
 * thinking of going to X" through "we finished the trip". It owns its own
 * state — NOT Bookings. Each member books their own seat individually with a
 * `bookings.trip_group_id` reference (payment / refund / KYC / liability stay
 * per-member). Domain term is **TripGroup**; "Trip" is UI copy only.
 *
 * `customer_profiles.aadhaar_gender_verified` (ADR-0009) gates the women-only
 * join; gender is read ONLY in the eligibility check + admin tooling, never
 * selected into discovery output (privacy).
 */

// ── Enums ───────────────────────────────────────────────────────────

export const tripGroupVisibilityEnum = pgEnum('trip_group_visibility', [
  'private', // invite-only
  'public_all', // discoverable by anyone
  'public_women_only', // discoverable + joinable only by Aadhaar-verified-female
])

export const tripGroupMembershipRuleEnum = pgEnum('trip_group_membership_rule', [
  'auto_accept', // join → active immediately
  'host_approval', // join → pending until the host approves
])

export const tripGroupStatusEnum = pgEnum('trip_group_status', [
  'forming', // gathering members
  'planning', // min members joined; co-editing the itinerary
  'booking', // host locked the itinerary; members book their seats
  'traveling', // members have booked; the trip is underway
  'completed', // all member Bookings reached Completion (ADR-0003)
  'archived', // host-archived, 30d-stale-forming, or 60d-post-completed
])

export const tripGroupMemberRoleEnum = pgEnum('trip_group_member_role', [
  'host',
  'member',
])

export const tripGroupMemberStatusEnum = pgEnum('trip_group_member_status', [
  'pending', // requested to join a host_approval group; awaiting decision
  'active', // a full member
])

// ── trip_groups ─────────────────────────────────────────────────────

export const tripGroups = pgTable(
  'trip_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hostUserId: text('host_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    /** Region registry slugs the trip targets (controlled vocabulary). */
    destinationSlugs: text('destination_slugs').array().notNull().default(sql`'{}'`),
    targetDateWindowStart: date('target_date_window_start'),
    targetDateWindowEnd: date('target_date_window_end'),
    /** Optional {minRupees, maxRupees}; not a discovery filter in v1. */
    budgetRange: jsonb('budget_range'),
    interestTags: text('interest_tags').array().notNull().default(sql`'{}'`),
    visibility: tripGroupVisibilityEnum('visibility').default('public_all').notNull(),
    membershipRule: tripGroupMembershipRuleEnum('membership_rule')
      .default('auto_accept')
      .notNull(),
    /** Platform-enforced 2..12 (beyond 12 it's a tour, not a group). */
    maxMembers: integer('max_members').notNull(),
    status: tripGroupStatusEnum('status').default('forming').notNull(),
    ...timestamps,
  },
  (t) => [
    check('trip_groups_max_members_range', sql`${t.maxMembers} BETWEEN 2 AND 12`),
    index('trip_groups_by_visibility_status').on(t.visibility, t.status),
    index('trip_groups_by_host').on(t.hostUserId),
  ],
)

// ── trip_group_members ──────────────────────────────────────────────

export const tripGroupMembers = pgTable(
  'trip_group_members',
  {
    tripGroupId: uuid('trip_group_id')
      .references(() => tripGroups.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: tripGroupMemberRoleEnum('role').default('member').notNull(),
    status: tripGroupMemberStatusEnum('status').default('active').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    ...timestamps,
  },
  (t) => [
    // One membership row per (group, user).
    primaryKey({ columns: [t.tripGroupId, t.userId] }),
    index('trip_group_members_by_user').on(t.userId),
    index('trip_group_members_by_group_status').on(t.tripGroupId, t.status),
  ],
)

// ── trip_group_itinerary_slots ──────────────────────────────────────

export const tripGroupItinerarySlots = pgTable(
  'trip_group_itinerary_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripGroupId: uuid('trip_group_id')
      .references(() => tripGroups.id, { onDelete: 'cascade' })
      .notNull(),
    /** 0-based day in the trip. */
    dayOffset: integer('day_offset').notNull(),
    /** e.g. 'morning' | 'afternoon' | 'evening' | a free label. */
    timeBand: text('time_band').notNull(),
    /**
     * A real PUBLISHED Experience the slot plans (grounding, mirrors ADR-0010).
     * ON DELETE SET NULL so de-listing an Experience leaves the slot as a
     * dangling plan rather than cascading the whole itinerary away.
     */
    experienceId: uuid('experience_id').references(() => experiences.id, {
      onDelete: 'set null',
    }),
    /** Alternative to a real Experience: a free-text plan ("lunch at X"). */
    freeText: text('free_text'),
    sortOrder: integer('sort_order').default(0).notNull(),
    /** Last writer (last-write-wins per slot, no OT in v1). */
    updatedByUserId: text('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => [index('trip_group_itinerary_slots_by_group').on(t.tripGroupId)],
)

// ── Types ───────────────────────────────────────────────────────────

export type TripGroup = typeof tripGroups.$inferSelect
export type NewTripGroup = typeof tripGroups.$inferInsert
export type TripGroupMember = typeof tripGroupMembers.$inferSelect
export type NewTripGroupMember = typeof tripGroupMembers.$inferInsert
export type TripGroupItinerarySlot = typeof tripGroupItinerarySlots.$inferSelect
export type NewTripGroupItinerarySlot = typeof tripGroupItinerarySlots.$inferInsert
