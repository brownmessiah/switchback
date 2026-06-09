import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { supportMessages, supportTickets } from '@/db/schema/support-tickets'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { createExperienceEnquiry } from './enquiry'

describe('createExperienceEnquiry — Ask-a-Question → Support Ticket (issue 17)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_customer', email: 'customer@test.com', name: 'Customer' },
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

  it('creates a general-enquiry Support Ticket in the experience category', async () => {
    const result = await createExperienceEnquiry(db, 'u_customer', {
      experienceSlug: 'sunrise-trek-triund',
      experienceTitle: 'Sunrise Trek to Triund',
      message: 'Is this beginner friendly for a family with kids?',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.id).toBeTruthy()

    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, result.id))

    expect(ticket).toBeTruthy()
    // Reuses the existing entity: routed to the admin queue as a general
    // enquiry (status open / priority medium), NOT a Dispute.
    expect(ticket!.createdByUserId).toBe('u_customer')
    expect(ticket!.status).toBe('open')
    expect(ticket!.priority).toBe('medium')
    // DECISION D6 — the fitting enum value is 'experience'.
    expect(ticket!.category).toBe('experience')
  })

  it('references the Experience by title in the subject', async () => {
    const result = await createExperienceEnquiry(db, 'u_customer', {
      experienceSlug: 'sunrise-trek-triund',
      experienceTitle: 'Sunrise Trek to Triund',
      message: 'What time does it start?',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, result.id))

    expect(ticket!.subject).toContain('Sunrise Trek to Triund')
  })

  it('stores the customer message + an Experience slug reference in the first message', async () => {
    const result = await createExperienceEnquiry(db, 'u_customer', {
      experienceSlug: 'sunrise-trek-triund',
      experienceTitle: 'Sunrise Trek to Triund',
      message: 'Is this beginner friendly for a family with kids?',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const messages = await db
      .select()
      .from(supportMessages)
      .where(eq(supportMessages.ticketId, result.id))

    expect(messages).toHaveLength(1)
    expect(messages[0]!.senderUserId).toBe('u_customer')
    // The customer's own words are preserved verbatim.
    expect(messages[0]!.body).toContain(
      'Is this beginner friendly for a family with kids?',
    )
    // The Experience is referenced by its slug so admin/support can resolve it
    // without any Vendor PII.
    expect(messages[0]!.body).toContain('sunrise-trek-triund')
  })

  it('embeds NO Vendor PII — only the Experience slug + title', async () => {
    const result = await createExperienceEnquiry(db, 'u_customer', {
      experienceSlug: 'kayaking-in-rishikesh',
      experienceTitle: 'Kayaking in Rishikesh',
      message: 'Can I get the vendor phone number 9876543210?',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, result.id))
    const messages = await db
      .select()
      .from(supportMessages)
      .where(eq(supportMessages.ticketId, result.id))

    const haystack = `${ticket!.subject}\n${messages.map((m) => m.body).join('\n')}`
    // The function must NOT fabricate or look up any Vendor contact details.
    // (The customer's own message is preserved verbatim, but the enquiry core
    // never enriches the ticket with vendor email/phone/personal contact.)
    expect(haystack).toContain('kayaking-in-rishikesh')
    expect(haystack).toContain('Kayaking in Rishikesh')
    // No vendor-contact field is read: the only digits present are whatever the
    // customer themselves typed — nothing the core appended.
    expect(haystack).not.toContain('vendor@')
    expect(haystack).not.toContain('Vendor phone:')
  })

  it('requires a signed-in user', async () => {
    const result = await createExperienceEnquiry(db, '', {
      experienceSlug: 'sunrise-trek-triund',
      experienceTitle: 'Sunrise Trek to Triund',
      message: 'A question.',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects an empty message', async () => {
    const result = await createExperienceEnquiry(db, 'u_customer', {
      experienceSlug: 'sunrise-trek-triund',
      experienceTitle: 'Sunrise Trek to Triund',
      message: '   ',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a missing Experience reference', async () => {
    const result = await createExperienceEnquiry(db, 'u_customer', {
      experienceSlug: '',
      experienceTitle: '',
      message: 'A valid question.',
    })
    expect(result.ok).toBe(false)
  })
})
