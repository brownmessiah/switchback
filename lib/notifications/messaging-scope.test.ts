import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { conversations } from '@/db/schema/conversations'
import { messages } from '@/db/schema/messages'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  getConversationMessagesForShop,
  getVendorConversationsForShop,
  sendVendorMessage,
} from './messaging'

/**
 * Cross-shop scope + sender-spoofing tests for the vendor messaging surface
 * (issue #11 security review). These lock in the two MEDIUM findings:
 *
 *   FIX 1 — a member/owner of shop A loading shop B's conversation gets null
 *           (the loader filters `vendorUserId = shop`), while shop A's own
 *           conversation loads.
 *   FIX 2 — the vendor send core derives nothing from the client: it refuses
 *           to post into a conversation that does not belong to the acting
 *           shop, and the sender is the shop owner / acting human (never a
 *           client-supplied id).
 */
describe('vendor messaging scope (issue #11)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  const shopA = 'u_shop_a'
  const shopB = 'u_shop_b'
  const custA = 'u_cust_a'
  const custB = 'u_cust_b'

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE messages CASCADE`)
    await db.execute(sql`TRUNCATE TABLE conversations CASCADE`)
    await db.execute(sql`TRUNCATE TABLE users CASCADE`)
    await db.insert(users).values([
      { id: shopA, email: 'shopa@test.com', name: 'Shop A' },
      { id: shopB, email: 'shopb@test.com', name: 'Shop B' },
      { id: custA, email: 'custa@test.com', name: 'Customer A' },
      { id: custB, email: 'custb@test.com', name: 'Customer B' },
    ])
  })

  async function seedConversation(
    vendorUserId: string,
    customerUserId: string,
    subject: string,
  ): Promise<string> {
    const [conv] = await db
      .insert(conversations)
      .values({ vendorUserId, customerUserId, subject })
      .returning({ id: conversations.id })
    return conv!.id
  }

  // ── FIX 1: cross-shop conversation read isolation ──────────────────
  describe('getConversationMessagesForShop', () => {
    it("returns null when the conversation belongs to ANOTHER shop", async () => {
      const convB = await seedConversation(shopB, custB, 'B private thread')

      // Shop A tries to open shop B's conversation by guessing the UUID.
      const result = await getConversationMessagesForShop(db, convB, shopA)
      expect(result).toBeNull()
    })

    it("loads the conversation when it belongs to the acting shop", async () => {
      const convA = await seedConversation(shopA, custA, 'A own thread')
      await db.insert(messages).values({
        conversationId: convA,
        senderUserId: custA,
        body: 'Hello shop A',
      })

      const result = await getConversationMessagesForShop(db, convA, shopA)
      expect(result).not.toBeNull()
      expect(result!.conversation.id).toBe(convA)
      expect(result!.conversation.vendorUserId).toBe(shopA)
      expect(result!.messages).toHaveLength(1)
    })

    it('returns null for a non-existent conversation', async () => {
      const result = await getConversationMessagesForShop(
        db,
        '00000000-0000-0000-0000-000000000000',
        shopA,
      )
      expect(result).toBeNull()
    })
  })

  // ── FIX 1: inbox is scoped to the shop ─────────────────────────────
  describe('getVendorConversationsForShop', () => {
    it('returns only the acting shop conversations, never another shop', async () => {
      await seedConversation(shopA, custA, 'A thread')
      await seedConversation(shopB, custB, 'B thread')

      const rowsA = await getVendorConversationsForShop(db, shopA)
      expect(rowsA).toHaveLength(1)
      expect(rowsA[0]!.subject).toBe('A thread')
    })
  })

  // ── FIX 2: vendor send is scoped to the shop + sender derived ──────
  describe('sendVendorMessage', () => {
    it("refuses to post into ANOTHER shop's conversation", async () => {
      const convB = await seedConversation(shopB, custB, 'B thread')

      // Acting shop A, with shop A's owner as derived sender, must not be able
      // to post into shop B's conversation.
      const result = await sendVendorMessage(db, {
        conversationId: convB,
        shopUserId: shopA,
        senderUserId: shopA,
        body: 'I should not be here',
      })
      expect(result.ok).toBe(false)

      // Nothing was written.
      const rows = await db.select().from(messages)
      expect(rows).toHaveLength(0)
    })

    it("posts into the acting shop's own conversation as the derived sender", async () => {
      const convA = await seedConversation(shopA, custA, 'A thread')

      const result = await sendVendorMessage(db, {
        conversationId: convA,
        shopUserId: shopA,
        senderUserId: shopA,
        body: 'Reply from shop A',
      })
      expect(result.ok).toBe(true)

      const rows = await db.select().from(messages)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.senderUserId).toBe(shopA)
      expect(rows[0]!.conversationId).toBe(convA)
    })
  })
})
