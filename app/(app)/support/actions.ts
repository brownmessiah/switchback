'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import {
  createCustomerTicket,
  replyToMyTicket,
  type CustomerReplyResult,
  type CustomerTicketResult,
} from '@/lib/support/customer-tickets'

const CATEGORIES = [
  'booking',
  'payment',
  'experience',
  'account',
  'cancellation',
  'other',
] as const

type Category = (typeof CATEGORIES)[number]

function normaliseCategory(raw: string): Category {
  return (CATEGORIES as readonly string[]).includes(raw) ? (raw as Category) : 'other'
}

/**
 * Create a support ticket for the signed-in customer. Unauthenticated callers
 * get `{ ok: false, error: 'unauthenticated' }` so the client can redirect to
 * /sign-in without the action ever touching the database.
 */
export async function createSupportTicketAction(
  subject: string,
  category: string,
  message: string,
): Promise<CustomerTicketResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'unauthenticated' }

  const result = await createCustomerTicket(db, session.user.id, {
    subject,
    category: normaliseCategory(category),
    message,
  })

  if (result.ok) revalidatePath('/support')
  return result
}

/**
 * Append a reply to one of the signed-in customer's own tickets. Ownership and
 * closed-state rules are enforced inside the pure core.
 */
export async function replySupportTicketAction(
  ticketId: string,
  body: string,
): Promise<CustomerReplyResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'unauthenticated' }

  const result = await replyToMyTicket(db, session.user.id, ticketId, body)

  if (result.ok) {
    revalidatePath('/support')
    revalidatePath(`/support/${ticketId}`)
  }
  return result
}
