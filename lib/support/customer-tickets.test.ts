import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { supportMessages, supportTickets } from '@/db/schema/support-tickets'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  createCustomerTicket,
  getMyTicketThread,
  listMyTickets,
  replyToMyTicket,
} from './customer-tickets'

describe('customer support tickets', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_owner', email: 'owner@test.com', name: 'Owner' },
      { id: 'u_other', email: 'other@test.com', name: 'Other' },
      { id: 'u_admin', email: 'admin@switchback.com', name: 'Admin' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE support_messages, support_tickets CASCADE`,
    )
  })

  // ── createCustomerTicket ───────────────────────────────────────────

  it('creates a ticket plus the first message', async () => {
    const result = await createCustomerTicket(db, 'u_owner', {
      subject: 'Refund not received',
      category: 'payment',
      message: 'I cancelled but no refund has arrived.',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.id).toBeTruthy()

    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, result.id))
    expect(ticket).toBeTruthy()
    expect(ticket!.createdByUserId).toBe('u_owner')
    expect(ticket!.status).toBe('open')
    expect(ticket!.priority).toBe('medium')
    expect(ticket!.category).toBe('payment')
    expect(ticket!.subject).toBe('Refund not received')

    const messages = await db
      .select()
      .from(supportMessages)
      .where(eq(supportMessages.ticketId, result.id))
    expect(messages).toHaveLength(1)
    expect(messages[0]!.senderUserId).toBe('u_owner')
    expect(messages[0]!.body).toBe('I cancelled but no refund has arrived.')
  })

  it('defaults category to "other" when omitted', async () => {
    const result = await createCustomerTicket(db, 'u_owner', {
      subject: 'General question',
      message: 'How do I change my email?',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, result.id))
    expect(ticket!.category).toBe('other')
  })

  it('rejects an empty subject', async () => {
    const result = await createCustomerTicket(db, 'u_owner', {
      subject: '   ',
      category: 'other',
      message: 'A valid message body.',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects an empty message', async () => {
    const result = await createCustomerTicket(db, 'u_owner', {
      subject: 'Valid subject',
      category: 'other',
      message: '',
    })
    expect(result.ok).toBe(false)
  })

  // ── listMyTickets ──────────────────────────────────────────────────

  it('lists only the owner tickets, newest first', async () => {
    const first = await createCustomerTicket(db, 'u_owner', {
      subject: 'First ticket',
      message: 'body one',
    })
    const second = await createCustomerTicket(db, 'u_owner', {
      subject: 'Second ticket',
      message: 'body two',
    })
    // Another user's ticket must NOT be returned.
    await createCustomerTicket(db, 'u_other', {
      subject: 'Foreign ticket',
      message: 'not yours',
    })

    expect(first.ok && second.ok).toBe(true)

    const tickets = await listMyTickets(db, 'u_owner')
    expect(tickets).toHaveLength(2)
    expect(tickets.every((t) => t.createdByUserId === 'u_owner')).toBe(true)
    const subjects = tickets.map((t) => t.subject)
    expect(subjects).toContain('First ticket')
    expect(subjects).toContain('Second ticket')
    expect(subjects).not.toContain('Foreign ticket')
    // Newest first: the second-created ticket appears before the first.
    expect(subjects[0]).toBe('Second ticket')
  })

  it('returns an empty list for a user with no tickets', async () => {
    const tickets = await listMyTickets(db, 'u_owner')
    expect(tickets).toEqual([])
  })

  // ── getMyTicketThread ──────────────────────────────────────────────

  it('returns the owner ticket with ordered messages', async () => {
    const created = await createCustomerTicket(db, 'u_owner', {
      subject: 'Thread test',
      message: 'first message',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    await replyToMyTicket(db, 'u_owner', created.id, 'second message')

    const thread = await getMyTicketThread(db, 'u_owner', created.id)
    expect(thread).not.toBeNull()
    expect(thread!.ticket.subject).toBe('Thread test')
    expect(thread!.messages).toHaveLength(2)
    expect(thread!.messages[0]!.body).toBe('first message')
    expect(thread!.messages[1]!.body).toBe('second message')
  })

  it('returns null when the ticket belongs to another user', async () => {
    const created = await createCustomerTicket(db, 'u_other', {
      subject: 'Not yours',
      message: 'private',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const thread = await getMyTicketThread(db, 'u_owner', created.id)
    expect(thread).toBeNull()
  })

  it('returns null for a non-existent ticket', async () => {
    const thread = await getMyTicketThread(
      db,
      'u_owner',
      '00000000-0000-0000-0000-000000000000',
    )
    expect(thread).toBeNull()
  })

  // ── replyToMyTicket ────────────────────────────────────────────────

  it('appends a reply from the customer', async () => {
    const created = await createCustomerTicket(db, 'u_owner', {
      subject: 'Reply test',
      message: 'initial',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const reply = await replyToMyTicket(db, 'u_owner', created.id, 'a follow-up')
    expect(reply.ok).toBe(true)

    const thread = await getMyTicketThread(db, 'u_owner', created.id)
    expect(thread!.messages).toHaveLength(2)
    const last = thread!.messages[thread!.messages.length - 1]!
    expect(last.body).toBe('a follow-up')
    expect(last.senderUserId).toBe('u_owner')
  })

  it('rejects a reply to a foreign ticket', async () => {
    const created = await createCustomerTicket(db, 'u_other', {
      subject: 'Foreign',
      message: 'private',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const reply = await replyToMyTicket(db, 'u_owner', created.id, 'sneaky')
    expect(reply.ok).toBe(false)

    const messages = await db
      .select()
      .from(supportMessages)
      .where(eq(supportMessages.ticketId, created.id))
    expect(messages).toHaveLength(1)
  })

  it('rejects an empty reply body', async () => {
    const created = await createCustomerTicket(db, 'u_owner', {
      subject: 'Empty reply',
      message: 'initial',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const reply = await replyToMyTicket(db, 'u_owner', created.id, '   ')
    expect(reply.ok).toBe(false)
  })

  it('rejects a reply on a closed ticket (mirrors admin rule)', async () => {
    const created = await createCustomerTicket(db, 'u_owner', {
      subject: 'Closed ticket',
      message: 'initial',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    // Drive the ticket to closed directly (admin lifecycle is forward-only).
    await db
      .update(supportTickets)
      .set({ status: 'closed' })
      .where(eq(supportTickets.id, created.id))

    const reply = await replyToMyTicket(db, 'u_owner', created.id, 'still there?')
    expect(reply.ok).toBe(false)
    if (reply.ok) return
    expect(reply.error.toLowerCase()).toContain('closed')

    const messages = await db
      .select()
      .from(supportMessages)
      .where(eq(supportMessages.ticketId, created.id))
    expect(messages).toHaveLength(1)
  })
})
