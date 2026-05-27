import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { supportMessages, supportTickets } from '@/db/schema/support-tickets'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeAddMessage,
  executeAssignTicket,
  executeChangeTicketStatus,
  executeCreateTicket,
  isValidStatusTransition,
  loadTicketDetail,
  loadTicketsList,
} from './support-ticket-actions'

describe('support ticket actions', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_admin', email: 'admin@outvers.com', name: 'Admin' },
      { id: 'u_admin2', email: 'admin2@outvers.com', name: 'Admin 2' },
      { id: 'u_customer', email: 'customer@test.com', name: 'Customer' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, support_messages, support_tickets CASCADE`,
    )
  })

  // ── Status workflow ──────────────────────────────────────────────

  describe('isValidStatusTransition', () => {
    it('allows open → in_progress', () => {
      expect(isValidStatusTransition('open', 'in_progress')).toBe(true)
    })

    it('allows in_progress → resolved', () => {
      expect(isValidStatusTransition('in_progress', 'resolved')).toBe(true)
    })

    it('allows resolved → closed', () => {
      expect(isValidStatusTransition('resolved', 'closed')).toBe(true)
    })

    it('rejects skipping steps (open → resolved)', () => {
      expect(isValidStatusTransition('open', 'resolved')).toBe(false)
    })

    it('rejects backward (resolved → open)', () => {
      expect(isValidStatusTransition('resolved', 'open')).toBe(false)
    })

    it('rejects same status', () => {
      expect(isValidStatusTransition('open', 'open')).toBe(false)
    })
  })

  // ── Create ticket ────────────────────────────────────────────────

  it('creates a ticket with open status', async () => {
    const result = await executeCreateTicket(db, {
      createdByUserId: 'u_customer',
      subject: 'Payment issue',
      priority: 'high',
      category: 'payment',
      body: 'I was charged twice for my booking.',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const tickets = await loadTicketsList(db)
    expect(tickets).toHaveLength(1)
    expect(tickets[0]!.status).toBe('open')
    expect(tickets[0]!.priority).toBe('high')
    expect(tickets[0]!.category).toBe('payment')
  })

  it('creates initial message with the ticket', async () => {
    const result = await executeCreateTicket(db, {
      createdByUserId: 'u_customer',
      subject: 'Help needed',
      body: 'Cannot access my booking.',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const detail = await loadTicketDetail(db, result.id!)
    expect(detail).not.toBeNull()
    expect(detail!.messages).toHaveLength(1)
    expect(detail!.messages[0]!.body).toBe('Cannot access my booking.')
    expect(detail!.messages[0]!.senderUserId).toBe('u_customer')
  })

  it('rejects empty subject', async () => {
    const result = await executeCreateTicket(db, {
      createdByUserId: 'u_customer',
      subject: '',
      body: 'Some message',
    })

    expect(result.ok).toBe(false)
  })

  it('rejects empty body', async () => {
    const result = await executeCreateTicket(db, {
      createdByUserId: 'u_customer',
      subject: 'Valid subject',
      body: '',
    })

    expect(result.ok).toBe(false)
  })

  // ── Change status ────────────────────────────────────────────────

  it('transitions open → in_progress', async () => {
    const createResult = await executeCreateTicket(db, {
      createdByUserId: 'u_customer',
      subject: 'Test',
      body: 'Test body',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return

    const result = await executeChangeTicketStatus(
      db,
      'u_admin',
      createResult.id!,
      'in_progress',
    )
    expect(result.ok).toBe(true)

    const detail = await loadTicketDetail(db, createResult.id!)
    expect(detail!.ticket.status).toBe('in_progress')
  })

  it('rejects invalid transition (open → closed)', async () => {
    const createResult = await executeCreateTicket(db, {
      createdByUserId: 'u_customer',
      subject: 'Test',
      body: 'Test body',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return

    const result = await executeChangeTicketStatus(
      db,
      'u_admin',
      createResult.id!,
      'closed',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Cannot transition')
  })

  it('writes audit log on status change', async () => {
    const createResult = await executeCreateTicket(db, {
      createdByUserId: 'u_customer',
      subject: 'Test',
      body: 'Test body',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return

    await executeChangeTicketStatus(db, 'u_admin', createResult.id!, 'in_progress')

    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'admin.support_ticket.status_change'))
    expect(logs).toHaveLength(1)
    expect(logs[0]!.actorUserId).toBe('u_admin')
  })

  // ── Assign ticket ────────────────────────────────────────────────

  it('assigns a ticket to an admin', async () => {
    const createResult = await executeCreateTicket(db, {
      createdByUserId: 'u_customer',
      subject: 'Test',
      body: 'Test body',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return

    const result = await executeAssignTicket(
      db,
      'u_admin',
      createResult.id!,
      'u_admin2',
    )
    expect(result.ok).toBe(true)

    const detail = await loadTicketDetail(db, createResult.id!)
    expect(detail!.ticket.assignedToAdminId).toBe('u_admin2')
  })

  it('writes audit log on assignment', async () => {
    const createResult = await executeCreateTicket(db, {
      createdByUserId: 'u_customer',
      subject: 'Test',
      body: 'Body',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return

    await executeAssignTicket(db, 'u_admin', createResult.id!, 'u_admin2')

    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'admin.support_ticket.assign'))
    expect(logs).toHaveLength(1)
  })

  // ── Add message ──────────────────────────────────────────────────

  it('adds a message to an open ticket', async () => {
    const createResult = await executeCreateTicket(db, {
      createdByUserId: 'u_customer',
      subject: 'Test',
      body: 'Initial message',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return

    const msgResult = await executeAddMessage(
      db,
      createResult.id!,
      'u_admin',
      'We are looking into this.',
    )
    expect(msgResult.ok).toBe(true)

    const detail = await loadTicketDetail(db, createResult.id!)
    expect(detail!.messages).toHaveLength(2)
    const bodies = detail!.messages.map((m) => m.body)
    expect(bodies).toContain('Initial message')
    expect(bodies).toContain('We are looking into this.')
  })

  it('rejects adding message to a closed ticket', async () => {
    const createResult = await executeCreateTicket(db, {
      createdByUserId: 'u_customer',
      subject: 'Test',
      body: 'Body',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return

    // Advance to closed
    await executeChangeTicketStatus(db, 'u_admin', createResult.id!, 'in_progress')
    await executeChangeTicketStatus(db, 'u_admin', createResult.id!, 'resolved')
    await executeChangeTicketStatus(db, 'u_admin', createResult.id!, 'closed')

    const result = await executeAddMessage(
      db,
      createResult.id!,
      'u_customer',
      'More info',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('closed')
  })

  it('rejects empty message body', async () => {
    const createResult = await executeCreateTicket(db, {
      createdByUserId: 'u_customer',
      subject: 'Test',
      body: 'Body',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return

    const result = await executeAddMessage(db, createResult.id!, 'u_admin', '   ')
    expect(result.ok).toBe(false)
  })

  // ── Filters ──────────────────────────────────────────────────────

  it('filters tickets by status', async () => {
    await executeCreateTicket(db, {
      createdByUserId: 'u_customer',
      subject: 'Ticket 1',
      body: 'Body',
    })
    const r2 = await executeCreateTicket(db, {
      createdByUserId: 'u_customer',
      subject: 'Ticket 2',
      body: 'Body',
    })
    if (r2.ok) {
      await executeChangeTicketStatus(db, 'u_admin', r2.id!, 'in_progress')
    }

    const openTickets = await loadTicketsList(db, { status: 'open' })
    expect(openTickets).toHaveLength(1)
    expect(openTickets[0]!.subject).toBe('Ticket 1')

    const inProgressTickets = await loadTicketsList(db, { status: 'in_progress' })
    expect(inProgressTickets).toHaveLength(1)
    expect(inProgressTickets[0]!.subject).toBe('Ticket 2')
  })
})
