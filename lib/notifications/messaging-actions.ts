'use server'

import { and, asc, desc, eq, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { conversations } from '@/db/schema/conversations'
import { messages } from '@/db/schema/messages'
import { users } from '@/db/schema/users'

import { sendMessage as sendMessageCore } from './messaging'

/**
 * Fetch conversations for a vendor user (inbox view).
 */
export async function getVendorConversations(vendorUserId: string) {
  const rows = await db
    .select({
      id: conversations.id,
      customerUserId: conversations.customerUserId,
      customerName: users.name,
      subject: conversations.subject,
      status: conversations.status,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .leftJoin(users, eq(conversations.customerUserId, users.id))
    .where(eq(conversations.vendorUserId, vendorUserId))
    .orderBy(desc(conversations.updatedAt))

  return rows
}

/**
 * Fetch messages in a conversation (thread view).
 */
export async function getConversationMessages(conversationId: string) {
  const [conv] = await db
    .select({
      id: conversations.id,
      vendorUserId: conversations.vendorUserId,
      customerUserId: conversations.customerUserId,
      subject: conversations.subject,
      status: conversations.status,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)

  if (!conv) {
    return null
  }

  const msgs = await db
    .select({
      id: messages.id,
      senderUserId: messages.senderUserId,
      senderName: users.name,
      body: messages.body,
      readAt: messages.readAt,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .leftJoin(users, eq(messages.senderUserId, users.id))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))

  return {
    conversation: conv,
    messages: msgs,
  }
}

/**
 * Send a message in a conversation (Server Action for the UI).
 */
export async function sendMessageAction(
  conversationId: string,
  senderUserId: string,
  body: string,
) {
  const result = await sendMessageCore(db, {
    conversationId,
    senderUserId,
    body,
  })

  return result
}

/**
 * Mark all messages in a conversation as read by a specific user.
 * (When a user opens a thread, mark the other party's messages as read.)
 */
export async function markConversationMessagesRead(
  conversationId: string,
  readerUserId: string,
) {
  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(messages.conversationId, conversationId),
        sql`${messages.senderUserId} != ${readerUserId}`,
        sql`${messages.readAt} IS NULL`,
      ),
    )
}
