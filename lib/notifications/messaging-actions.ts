'use server'

import { and, eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'

import { db } from '@/db/client'
import { conversations } from '@/db/schema/conversations'
import { messages } from '@/db/schema/messages'
import { auth } from '@/lib/auth'
import { resolveActingVendorScope } from '@/lib/auth/permissions'

import {
  getConversationMessagesForShop,
  getVendorConversationsForShop,
  sendVendorMessage,
  type ConversationThread,
  type SendVendorMessageResult,
  type VendorConversationRow,
} from './messaging'

/**
 * Vendor messaging Server Actions (issue #11 security review).
 *
 * SECURITY: every export here is a client-callable endpoint, so each one
 * derives the trusted session id and resolves the acting SHOP server-side
 * (`resolveActingVendorScope`) before delegating to the shop-scoped,
 * db-injected cores in `./messaging`. NO function trusts a client-supplied
 * shop id or sender id. The conversation-ownership predicate
 * (`vendorUserId = shop`) lives inside the cores' WHERE clauses, so a member
 * can only ever read/send in their own shop's conversations — a guessed UUID
 * for another shop returns null / a denial envelope, never the foreign row.
 *
 * These cores are vendor-only: no customer messaging surface exists in the
 * app, and nothing outside the `/vendor/messages` pages imports them.
 */

/** Resolve the acting human's shop, or null when there is no vendor context. */
async function resolveActingShop(): Promise<{
  shop: string
  acting: string
} | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return null
  }
  const scope = await resolveActingVendorScope(db, session.user.id)
  if (!scope) {
    return null
  }
  return { shop: scope.vendorUserId, acting: session.user.id }
}

/**
 * Fetch the inbox conversations for the acting user's resolved shop.
 * Returns an empty list when there is no vendor context (the page-level gate
 * in the `(dashboard)` layout already redirects such users; this is defensive).
 */
export async function getVendorConversations(): Promise<VendorConversationRow[]> {
  const ctx = await resolveActingShop()
  if (!ctx) {
    return []
  }
  return getVendorConversationsForShop(db, ctx.shop)
}

/**
 * Load a single conversation's thread, scoped to the acting user's shop.
 * Returns null when there is no vendor context OR the conversation does not
 * belong to the acting shop (cross-shop IDOR is closed at the DB layer).
 */
export async function getConversationMessages(
  conversationId: string,
): Promise<ConversationThread | null> {
  const ctx = await resolveActingShop()
  if (!ctx) {
    return null
  }
  return getConversationMessagesForShop(db, conversationId, ctx.shop)
}

/**
 * Send a message in a conversation (Server Action for the UI).
 *
 * The sender is DERIVED from the session (issue #11 FIX 2) — the client no
 * longer supplies a sender id, so a forged sender can't post as another user.
 * The send is scoped to the acting shop: a member can only post into their own
 * shop's conversations (DB-enforced in `sendVendorMessage`).
 */
export async function sendMessageAction(
  conversationId: string,
  body: string,
): Promise<SendVendorMessageResult> {
  const ctx = await resolveActingShop()
  if (!ctx) {
    return { ok: false, error: 'You do not have permission to send this message.' }
  }
  return sendVendorMessage(db, {
    conversationId,
    shopUserId: ctx.shop,
    senderUserId: ctx.acting,
    body,
  })
}

/**
 * Mark all messages in a conversation as read by the acting user, scoped to
 * the acting user's shop. A no-op when there is no vendor context or the
 * conversation does not belong to the acting shop (cross-shop guard).
 */
export async function markConversationMessagesRead(
  conversationId: string,
): Promise<void> {
  const ctx = await resolveActingShop()
  if (!ctx) {
    return
  }

  // Guard: only touch conversations owned by the acting shop.
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.vendorUserId, ctx.shop),
      ),
    )
    .limit(1)

  if (!conv) {
    return
  }

  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(messages.conversationId, conversationId),
        sql`${messages.senderUserId} != ${ctx.acting}`,
        sql`${messages.readAt} IS NULL`,
      ),
    )
}
