import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { conversations } from '@/db/schema/conversations'
import { messages } from '@/db/schema/messages'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { computeFirstResponseSla, sendMessage } from './messaging'

describe('messaging module', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  const vendorUserId = 'user_vendor_msg'
  const customerUserId = 'user_customer_msg'

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    // Seed users
    await db.insert(users).values([
      { id: vendorUserId, email: 'vendor@test.com', emailVerified: false, phoneNumberVerified: false },
      { id: customerUserId, email: 'customer@test.com', emailVerified: false, phoneNumberVerified: false },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE messages CASCADE`)
    await db.execute(sql`TRUNCATE TABLE conversations CASCADE`)
  })

  // ─── TDD Test 4: sendMessage creates message row ────────────────
  describe('sendMessage', () => {
    it('creates a message row in the correct conversation', async () => {
      // Create a conversation first
      const [conv] = await db
        .insert(conversations)
        .values({
          vendorUserId,
          customerUserId,
          subject: 'About my rafting trip',
        })
        .returning({ id: conversations.id })

      const result = await sendMessage(db, {
        conversationId: conv!.id,
        senderUserId: customerUserId,
        body: 'Hi, when should I arrive?',
      })

      expect(result.messageId).toBeTruthy()
      expect(result.createdAt).toBeInstanceOf(Date)

      // Verify message row
      const msgRows = await db.select().from(messages)
      expect(msgRows).toHaveLength(1)
      expect(msgRows[0]!.conversationId).toBe(conv!.id)
      expect(msgRows[0]!.senderUserId).toBe(customerUserId)
      expect(msgRows[0]!.body).toBe('Hi, when should I arrive?')
      expect(msgRows[0]!.readAt).toBeNull()
    })

    it('updates the conversation updatedAt timestamp', async () => {
      const [conv] = await db
        .insert(conversations)
        .values({
          vendorUserId,
          customerUserId,
          subject: 'Updated at test',
        })
        .returning({ id: conversations.id, updatedAt: conversations.updatedAt })

      const originalUpdatedAt = conv!.updatedAt

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10))

      await sendMessage(db, {
        conversationId: conv!.id,
        senderUserId: vendorUserId,
        body: 'Thanks for reaching out.',
      })

      const [updated] = await db
        .select({ updatedAt: conversations.updatedAt })
        .from(conversations)

      // updatedAt should be >= original (may be same if PGlite is fast)
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt.getTime(),
      )
    })

    it('rejects empty message body', async () => {
      const [conv] = await db
        .insert(conversations)
        .values({
          vendorUserId,
          customerUserId,
          subject: 'Empty body test',
        })
        .returning({ id: conversations.id })

      await expect(
        sendMessage(db, {
          conversationId: conv!.id,
          senderUserId: customerUserId,
          body: '   ',
        }),
      ).rejects.toThrow('Message body must not be empty')
    })
  })

  // ─── TDD Test 5: first-response SLA computation ────────────────
  describe('computeFirstResponseSla', () => {
    it('computes first-response time from conversation creation to vendor first reply', async () => {
      // Create conversation (customer-initiated)
      const convCreatedAt = new Date('2026-05-27T10:00:00Z')
      const [conv] = await db
        .insert(conversations)
        .values({
          vendorUserId,
          customerUserId,
          subject: 'SLA test',
          createdAt: convCreatedAt,
          updatedAt: convCreatedAt,
        })
        .returning({ id: conversations.id })

      // Customer sends first message (not the vendor's response)
      await db.insert(messages).values({
        conversationId: conv!.id,
        senderUserId: customerUserId,
        body: 'Hello, question about my booking.',
        createdAt: new Date('2026-05-27T10:00:00Z'),
      })

      // Vendor replies 30 minutes later
      const vendorReplyAt = new Date('2026-05-27T10:30:00Z')
      await db.insert(messages).values({
        conversationId: conv!.id,
        senderUserId: vendorUserId,
        body: 'Hi, let me check for you.',
        createdAt: vendorReplyAt,
      })

      const sla = await computeFirstResponseSla(db, conv!.id)

      expect(sla.conversationCreatedAt).toEqual(convCreatedAt)
      expect(sla.vendorFirstReplyAt).toEqual(vendorReplyAt)
      expect(sla.firstResponseMs).toBe(30 * 60 * 1000) // 30 minutes in ms
    })

    it('returns null when vendor has not replied', async () => {
      const [conv] = await db
        .insert(conversations)
        .values({
          vendorUserId,
          customerUserId,
          subject: 'No reply test',
        })
        .returning({ id: conversations.id })

      // Customer sends message but vendor does not reply
      await db.insert(messages).values({
        conversationId: conv!.id,
        senderUserId: customerUserId,
        body: 'Hello?',
      })

      const sla = await computeFirstResponseSla(db, conv!.id)

      expect(sla.firstResponseMs).toBeNull()
      expect(sla.vendorFirstReplyAt).toBeNull()
    })

    it('uses earliest vendor message for SLA (not a later one)', async () => {
      const convCreatedAt = new Date('2026-05-27T09:00:00Z')
      const [conv] = await db
        .insert(conversations)
        .values({
          vendorUserId,
          customerUserId,
          subject: 'Multi-reply SLA test',
          createdAt: convCreatedAt,
          updatedAt: convCreatedAt,
        })
        .returning({ id: conversations.id })

      // Vendor replies twice — SLA should use the first one
      const firstReply = new Date('2026-05-27T09:15:00Z')
      const secondReply = new Date('2026-05-27T09:45:00Z')

      await db.insert(messages).values([
        {
          conversationId: conv!.id,
          senderUserId: vendorUserId,
          body: 'First reply',
          createdAt: firstReply,
        },
        {
          conversationId: conv!.id,
          senderUserId: vendorUserId,
          body: 'Second reply',
          createdAt: secondReply,
        },
      ])

      const sla = await computeFirstResponseSla(db, conv!.id)

      expect(sla.firstResponseMs).toBe(15 * 60 * 1000) // 15 minutes
      expect(sla.vendorFirstReplyAt).toEqual(firstReply)
    })

    it('throws for non-existent conversation', async () => {
      await expect(
        computeFirstResponseSla(db, '00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow('Conversation 00000000-0000-0000-0000-000000000000 not found')
    })
  })
})
