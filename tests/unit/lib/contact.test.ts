import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { supportMessages, supportTickets } from '@/db/schema'
import {
  CONTACT_CATEGORY_TO_TICKET_CATEGORY,
  createContactTicket,
} from '@/lib/support/contact'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

/**
 * QA fix pass: the /contact form gains an issue-category select and an
 * optional Booking ID. Categories map onto the EXISTING ticket_category enum
 * (no new enum values — RECONCILIATION §1 keeps the schema authoritative);
 * the precise form label and the Booking ID travel in the first message body
 * so ops never loses the submitter's intent.
 */
describe('createContactTicket — category + booking reference', () => {
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

  function baseInput() {
    return {
      name: 'Asha',
      email: 'asha@example.com',
      subject: 'Need help',
      message: 'My rafting booking has a date problem, please help.',
    }
  }

  it('maps every form category onto an existing ticket_category value', () => {
    expect(CONTACT_CATEGORY_TO_TICKET_CATEGORY).toEqual({
      bookingIssue: 'booking',
      paymentIssue: 'payment',
      refundCancellation: 'cancellation',
      vendorSupport: 'other',
      safetyConcern: 'experience',
      generalQuestion: 'other',
    })
  })

  it('stores the mapped ticket category for a booking issue', async () => {
    const result = await createContactTicket(db, {
      ...baseInput(),
      category: 'bookingIssue',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [ticket] = await db
      .select({ category: supportTickets.category })
      .from(supportTickets)
      .where(eq(supportTickets.id, result.ticketId))
    expect(ticket.category).toBe('booking')
  })

  it('records the form category and Booking ID in the first message body', async () => {
    const result = await createContactTicket(db, {
      ...baseInput(),
      category: 'safetyConcern',
      bookingId: 'BK-1234-ABCD',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [msg] = await db
      .select({ body: supportMessages.body })
      .from(supportMessages)
      .where(eq(supportMessages.ticketId, result.ticketId))
    expect(msg.body).toContain('Category: safetyConcern')
    expect(msg.body).toContain('Booking ID: BK-1234-ABCD')
  })

  it('omits the Booking ID line when none is given and defaults category to other', async () => {
    const result = await createContactTicket(db, baseInput())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [ticket] = await db
      .select({ category: supportTickets.category })
      .from(supportTickets)
      .where(eq(supportTickets.id, result.ticketId))
    expect(ticket.category).toBe('other')

    const [msg] = await db
      .select({ body: supportMessages.body })
      .from(supportMessages)
      .where(eq(supportMessages.ticketId, result.ticketId))
    expect(msg.body).not.toContain('Booking ID:')
  })

  it('rejects an unknown category value', async () => {
    const result = await createContactTicket(db, {
      ...baseInput(),
      category: 'spam-category',
    })

    expect(result.ok).toBe(false)
  })
})
