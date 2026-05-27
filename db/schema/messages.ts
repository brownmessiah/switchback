import { sql } from 'drizzle-orm'
import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { conversations } from './conversations'
import { users } from './users'

/**
 * Individual messages within a conversation. Messages are append-only;
 * edits are not supported (marketplace messaging, not a chat product).
 *
 * `readAt` starts NULL; the thread view sets it when the recipient
 * opens the conversation. The SLA module queries the first message
 * where senderUserId === vendorUserId to compute first-response time.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .references(() => conversations.id, { onDelete: 'cascade' })
      .notNull(),
    senderUserId: text('sender_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    body: text('body').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index('messages_by_conversation').on(t.conversationId),
    index('messages_by_sender').on(t.senderUserId),
    index('messages_by_conversation_time').on(t.conversationId, t.createdAt),
  ],
)

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
