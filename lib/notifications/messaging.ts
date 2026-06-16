import { and, asc, desc, eq } from 'drizzle-orm'

import { conversations } from '@/db/schema/conversations'
import { messages } from '@/db/schema/messages'
import { users } from '@/db/schema/users'
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

// ── Shop-scoped vendor messaging cores (issue #11 security review) ──────
//
// db-injected, testable cores that the `'use server'` wrappers in
// `messaging-actions.ts` delegate to. Every vendor-side read/send is keyed on
// the RESOLVED shop (`vendor_profiles.user_id`) so a member can only ever see /
// post in their OWN shop's conversations — a guessed UUID for another shop's
// conversation returns null (read) or `{ ok: false }` (send), never the foreign
// row. The acting human's id is the SENDER (derived server-side), never a
// client-supplied value (kills the prior sender-spoofing vector).

/** A row in the vendor inbox list, scoped to one shop. */
export interface VendorConversationRow {
  readonly id: string
  readonly customerUserId: string
  readonly customerName: string | null
  readonly subject: string
  readonly status: 'active' | 'archived'
  readonly createdAt: Date
  readonly updatedAt: Date
}

/**
 * Fetch the inbox conversations that belong to `shopUserId` (the resolved
 * Vendor account). Always filtered by `vendorUserId = shopUserId`, so a member
 * sees the SHOP's conversations and never another shop's.
 */
export async function getVendorConversationsForShop(
  db: DBOrTx,
  shopUserId: string,
): Promise<VendorConversationRow[]> {
  return db
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
    .where(eq(conversations.vendorUserId, shopUserId))
    .orderBy(desc(conversations.updatedAt))
}

/** The thread payload returned by {@link getConversationMessagesForShop}. */
export interface ConversationThread {
  readonly conversation: {
    readonly id: string
    readonly vendorUserId: string
    readonly customerUserId: string
    readonly subject: string
    readonly status: 'active' | 'archived'
    readonly createdAt: Date
  }
  readonly messages: ReadonlyArray<{
    readonly id: string
    readonly senderUserId: string
    readonly senderName: string | null
    readonly body: string
    readonly readAt: Date | null
    readonly createdAt: Date
  }>
}

/**
 * Load a single conversation's thread, ENFORCING that it belongs to the acting
 * shop. The `vendorUserId = shopUserId` predicate is part of the WHERE clause,
 * so a conversation owned by another shop (or a non-existent id) returns `null`
 * — the ownership assertion is a DB-enforced invariant, not a page-level check
 * a future refactor could drop (issue #11 FIX 1).
 */
export async function getConversationMessagesForShop(
  db: DBOrTx,
  conversationId: string,
  shopUserId: string,
): Promise<ConversationThread | null> {
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
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.vendorUserId, shopUserId),
      ),
    )
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

  return { conversation: conv, messages: msgs }
}

/** Result envelope for {@link sendVendorMessage}. */
export type SendVendorMessageResult =
  | { ok: true; messageId: string; createdAt: Date }
  | { ok: false; error: string }

export interface SendVendorMessageArgs {
  readonly conversationId: string
  /** The resolved shop the acting user operates on. */
  readonly shopUserId: string
  /** The acting human's id (session-derived). Becomes the message sender. */
  readonly senderUserId: string
  readonly body: string
}

/**
 * Send a vendor-side message, scoped to the acting shop (issue #11 FIX 2).
 *
 * Authorization is a DB-enforced invariant: the conversation MUST belong to
 * `shopUserId` (`vendorUserId = shopUserId`), so a member cannot post into
 * another shop's conversation even by guessing the UUID. The `senderUserId` is
 * the session-derived acting human (the caller passes the trusted session id —
 * never a client value), so a forged sender id can no longer post as someone
 * else. Returns a typed envelope (no throw on the authz/validation path).
 */
export async function sendVendorMessage(
  db: DBOrTx,
  args: SendVendorMessageArgs,
): Promise<SendVendorMessageResult> {
  if (!args.body.trim()) {
    return { ok: false, error: 'Message body must not be empty' }
  }

  // Ownership gate: the conversation must belong to the acting shop.
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, args.conversationId),
        eq(conversations.vendorUserId, args.shopUserId),
      ),
    )
    .limit(1)

  if (!conv) {
    return { ok: false, error: 'Conversation not found.' }
  }

  const result = await sendMessage(db, {
    conversationId: args.conversationId,
    senderUserId: args.senderUserId,
    body: args.body,
  })

  return { ok: true, messageId: result.messageId, createdAt: result.createdAt }
}
