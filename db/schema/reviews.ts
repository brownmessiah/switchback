import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { bookings } from './bookings'
import { experiences } from './experiences'
import { users } from './users'
import { vendorProfiles } from './vendor-profiles'

export const reviewStatusEnum = pgEnum('review_status', [
  'pending',
  'published',
  'flagged',
  'removed',
])

/**
 * Capture-time group type per issue #18 / DECISION D5. Nullable — existing
 * Reviews authored before this feature carry no group type. The .sql DDL in
 * db/migrations/0024_review_group_type.sql is the source of truth; this enum
 * must agree with it.
 */
export const reviewGroupTypeEnum = pgEnum('review_group_type', [
  'solo',
  'couple',
  'friends',
  'family',
  'corporate',
])

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id')
    .references(() => bookings.id, { onDelete: 'restrict' })
    .notNull()
    .unique(),
  customerUserId: text('customer_user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  experienceId: uuid('experience_id')
    .references(() => experiences.id, { onDelete: 'cascade' })
    .notNull(),
  vendorUserId: text('vendor_user_id')
    .references(() => vendorProfiles.userId, { onDelete: 'cascade' })
    .notNull(),

  rating: integer('rating').notNull(),
  title: text('title'),
  body: text('body'),

  // Capture-time group type (issue #18). Nullable — derived travel month
  // comes from the Booking's Availability slot, not stored here.
  groupType: reviewGroupTypeEnum('group_type'),

  status: reviewStatusEnum('status').default('published').notNull(),

  // Vendor response — one per review. Nullable; set once by the Vendor
  // via the respond action. vendor_responded_at is set atomically with
  // vendor_response.
  vendorResponse: text('vendor_response'),
  vendorRespondedAt: timestamp('vendor_responded_at', { withTimezone: true }),

  ...timestamps,
})

export type Review = typeof reviews.$inferSelect
export type NewReview = typeof reviews.$inferInsert
