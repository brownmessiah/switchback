'use server'

import { headers } from 'next/headers'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'
import { getEmailSender } from '@/lib/email/resend'
import { adaptEmailSender } from '@/lib/email/vendor-lifecycle'
import { notifyVendorApplicationReceived } from '@/lib/email/vendor-notifications'

import {
  executeCreateVendorProfile,
  type CreateVendorProfileInput,
  type CreateVendorProfileResult,
} from './onboarding-core'

// ── Server action wrapper (auth layer) ──────────────────────────────

/**
 * Thin Server Action entry point for Vendor onboarding (issue #03 review,
 * FIX 5). The db-injected core `executeCreateVendorProfile` lives in the plain
 * (non-`'use server'`) sibling `./onboarding-core` so it is NOT a
 * client-callable endpoint taking an arbitrary `userId` (IDOR avoidance,
 * matching the split applied to the rest of the Vendor surface).
 *
 * This wrapper stays UNGATED — it is the entry point for profile-less users
 * (correct per ADR-0006 design): a signed-in user without a vendor_profiles row
 * derives identity from the session and creates (or reactivates) their own
 * profile.
 */
export async function createVendorProfileAction(
  input: CreateVendorProfileInput,
): Promise<CreateVendorProfileResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }

  const result = await executeCreateVendorProfile(prodDb, session.user.id, input)

  // Confirm to the Vendor that their account exists and a review is pending.
  // Best-effort by construction: the profile has already committed, so a
  // delivery failure is logged inside the notifier and never surfaces here.
  if (result.ok) {
    await notifyVendorApplicationReceived(
      prodDb,
      adaptEmailSender(getEmailSender()),
      session.user.id,
    )
  }

  return result
}
