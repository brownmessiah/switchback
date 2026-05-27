import { sql } from 'drizzle-orm'
import {
  boolean,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { users } from './users'

/**
 * Per-user, per-event-type, per-channel notification preferences.
 *
 * When no row exists for a (userId, eventType, channel) triple the
 * notification engine treats the channel as **enabled** (opt-out model).
 * A row with `enabled = false` explicitly disables that channel for
 * that event type.
 *
 * The UNIQUE constraint on (userId, eventType, channel) is enforced
 * at the DB level so upsert logic in the preferences UI can use
 * ON CONFLICT.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    eventType: text('event_type').notNull(),
    channel: text('channel').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    unique('notification_prefs_unique').on(t.userId, t.eventType, t.channel),
  ],
)

export type NotificationPreference = typeof notificationPreferences.$inferSelect
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert
