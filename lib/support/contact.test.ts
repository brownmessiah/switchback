import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  supportMessages,
  supportTickets,
  users,
} from '@/db/schema'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  contactSchema,
  createContactTicket,
  GUEST_CONTACT_USER_ID,
} from './contact'

// ---------------------------------------------------------------------------
// Zod schema validation
// ---------------------------------------------------------------------------
describe('contactSchema', () => {
  const valid = {
    name: 'Asha Verma',
    email: 'asha@example.com',
    subject: 'Question about a Booking',
    message: 'I would like to know more about my upcoming rafting trip.',
  }

  it('accepts a fully valid submission', () => {
    expect(contactSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid email', () => {
    const r = contactSchema.safeParse({ ...valid, email: 'not-an-email' })
    expect(r.success).toBe(false)
  })

  it('rejects an empty name', () => {
    const r = contactSchema.safeParse({ ...valid, name: '   ' })
    expect(r.success).toBe(false)
  })

  it('rejects an empty subject', () => {
    const r = contactSchema.safeParse({ ...valid, subject: '' })
    expect(r.success).toBe(false)
  })

  it('rejects a too-short message', () => {
    const r = contactSchema.safeParse({ ...valid, message: 'hi' })
    expect(r.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createContactTicket — the testable DB core (PGlite)
// ---------------------------------------------------------------------------
describe('createContactTicket', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE support_messages, support_tickets, users CASCADE`,
    )
  })

  const input = {
    name: 'Ravi Kumar',
    email: 'ravi@example.com',
    subject: 'Refund balance question',
    message: 'When does my Refund balance become cashable to my bank account?',
  }

  it('creates the guest-contact system User, a support_ticket, and a support_message', async () => {
    const result = await createContactTicket(db, input)
    expect(result.ok).toBe(true)

    const guests = await db.select().from(users)
    expect(guests).toHaveLength(1)
    expect(guests[0].id).toBe(GUEST_CONTACT_USER_ID)
    expect(guests[0].email).toBe('guest-contact@switchback.system')

    const tickets = await db.select().from(supportTickets)
    expect(tickets).toHaveLength(1)
    expect(tickets[0].createdByUserId).toBe(GUEST_CONTACT_USER_ID)
    expect(tickets[0].status).toBe('open')
    expect(tickets[0].priority).toBe('medium')
    expect(tickets[0].category).toBe('other')
    // Subject carries the submitter name + their subject.
    expect(tickets[0].subject).toContain('Ravi Kumar')
    expect(tickets[0].subject).toContain('Refund balance question')

    const messages = await db.select().from(supportMessages)
    expect(messages).toHaveLength(1)
    expect(messages[0].ticketId).toBe(tickets[0].id)
    expect(messages[0].senderUserId).toBe(GUEST_CONTACT_USER_ID)
    // Body carries the original message PLUS the submitter contact details so
    // an Admin can reply (the guest User has no real inbox).
    expect(messages[0].body).toContain(input.message)
    expect(messages[0].body).toContain('ravi@example.com')
    expect(messages[0].body).toContain('Ravi Kumar')
  })

  it('is idempotent on the guest User across multiple submissions', async () => {
    await createContactTicket(db, input)
    await createContactTicket(db, { ...input, subject: 'A second question' })

    const guests = await db.select().from(users)
    expect(guests).toHaveLength(1) // upsert onConflictDoNothing — one guest User

    const tickets = await db.select().from(supportTickets)
    expect(tickets).toHaveLength(2) // but a distinct ticket per submission

    const messages = await db.select().from(supportMessages)
    expect(messages).toHaveLength(2)
  })

  it('returns ok:false with a field error for an invalid email', async () => {
    const result = await createContactTicket(db, { ...input, email: 'bad' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeTruthy()
    }

    // Nothing was persisted on the failure path.
    expect(await db.select().from(supportTickets)).toHaveLength(0)
    expect(await db.select().from(users)).toHaveLength(0)
  })

  it('returns ok:false for a too-short message and persists nothing', async () => {
    const result = await createContactTicket(db, { ...input, message: 'x' })
    expect(result.ok).toBe(false)
    expect(await db.select().from(supportTickets)).toHaveLength(0)
  })
})
