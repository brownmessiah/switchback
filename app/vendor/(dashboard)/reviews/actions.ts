'use server'

import { db as prodDb } from '@/db/client'
import { requireVendorActionContext } from '@/lib/vendor/acting-context'

import { executeSubmitVendorResponse } from './review-cores'
import type { VendorResponseResult } from './review-cores'

/**
 * Server Action wrapper (auth layer). Resolves the acting Vendor context and
 * gates `bookings:manage` against the RESOLVED shop (issue #11) before
 * delegating to the db-injected core in ./review-cores (issue #03). The core's
 * `vendorUserId` arg is the SHOP (ownership scope) — a member responds on behalf
 * of the account they belong to, not their own (empty) id.
 *
 * Permission: posting a public vendor response is a WRITE on the
 * bookings/operations surface, so it gates on `bookings:manage` — NOT
 * `bookings:read` (issue #03 review, FIX 4). `bookings:read` is held by Guide +
 * Accountant, who must NOT be able to post a response; `bookings:manage` is held
 * by Owner, Manager, and Booking Staff.
 */
export async function submitVendorResponseAction(
  input: { reviewId: string; responseText: string },
): Promise<VendorResponseResult> {
  const gate = await requireVendorActionContext(
    'bookings:manage',
    'You do not have permission to respond to reviews.',
  )
  if ('error' in gate) {
    return { ok: false, error: gate.error }
  }

  return executeSubmitVendorResponse(prodDb, gate.shop, input)
}
