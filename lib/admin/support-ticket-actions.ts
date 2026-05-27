import { and, desc, eq, type SQL } from 'drizzle-orm'
import { z } from 'zod'

import {
  supportMessages,
  supportTickets,
} from '@/db/schema/support-tickets'
import { users } from '@/db/schema/users'
import { writeAuditLog } from '@/lib/audit/write'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Result type ────────────────────────────────────────────────────

export type TicketActionResult = { ok: true; id?: string } | { ok: false; error: string }

// ── Status workflow ────────────────────────────────────────────────

/**
 * Forward-only ticket status workflow:
 *   open → in_progress → resolved → closed
 */
const STATUS_ORDER = ['open', 'in_progress', 'resolved', 'closed'] as const

export type TicketStatus = (typeof STATUS_ORDER)[number]

export function isValidStatusTransition(from: string, to: string): boolean {
  const fromIdx = STATUS_ORDER.indexOf(from as TicketStatus)
  const toIdx = STATUS_ORDER.indexOf(to as TicketStatus)
  return fromIdx >= 0 && toIdx >= 0 && toIdx === fromIdx + 1
}

// ── Validation schemas ─────────────────────────────────────────────

const createTicketSchema = z.object({
  createdByUserId: z.string().min(1, 'User ID is required.'),
  subject: z.string().trim().min(1, 'Subject is required.').max(500),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  category: z
    .enum(['booking', 'payment', 'experience', 'account', 'cancellation', 'other'])
    .optional()
    .default('other'),
  body: z.string().trim().min(1, 'Message body is required.').max(10000),
})

// ── Filters ────────────────────────────────────────────────────────

export interface TicketListFilters {
  status?: string
  priority?: string
  category?: string
}

// ── List loader ────────────────────────────────────────────────────

export async function loadTicketsList(db: DBOrTx, filters: TicketListFilters = {}) {
  const conditions: SQL[] = []

  if (filters.status) {
    conditions.push(eq(supportTickets.status, filters.status as TicketStatus))
  }
  if (filters.priority) {
    conditions.push(
      eq(supportTickets.priority, filters.priority as 'low' | 'medium' | 'high'),
    )
  }
  if (filters.category) {
    conditions.push(
      eq(
        supportTickets.category,
        filters.category as
          | 'booking'
          | 'payment'
          | 'experience'
          | 'account'
          | 'cancellation'
          | 'other',
      ),
    )
  }

  return db
    .select({
      id: supportTickets.id,
      subject: supportTickets.subject,
      status: supportTickets.status,
      priority: supportTickets.priority,
      category: supportTickets.category,
      createdByUserId: supportTickets.createdByUserId,
      assignedToAdminId: supportTickets.assignedToAdminId,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
      creatorName: users.name,
      creatorEmail: users.email,
    })
    .from(supportTickets)
    .innerJoin(users, eq(supportTickets.createdByUserId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(supportTickets.createdAt))
}

// ── Detail loader ──────────────────────────────────────────────────

export async function loadTicketDetail(db: DBOrTx, ticketId: string) {
  const [ticket] = await db
    .select({
      id: supportTickets.id,
      subject: supportTickets.subject,
      status: supportTickets.status,
      priority: supportTickets.priority,
      category: supportTickets.category,
      createdByUserId: supportTickets.createdByUserId,
      assignedToAdminId: supportTickets.assignedToAdminId,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
      creatorName: users.name,
      creatorEmail: users.email,
    })
    .from(supportTickets)
    .innerJoin(users, eq(supportTickets.createdByUserId, users.id))
    .where(eq(supportTickets.id, ticketId))
    .limit(1)

  if (!ticket) return null

  const messages = await db
    .select({
      id: supportMessages.id,
      body: supportMessages.body,
      senderUserId: supportMessages.senderUserId,
      senderName: users.name,
      senderEmail: users.email,
      createdAt: supportMessages.createdAt,
    })
    .from(supportMessages)
    .innerJoin(users, eq(supportMessages.senderUserId, users.id))
    .where(eq(supportMessages.ticketId, ticketId))
    .orderBy(supportMessages.createdAt)

  return { ticket, messages }
}

// ── Create ticket ──────────────────────────────────────────────────

export async function executeCreateTicket(
  db: DBOrTx,
  input: {
    createdByUserId: string
    subject: string
    priority?: string
    category?: string
    body: string
  },
): Promise<TicketActionResult> {
  const parsed = createTicketSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { createdByUserId, subject, priority, category, body } = parsed.data

  const [ticket] = await db
    .insert(supportTickets)
    .values({
      createdByUserId,
      subject,
      priority,
      category,
      status: 'open',
    })
    .returning({ id: supportTickets.id })

  await db.insert(supportMessages).values({
    ticketId: ticket!.id,
    senderUserId: createdByUserId,
    body,
  })

  return { ok: true, id: ticket!.id }
}

// ── Change status ──────────────────────────────────────────────────

export async function executeChangeTicketStatus(
  db: DBOrTx,
  adminUserId: string,
  ticketId: string,
  newStatus: string,
): Promise<TicketActionResult> {
  if (!ticketId) {
    return { ok: false, error: 'Ticket ID is required.' }
  }

  const [ticket] = await db
    .select({ id: supportTickets.id, status: supportTickets.status })
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1)

  if (!ticket) {
    return { ok: false, error: 'Ticket not found.' }
  }

  if (!isValidStatusTransition(ticket.status, newStatus)) {
    return {
      ok: false,
      error: `Cannot transition from ${ticket.status} to ${newStatus}. Only forward transitions are allowed.`,
    }
  }

  await db
    .update(supportTickets)
    .set({ status: newStatus as TicketStatus, updatedAt: new Date() })
    .where(eq(supportTickets.id, ticketId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.support_ticket.status_change',
    entityType: 'support_ticket',
    entityId: ticketId,
    payload: { previousStatus: ticket.status, newStatus },
  })

  return { ok: true }
}

// ── Assign ticket ──────────────────────────────────────────────────

export async function executeAssignTicket(
  db: DBOrTx,
  adminUserId: string,
  ticketId: string,
  assignedToAdminId: string,
): Promise<TicketActionResult> {
  if (!ticketId) {
    return { ok: false, error: 'Ticket ID is required.' }
  }

  const [ticket] = await db
    .select({ id: supportTickets.id, assignedToAdminId: supportTickets.assignedToAdminId })
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1)

  if (!ticket) {
    return { ok: false, error: 'Ticket not found.' }
  }

  await db
    .update(supportTickets)
    .set({ assignedToAdminId, updatedAt: new Date() })
    .where(eq(supportTickets.id, ticketId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.support_ticket.assign',
    entityType: 'support_ticket',
    entityId: ticketId,
    payload: {
      previousAssignee: ticket.assignedToAdminId,
      newAssignee: assignedToAdminId,
    },
  })

  return { ok: true }
}

// ── Add message ────────────────────────────────────────────────────

export async function executeAddMessage(
  db: DBOrTx,
  ticketId: string,
  senderUserId: string,
  body: string,
): Promise<TicketActionResult> {
  if (!ticketId) {
    return { ok: false, error: 'Ticket ID is required.' }
  }
  if (!body.trim()) {
    return { ok: false, error: 'Message body is required.' }
  }

  const [ticket] = await db
    .select({ id: supportTickets.id, status: supportTickets.status })
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1)

  if (!ticket) {
    return { ok: false, error: 'Ticket not found.' }
  }

  if (ticket.status === 'closed') {
    return { ok: false, error: 'Cannot add messages to a closed ticket.' }
  }

  const [msg] = await db
    .insert(supportMessages)
    .values({ ticketId, senderUserId, body: body.trim() })
    .returning({ id: supportMessages.id })

  // Touch the ticket's updatedAt
  await db
    .update(supportTickets)
    .set({ updatedAt: new Date() })
    .where(eq(supportTickets.id, ticketId))

  return { ok: true, id: msg!.id }
}
