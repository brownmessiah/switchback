import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { reviews } from '@/db/schema'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Vendor review-response CORE (issue #03 security split).
 *
 * db-injected, auth-free, integration-testable. NOT in the `'use server'`
 * module (IDOR avoidance — a core taking an arbitrary `vendorUserId` would be a
 * client-callable endpoint). The thin Server Action wrapper in ./actions
 * derives identity from the session and gates with `hasVendorAccess` before
 * delegating here.
 */

const vendorResponseSchema = z.object({
  reviewId: z.string().uuid('Invalid review ID.'),
  responseText: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'Response text is required.')),
})

export type VendorResponseInput = z.infer<typeof vendorResponseSchema>

export type VendorResponseResult =
  | { ok: true }
  | { ok: false; error: string }

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
