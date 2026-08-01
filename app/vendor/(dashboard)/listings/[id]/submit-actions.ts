'use server'

import { revalidatePath } from 'next/cache'

import { db as prodDb } from '@/db/client'
import { requireVendorActionContext } from '@/lib/vendor/acting-context'

import { executeSubmitExperienceForReview } from './submit-core'
import type { SubmitForReviewResult } from './submit-core'

/**
 * Server Action wrapper (auth layer) for the `draft → pending_review`
 * transition. Resolves the acting Vendor context and gates
 * `experiences:manage` against the RESOLVED shop (issue #11) before delegating
 * to the db-injected core in ./submit-core, which is NOT exported from this
 * `'use server'` file (IDOR avoidance — every exported async function here is
 * a client-callable endpoint).
 *
 * NOTE: this module may export ONLY async functions. A value export here
 * becomes a runtime ReferenceError that typecheck and unit tests both miss.
 */

const DENIED = 'You do not have permission to manage experiences.'

export async function submitExperienceForReviewAction(
  experienceId: string,
): Promise<SubmitForReviewResult> {
  const gate = await requireVendorActionContext('experiences:manage', DENIED)
  if ('error' in gate) {
    return { ok: false, error: gate.error }
  }

  const result = await executeSubmitExperienceForReview(
    prodDb,
    gate.shop,
    { experienceId },
    gate.acting,
  )

  if (result.ok) {
    revalidatePath('/vendor/listings')
    // The admin moderation queue gains a row the moment this succeeds.
    revalidatePath('/admin/experiences')
  }

  return result
}
