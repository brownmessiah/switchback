/**
 * lib/reviews/create — Customer review-capture core + server-action wrapper
 * (issue 18). A Customer reviews their own Completed Booking, optionally
 * capturing the group type (DECISION D5). Travel month is derived at read time
 * from the Booking's Availability slot, never stored.
 *
 * Mirrors the execute-core / action-wrapper split used by the
 * vendor-response action: the pure `executeCreateReview(db, customerUserId,
 * input)` core is unit-tested directly; `createReviewAction` is the thin auth
 * wrapper.
 */
'use server'

import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { reviews } from '@/db/schema/reviews'
import { auth } from '@/lib/auth'
import type { DBOrTx } from '@/lib/media/experience-images'

import { REVIEW_GROUP_TYPES } from './enrichment'

const createReviewSchema = z.object({
  bookingId: z.string().uuid('Invalid booking ID.'),
  rating: z.number().int().min(1, 'Rating is required.').max(5, 'Rating must be 1–5.'),
  title: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(120))
    .optional(),
  body: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(4000))
    .optional(),
  groupType: z.enum(REVIEW_GROUP_TYPES).optional(),
})

export type CreateReviewInput = z.input<typeof createReviewSchema>

export type CreateReviewResult = { ok: true } | { ok: false; error: string }

export async function executeCreateReview(
  db: DBOrTx,
  customerUserId: string,
  input: CreateReviewInput,
): Promise<CreateReviewResult> {
  const parsed = createReviewSchema.safeParse(input)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return { ok: false, error: firstIssue?.message ?? 'Validation failed.' }
  }

  const { bookingId, rating, title, body, groupType } = parsed.data

  // The Booking must exist, belong to this Customer, and be Completed
  // (review eligibility per the Completion gate).
  const [booking] = await db
    .select({
      id: bookings.id,
      customerUserId: bookings.customerUserId,
      experienceId: bookings.experienceId,
      vendorUserId: experiences.vendorUserId,
      state: bookings.state,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(eq(bookings.id, bookingId))
    .limit(1)

  if (!booking || booking.customerUserId !== customerUserId) {
    return { ok: false, error: 'Booking not found or not authorized.' }
  }

  if (booking.state !== 'completed') {
    return { ok: false, error: 'You can review a booking only after it is completed.' }
  }

  try {
    await db.insert(reviews).values({
      bookingId: booking.id,
      customerUserId,
      experienceId: booking.experienceId,
      vendorUserId: booking.vendorUserId,
      rating,
      title: title || null,
      body: body || null,
      groupType: groupType ?? null,
      status: 'published',
    })
  } catch {
    // The unique(booking_id) constraint makes a second review a no-op.
    return { ok: false, error: 'You have already reviewed this booking.' }
  }

  return { ok: true }
}

// ── Server action wrapper ────────────────────────────────────────

export async function createReviewAction(
  input: CreateReviewInput,
): Promise<CreateReviewResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }
  return executeCreateReview(prodDb, session.user.id, input)
}
