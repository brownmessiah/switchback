import { sql } from 'drizzle-orm'
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { bookings } from './bookings'
import { users } from './users'

/**
 * Conversation status. Active conversations appear in the inbox;
 * archived ones are hidden but retained for audit/SLA computation.
 */
export const conversationStatusEnum = pgEnum('conversation_status', [
  'active',
  'archived',
])

/**
 * A conversation thread between a vendor and a customer. Optionally
 * tied to a booking (the most common case — a customer messages the
 * vendor about a specific booking). The subject line is set when the
 * conversation is created and is not updated.
 *
 * SLA computation: the vendor's first-response time is measured as
 * the delta between `createdAt` (when the customer initiated the
 * conversation) and the first message row where senderUserId ===
 * vendorUserId.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorUserId: text('vendor_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    customerUserId: text('customer_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    bookingId: uuid('booking_id')
      .references(() => bookings.id, { onDelete: 'set null' }),
    subject: text('subject').notNull(),
    status: conversationStatusEnum('status').default('active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index('conversations_by_vendor').on(t.vendorUserId),
    index('conversations_by_customer').on(t.customerUserId),
    index('conversations_by_booking').on(t.bookingId),
  ],
)

export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
