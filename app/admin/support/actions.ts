'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'
import {
  executeAddMessage,
  executeAssignTicket,
  executeChangeTicketStatus,
  executeCreateTicket,
  type TicketActionResult,
} from '@/lib/admin/support-ticket-actions'

export async function createTicketAction(
  subject: string,
  priority: string,
  category: string,
  body: string,
): Promise<TicketActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const result = await executeCreateTicket(prodDb, {
    createdByUserId: session.user.id,
    subject,
    priority,
    category,
    body,
  })

  if (result.ok) revalidatePath('/admin/support')
  return result
}

export async function changeTicketStatusAction(
  ticketId: string,
  newStatus: string,
): Promise<TicketActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const result = await executeChangeTicketStatus(
    prodDb,
    session.user.id,
    ticketId,
    newStatus,
  )

  if (result.ok) {
    revalidatePath('/admin/support')
    revalidatePath(`/admin/support/${ticketId}`)
  }
  return result
}

export async function assignTicketAction(
  ticketId: string,
  assignedToAdminId: string,
): Promise<TicketActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const result = await executeAssignTicket(
    prodDb,
    session.user.id,
    ticketId,
    assignedToAdminId,
  )

  if (result.ok) {
    revalidatePath('/admin/support')
    revalidatePath(`/admin/support/${ticketId}`)
  }
  return result
}

export async function addMessageAction(
  ticketId: string,
  body: string,
): Promise<TicketActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const result = await executeAddMessage(
    prodDb,
    ticketId,
    session.user.id,
    body,
  )

  if (result.ok) {
    revalidatePath(`/admin/support/${ticketId}`)
  }
  return result
}
