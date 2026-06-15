'use server'

import { headers } from 'next/headers'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'

import {
  executeCreateVendorProfile,
  type CreateVendorProfileInput,
  type CreateVendorProfileResult,
} from './onboarding-core'

export type { CreateVendorProfileInput, CreateVendorProfileResult }

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

  return executeCreateVendorProfile(prodDb, session.user.id, input)
}
