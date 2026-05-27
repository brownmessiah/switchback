import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { users } from './users'

/**
 * Support ticket status workflow:
 *   open → in_progress → resolved → closed
 *
 * Only forward transitions are allowed (no re-opening).
 * Admin assignment is separate from status changes.
 */
export const ticketStatusEnum = pgEnum('ticket_status', [
  'open',
  'in_progress',
  'resolved',
  'closed',
])

export const ticketPriorityEnum = pgEnum('ticket_priority', [
  'low',
  'medium',
  'high',
])

export const ticketCategoryEnum = pgEnum('ticket_category', [
  'booking',
  'payment',
  'experience',
  'account',
  'cancellation',
  'other',
])

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdByUserId: text('created_by_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    assignedToAdminId: text('assigned_to_admin_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    subject: text('subject').notNull(),
    status: ticketStatusEnum('status').default('open').notNull(),
    priority: ticketPriorityEnum('priority').default('medium').notNull(),
    category: ticketCategoryEnum('category').default('other').notNull(),
    ...timestamps,
  },
  (t) => [
    index('support_tickets_by_status').on(t.status),
    index('support_tickets_by_priority').on(t.priority),
    index('support_tickets_by_category').on(t.category),
    index('support_tickets_by_creator').on(t.createdByUserId),
    index('support_tickets_by_assignee').on(t.assignedToAdminId),
  ],
)

export type SupportTicket = typeof supportTickets.$inferSelect
export type NewSupportTicket = typeof supportTickets.$inferInsert

export const supportMessages = pgTable(
  'support_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .references(() => supportTickets.id, { onDelete: 'cascade' })
      .notNull(),
    senderUserId: text('sender_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('support_messages_by_ticket').on(t.ticketId),
    index('support_messages_by_sender').on(t.senderUserId),
  ],
)

export type SupportMessage = typeof supportMessages.$inferSelect
export type NewSupportMessage = typeof supportMessages.$inferInsert
