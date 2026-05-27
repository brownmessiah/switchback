import { and, asc, eq } from 'drizzle-orm'

import { conversations } from '@/db/schema/conversations'
import { messages } from '@/db/schema/messages'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Send a message within an existing conversation.
 * Returns the created message row.
 */
export interface SendMessageArgs {
  readonly conversationId: string
  readonly senderUserId: string
  readonly body: string
}

export interface SendMessageResult {
  readonly messageId: string
  readonly createdAt: Date
}

export async function sendMessage(
  db: DBOrTx,
  args: SendMessageArgs,
): Promise<SendMessageResult> {
  if (!args.body.trim()) {
    throw new Error('Message body must not be empty')
  }

  const [row] = await db
    .insert(messages)
    .values({
      conversationId: args.conversationId,
      senderUserId: args.senderUserId,
      body: args.body,
    })
    .returning({ id: messages.id, createdAt: messages.createdAt })

  // Touch the conversation's updatedAt
  await db
    .update(conversations)
    .set({ updatedAt: row!.createdAt })
    .where(eq(conversations.id, args.conversationId))

  return {
    messageId: row!.id,
    createdAt: row!.createdAt,
  }
}

/**
 * First-response SLA computation.
 *
 * Measures the time between conversation creation and the vendor's
 * first reply. Returns the duration in milliseconds, or null if the
 * vendor has not replied yet.
 */
export interface SlaResult {
  readonly firstResponseMs: number | null
  readonly conversationCreatedAt: Date
  readonly vendorFirstReplyAt: Date | null
}

export async function computeFirstResponseSla(
  db: DBOrTx,
  conversationId: string,
): Promise<SlaResult> {
  // Load the conversation to get vendorUserId and createdAt
  const [conv] = await db
    .select({
      vendorUserId: conversations.vendorUserId,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)

  if (!conv) {
    throw new Error(`Conversation ${conversationId} not found`)
  }

  // Find the vendor's first message (earliest by createdAt)
  const [firstVendorMsg] = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.senderUserId, conv.vendorUserId),
      ),
    )
    .orderBy(asc(messages.createdAt))
    .limit(1)

  if (!firstVendorMsg) {
    return {
      firstResponseMs: null,
      conversationCreatedAt: conv.createdAt,
      vendorFirstReplyAt: null,
    }
  }

  const firstResponseMs =
    firstVendorMsg.createdAt.getTime() - conv.createdAt.getTime()

  return {
    firstResponseMs,
    conversationCreatedAt: conv.createdAt,
    vendorFirstReplyAt: firstVendorMsg.createdAt,
  }
}
