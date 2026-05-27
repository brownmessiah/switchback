import { sql } from 'drizzle-orm'
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { users } from './users'

/**
 * Notification event types. Every notification carries one of these —
 * the notification engine maps booking/review/payout events to these
 * types so the preference system can toggle per-type per-channel.
 */
export const notificationTypeEnum = pgEnum('notification_type', [
  'booking_created',
  'booking_cancelled',
  'booking_completed',
  'review_posted',
  'payout_processed',
  'listing_approved',
  'listing_rejected',
  'message_received',
])

/**
 * In-app notifications. Each row represents a single notification
 * delivered to a user. The `event_id` column provides idempotency —
 * the `notify()` engine checks for a duplicate event_id before
 * inserting so that retried domain events (e.g. a replayed webhook)
 * never produce duplicate notifications.
 *
 * `readAt` starts NULL; the bell component sets it on mark-as-read.
 * `link` is the in-app path the user should navigate to on click
 * (e.g. `/vendor/bookings/<id>` or `/bookings/<id>`).
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    eventId: text('event_id').unique(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index('notifications_by_user').on(t.userId),
    index('notifications_by_user_unread').on(t.userId, t.readAt),
    index('notifications_by_event_id').on(t.eventId),
  ],
)

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert
