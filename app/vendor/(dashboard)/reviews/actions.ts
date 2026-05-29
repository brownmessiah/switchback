'use server'

import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { reviews } from '@/db/schema'
import { auth } from '@/lib/auth'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Validation schema ────────────────────────────────────────────

const vendorResponseSchema = z.object({
  reviewId: z.string().uuid('Invalid review ID.'),
  responseText: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'Response text is required.')),
})

export type VendorResponseInput = z.infer<typeof vendorResponseSchema>

type VendorResponseResult =
  | { ok: true }
  | { ok: false; error: string }

// ── Core testable function ───────────────────────────────────────

export async function executeSubmitVendorResponse(
  db: DBOrTx,
  vendorUserId: string,
  input: { reviewId: string; responseText: string },
): Promise<VendorResponseResult> {
  const parsed = vendorResponseSchema.safeParse(input)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return { ok: false, error: firstIssue?.message ?? 'Validation failed.' }
  }

  const { reviewId, responseText } = parsed.data

  // Fetch the review — must belong to this Vendor.
  const [review] = await db
    .select({
      id: reviews.id,
      vendorUserId: reviews.vendorUserId,
      vendorResponse: reviews.vendorResponse,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.id, reviewId),
        eq(reviews.vendorUserId, vendorUserId),
      ),
    )
    .limit(1)

  if (!review) {
    return { ok: false, error: 'Review not found or not authorized.' }
  }

  if (review.vendorResponse !== null) {
    return { ok: false, error: 'You have already responded to this review.' }
  }

  await db
    .update(reviews)
    .set({
      vendorResponse: responseText,
      vendorRespondedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(reviews.id, reviewId))

  return { ok: true }
}

// ── Server action wrapper ────────────────────────────────────────

export async function submitVendorResponseAction(
  input: { reviewId: string; responseText: string },
): Promise<VendorResponseResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }

  return executeSubmitVendorResponse(prodDb, session.user.id, input)
}
