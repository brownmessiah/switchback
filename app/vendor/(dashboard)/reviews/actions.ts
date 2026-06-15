'use server'

import { headers } from 'next/headers'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'
import { hasVendorAccess } from '@/lib/auth/permissions'

import { executeSubmitVendorResponse } from './review-cores'
import type { VendorResponseInput, VendorResponseResult } from './review-cores'

export type { VendorResponseInput, VendorResponseResult }

/**
 * Server Action wrapper (auth layer). Derives the Vendor identity from the
 * session and gates with `hasVendorAccess` before delegating to the
 * db-injected core in ./review-cores (issue #03).
 *
 * Permission: posting a public vendor response is a WRITE on the
 * bookings/operations surface, so it gates on `bookings:manage` — NOT
 * `bookings:read` (issue #03 review, FIX 4). `bookings:read` is held by Guide +
 * Accountant, who must NOT be able to post a response; `bookings:manage` is held
 * by Owner, Manager, and Booking Staff. Owner is unchanged.
 */
export async function submitVendorResponseAction(
  input: { reviewId: string; responseText: string },
): Promise<VendorResponseResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }
  if (!(await hasVendorAccess(prodDb, session.user.id, 'bookings:manage'))) {
    return { ok: false, error: 'You do not have permission to respond to reviews.' }
  }

  return executeSubmitVendorResponse(prodDb, session.user.id, input)
}
