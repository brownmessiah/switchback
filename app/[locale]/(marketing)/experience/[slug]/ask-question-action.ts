'use server'

import { headers } from 'next/headers'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import {
  createExperienceEnquiry,
  type ExperienceEnquiryResult,
} from '@/lib/support/enquiry'

/**
 * PDP "Ask a Question" enquiry action (issue 17, DECISION D6).
 *
 * Auth gate: an unauthenticated caller gets `{ ok: false, error:
 * 'unauthenticated' }` so the client can surface the sign-in prompt WITHOUT the
 * action ever touching the database — mirroring `createSupportTicketAction`.
 * The pure core (`createExperienceEnquiry`) creates a general-enquiry Support
 * Ticket (category 'experience') referencing the Experience by slug + title
 * only — no Vendor PII — handled in the existing admin support queue.
 */
export async function askExperienceQuestionAction(
  experienceSlug: string,
  experienceTitle: string,
  message: string,
): Promise<ExperienceEnquiryResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'unauthenticated' }

  return createExperienceEnquiry(db, session.user.id, {
    experienceSlug,
    experienceTitle,
    message,
  })
}
