'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/auth/permissions'
import {
  executeFlagReview,
  executePublishReview,
  executeRemoveReview,
  type ReviewModerationResult,
} from '@/lib/admin/review-moderation-actions'

export async function flagReviewAction(
  reviewId: string,
): Promise<ReviewModerationResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'reviews'))) {
    return { ok: false, error: 'You do not have permission to moderate reviews.' }
  }

  const result = await executeFlagReview(prodDb, session.user.id, reviewId)

  if (result.ok) revalidatePath('/admin/reviews')
  return result
}

export async function removeReviewAction(
  reviewId: string,
): Promise<ReviewModerationResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'reviews'))) {
    return { ok: false, error: 'You do not have permission to moderate reviews.' }
  }

  const result = await executeRemoveReview(prodDb, session.user.id, reviewId)

  if (result.ok) revalidatePath('/admin/reviews')
  return result
}

export async function publishReviewAction(
  reviewId: string,
): Promise<ReviewModerationResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'reviews'))) {
    return { ok: false, error: 'You do not have permission to moderate reviews.' }
  }

  const result = await executePublishReview(prodDb, session.user.id, reviewId)

  if (result.ok) revalidatePath('/admin/reviews')
  return result
}
