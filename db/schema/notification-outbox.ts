import { sql } from 'drizzle-orm'
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { notifications } from './notifications'

/**
 * Delivery channels for notifications. `in_app` is always created
 * by the engine; the others are dispatched by the outbox processor
 * (a cron or queue-backed worker — stubbed as TODO in M3).
 */
export const notificationChannelEnum = pgEnum('notification_channel', [
  'in_app',
  'email',
  'whatsapp',
  'sms',
])

/**
 * Outbox delivery status. Rows start as `pending`; the delivery
 * worker transitions them to `sent`, `failed`, or `skipped`
 * (when the user's preference disables that channel).
 */
export const outboxStatusEnum = pgEnum('outbox_status', [
  'pending',
  'sent',
  'failed',
  'skipped',
])

/**
 * Transactional outbox for notification delivery. Each notification
 * row fans out into one outbox row per channel. The outbox pattern
 * ensures at-least-once delivery — a polling worker reads `pending`
 * rows, attempts delivery via the channel adapter, and transitions
 * the row to `sent` or `failed`.
 *
 * Written in the same db.transaction as the notification row so
 * no delivery intent is lost if the application crashes.
 */
export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationId: uuid('notification_id')
      .references(() => notifications.id, { onDelete: 'cascade' })
      .notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    status: outboxStatusEnum('status').default('pending').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index('outbox_by_notification').on(t.notificationId),
    index('outbox_by_status').on(t.status),
    index('outbox_pending_channel').on(t.channel, t.status),
  ],
)

export type NotificationOutbox = typeof notificationOutbox.$inferSelect
export type NewNotificationOutbox = typeof notificationOutbox.$inferInsert
