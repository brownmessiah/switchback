import { z } from 'zod'

import { supportMessages, supportTickets } from '@/db/schema/support-tickets'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Ask-a-Question → Support Ticket (issue 17, DECISION D6).
 *
 * The PDP "Ask a Question" CTA routes a Customer's question into the SAME
 * `support_tickets` / `support_messages` entity that the admin support queue
 * (`app/admin/support`) already drives — as a GENERAL ENQUIRY, never a Dispute
 * and never a Vendor direct-message channel. There is no `related_experience_id`
 * column (D6 reuses the entity, no migration), so the Experience reference lives
 * in the ticket subject + the first message body, by slug + title only.
 *
 * No Vendor PII: the signature deliberately accepts ONLY the Experience slug +
 * title + the Customer's message. It never reads, looks up, or embeds the
 * Vendor's phone / email / personal contact — the ticket is a conversation
 * between the Customer and Switchback support.
 *
 * Pure (takes a Drizzle handle, no auth/headers) so it can be exercised
 * directly against PGlite. The `'use server'` auth wrapper lives in the PDP
 * enquiry action.
 */

// ── Result type ────────────────────────────────────────────────────

export type ExperienceEnquiryResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

// ── Validation ─────────────────────────────────────────────────────

const enquirySchema = z.object({
  experienceSlug: z.string().trim().min(1, 'An Experience reference is required.'),
  experienceTitle: z.string().trim().min(1, 'An Experience reference is required.'),
  message: z.string().trim().min(1, 'A question is required.').max(10000),
})

export type ExperienceEnquiryInput = z.infer<typeof enquirySchema>

// ── Create ─────────────────────────────────────────────────────────

/**
 * Open an `experience`-category Support Ticket carrying a Customer's question
 * about a specific Experience. Inserts the ticket (status 'open', priority
 * 'medium') plus the first message — the Customer's verbatim question followed
 * by a plain "Experience: {title} ({slug})" reference line so admin/support can
 * resolve the listing with NO Vendor PII.
 */
export async function createExperienceEnquiry(
  db: DBOrTx,
  userId: string,
  input: ExperienceEnquiryInput,
): Promise<ExperienceEnquiryResult> {
  if (!userId) return { ok: false, error: 'You must be signed in to ask a question.' }

  const parsed = enquirySchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { experienceSlug, experienceTitle, message } = parsed.data

  const subject = `Question about ${experienceTitle}`
  // The Customer's words first (verbatim), then a slug reference line. Only the
  // Experience slug + title are appended — no Vendor contact is ever added.
  const body = `${message}\n\n— Experience: ${experienceTitle} (${experienceSlug})`

  const [ticket] = await db
    .insert(supportTickets)
    .values({
      createdByUserId: userId,
      subject,
      category: 'experience',
      status: 'open',
      priority: 'medium',
    })
    .returning({ id: supportTickets.id })

  if (!ticket) return { ok: false, error: 'Could not create the enquiry.' }

  await db.insert(supportMessages).values({
    ticketId: ticket.id,
    senderUserId: userId,
    body,
  })

  return { ok: true, id: ticket.id }
}
