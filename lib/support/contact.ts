import { z } from 'zod'

import { supportMessages, supportTickets, users } from '@/db/schema'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Contact-form support backend (Issue 07, Decision 2).
 *
 * A `/contact` submission is NOT a silent no-op or a fake lead form — it
 * creates a real `support_ticket` (+ first `support_message`) under a fixed
 * system "guest-contact" User, so Outvers ops sees the enquiry in the same
 * Support queue as authenticated tickets.
 *
 * The submitter is anonymous (logged-out), so we attribute the ticket to a
 * single dedicated system User (`u_guest_contact`) rather than minting a real
 * account per submission. The submitter's name + email are carried in the
 * message body — never as auth identity — so an Admin can reply by email.
 *
 * `createContactTicket` is the pure, testable DB core: it validates with Zod
 * at the boundary and persists inside a single `db.transaction`. The Next.js
 * `'use server'` wrapper lives in app/[locale]/(marketing)/contact/actions.ts.
 *
 * The message is stored as PLAIN TEXT — we never store raw HTML.
 */

/** Fixed id of the dedicated system User that owns every guest-contact ticket. */
export const GUEST_CONTACT_USER_ID = 'u_guest_contact'
const GUEST_CONTACT_EMAIL = 'guest-contact@outvers.system'
const GUEST_CONTACT_NAME = 'Guest Contact'

export const contactSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name.').max(120),
  email: z.string().trim().email('Please enter a valid email address.').max(254),
  subject: z.string().trim().min(1, 'Please enter a subject.').max(200),
  message: z
    .string()
    .trim()
    .min(10, 'Please enter a message of at least 10 characters.')
    .max(5000),
})

export type ContactInput = z.infer<typeof contactSchema>
/** Loose input shape accepted at the boundary before validation. */
export type ContactRawInput = {
  name: string
  email: string
  subject: string
  message: string
}

export type ContactResult =
  | { ok: true; ticketId: string }
  | { ok: false; error: string }

/**
 * Validate the submission and, on success, atomically:
 *   (a) upsert the fixed `u_guest_contact` system User (idempotent),
 *   (b) insert a `support_tickets` row attributed to that User, and
 *   (c) insert the first `support_messages` row with the message + the
 *       submitter's name/email so an Admin can reply.
 */
export async function createContactTicket(
  db: DBOrTx,
  rawInput: ContactRawInput,
): Promise<ContactResult> {
  const parsed = contactSchema.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Please check the form and try again.',
    }
  }

  const { name, email, subject, message } = parsed.data

  const ticketId = await db.transaction(async (tx) => {
    // (a) Idempotent upsert of the dedicated system User.
    await tx
      .insert(users)
      .values({
        id: GUEST_CONTACT_USER_ID,
        email: GUEST_CONTACT_EMAIL,
        name: GUEST_CONTACT_NAME,
      })
      .onConflictDoNothing()

    // (b) The Support Ticket. Subject carries the submitter name + their
    //     subject so the ops queue reads cleanly at a glance.
    const [ticket] = await tx
      .insert(supportTickets)
      .values({
        createdByUserId: GUEST_CONTACT_USER_ID,
        subject: `Contact: ${name} — ${subject}`,
        category: 'other',
        priority: 'medium',
        status: 'open',
      })
      .returning({ id: supportTickets.id })

    // (c) First message — plain text only. The reply-to details live here
    //     because the guest User has no real inbox.
    const body = [
      message,
      '',
      '— Submitted via the Outvers contact form',
      `From: ${name} <${email}>`,
    ].join('\n')

    await tx.insert(supportMessages).values({
      ticketId: ticket.id,
      senderUserId: GUEST_CONTACT_USER_ID,
      body,
    })

    return ticket.id
  })

  return { ok: true, ticketId }
}
