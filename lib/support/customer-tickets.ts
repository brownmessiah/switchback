import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { supportMessages, supportTickets } from '@/db/schema/support-tickets'
import { users } from '@/db/schema/users'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Customer-facing support ticket core.
 *
 * Reuses the same `support_tickets` + `support_messages` tables (and the
 * forward-only status workflow) that the admin surface drives in
 * `lib/admin/support-ticket-actions.ts`. The "no reply on a closed ticket"
 * rule is mirrored here verbatim: the admin `executeAddMessage` rejects any
 * message when the ticket status is `closed`, so a customer reply must too.
 *
 * Every function is pure (takes a Drizzle handle, no auth/headers) so the
 * test suite can exercise it directly against PGlite. The auth + session
 * concerns live in the `'use server'` wrappers in
 * `app/(app)/support/actions.ts`.
 */

// ── Result type ────────────────────────────────────────────────────

export type CustomerTicketResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export type CustomerReplyResult =
  | { ok: true }
  | { ok: false; error: string }

// ── Validation ─────────────────────────────────────────────────────

const TICKET_CATEGORIES = [
  'booking',
  'payment',
  'experience',
  'account',
  'cancellation',
  'other',
] as const

const createTicketSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required.').max(500),
  category: z.enum(TICKET_CATEGORIES).optional().default('other'),
  message: z.string().trim().min(1, 'Message is required.').max(10000),
})

export type CreateCustomerTicketInput = {
  subject: string
  category?: (typeof TICKET_CATEGORIES)[number]
  message: string
}

// ── List row shape ─────────────────────────────────────────────────

export interface MyTicketListRow {
  id: string
  subject: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  category: (typeof TICKET_CATEGORIES)[number]
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
  lastMessageBody: string | null
  lastMessageAt: Date | null
}

// ── Create ─────────────────────────────────────────────────────────

/**
 * Open a new support ticket on behalf of an authenticated customer.
 * Inserts the ticket (status 'open', priority 'medium', category from input)
 * plus the first message (sender = the customer, body = the input message).
 */
export async function createCustomerTicket(
  db: DBOrTx,
  userId: string,
  input: CreateCustomerTicketInput,
): Promise<CustomerTicketResult> {
  if (!userId) return { ok: false, error: 'You must be signed in.' }

  const parsed = createTicketSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { subject, category, message } = parsed.data

  const [ticket] = await db
    .insert(supportTickets)
    .values({
      createdByUserId: userId,
      subject,
      category,
      status: 'open',
      priority: 'medium',
    })
    .returning({ id: supportTickets.id })

  if (!ticket) return { ok: false, error: 'Could not create the ticket.' }

  await db.insert(supportMessages).values({
    ticketId: ticket.id,
    senderUserId: userId,
    body: message,
  })

  return { ok: true, id: ticket.id }
}

// ── List ───────────────────────────────────────────────────────────

/**
 * List the tickets created by `userId`, newest-updated first, with the
 * most recent message body + timestamp for a list-row preview. Strictly
 * ownership-scoped: another user's tickets are never returned.
 */
export async function listMyTickets(
  db: DBOrTx,
  userId: string,
): Promise<MyTicketListRow[]> {
  const tickets = await db
    .select({
      id: supportTickets.id,
      subject: supportTickets.subject,
      status: supportTickets.status,
      category: supportTickets.category,
      createdByUserId: supportTickets.createdByUserId,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
    })
    .from(supportTickets)
    .where(eq(supportTickets.createdByUserId, userId))
    .orderBy(desc(supportTickets.updatedAt), desc(supportTickets.createdAt))

  return Promise.all(
    tickets.map(async (t) => {
      const [last] = await db
        .select({
          body: supportMessages.body,
          createdAt: supportMessages.createdAt,
        })
        .from(supportMessages)
        .where(eq(supportMessages.ticketId, t.id))
        .orderBy(desc(supportMessages.createdAt))
        .limit(1)

      return {
        ...t,
        lastMessageBody: last?.body ?? null,
        lastMessageAt: last?.createdAt ?? null,
      }
    }),
  )
}

// ── Thread ─────────────────────────────────────────────────────────

/**
 * Load a single ticket + its ordered message thread, ownership-checked.
 * Returns null if the ticket does not exist OR does not belong to `userId`.
 */
export async function getMyTicketThread(db: DBOrTx, userId: string, ticketId: string) {
  const [ticket] = await db
    .select({
      id: supportTickets.id,
      subject: supportTickets.subject,
      status: supportTickets.status,
      priority: supportTickets.priority,
      category: supportTickets.category,
      createdByUserId: supportTickets.createdByUserId,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
    })
    .from(supportTickets)
    .where(
      and(
        eq(supportTickets.id, ticketId),
        eq(supportTickets.createdByUserId, userId),
      ),
    )
    .limit(1)

  if (!ticket) return null

  const messages = await db
    .select({
      id: supportMessages.id,
      body: supportMessages.body,
      senderUserId: supportMessages.senderUserId,
      senderName: users.name,
      createdAt: supportMessages.createdAt,
    })
    .from(supportMessages)
    .innerJoin(users, eq(supportMessages.senderUserId, users.id))
    .where(eq(supportMessages.ticketId, ticketId))
    .orderBy(supportMessages.createdAt)

  return { ticket, messages }
}

// ── Reply ──────────────────────────────────────────────────────────

/**
 * Append a customer reply to one of their own tickets. Ownership-checked.
 * Rejects when the ticket is `closed` — mirroring the admin
 * `executeAddMessage` rule that no message can be added to a closed ticket.
 */
export async function replyToMyTicket(
  db: DBOrTx,
  userId: string,
  ticketId: string,
  body: string,
): Promise<CustomerReplyResult> {
  if (!body.trim()) {
    return { ok: false, error: 'Message is required.' }
  }

  const [ticket] = await db
    .select({
      id: supportTickets.id,
      status: supportTickets.status,
    })
    .from(supportTickets)
    .where(
      and(
        eq(supportTickets.id, ticketId),
        eq(supportTickets.createdByUserId, userId),
      ),
    )
    .limit(1)

  if (!ticket) {
    return { ok: false, error: 'Ticket not found.' }
  }

  if (ticket.status === 'closed') {
    return { ok: false, error: 'Cannot reply to a closed ticket.' }
  }

  // A reply must always sort strictly after every prior message in the thread.
  // `defaultNow()` is only millisecond-resolution, so two messages written in
  // the same millisecond (common under fast/parallel test runs) would tie and
  // make thread order non-deterministic. Anchor the reply's createdAt to
  // `max(now, latestMessageAt + 1ms)` so the conversation stays ordered without
  // a schema change.
  const [latest] = await db
    .select({ createdAt: supportMessages.createdAt })
    .from(supportMessages)
    .where(eq(supportMessages.ticketId, ticketId))
    .orderBy(desc(supportMessages.createdAt))
    .limit(1)

  const now = Date.now()
  const minAfterLatest = latest ? latest.createdAt.getTime() + 1 : 0
  const replyAt = new Date(Math.max(now, minAfterLatest))

  await db.insert(supportMessages).values({
    ticketId,
    senderUserId: userId,
    body: body.trim(),
    createdAt: replyAt,
  })

  // Touch updatedAt so the ticket surfaces at the top of the customer's list.
  await db
    .update(supportTickets)
    .set({ updatedAt: new Date() })
    .where(eq(supportTickets.id, ticketId))

  return { ok: true }
}
