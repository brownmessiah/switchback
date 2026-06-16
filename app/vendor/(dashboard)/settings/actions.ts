'use server'

import { db as prodDb } from '@/db/client'
import { requireVendorActionContext } from '@/lib/vendor/acting-context'

import {
  executeUpdateBusinessDetails,
  executeUpdatePayoutMethod,
} from './settings-cores'
import type {
  UpdateBusinessDetailsInput,
  UpdateBusinessDetailsResult,
  UpdatePayoutMethodInput,
  UpdatePayoutMethodResult,
} from './settings-cores'

/**
 * Server Action wrappers (auth layer). Each resolves the acting Vendor context
 * and gates against the RESOLVED shop (issue #11) before delegating to the
 * db-injected core in ./settings-cores (issue #03). The cores' `vendorUserId`
 * arg is the SHOP (ownership scope). The cores are NOT exported from this
 * `'use server'` file (IDOR avoidance).
 *
 * Permissions:
 *  - business details (name/slug/about, the profile & business surface) →
 *    `kyc:manage`.
 *  - payout method (bank/UPI destination) → `bank:manage` (Owner-only).
 */

export async function updateBusinessDetailsAction(
  input: UpdateBusinessDetailsInput,
): Promise<UpdateBusinessDetailsResult> {
  const gate = await requireVendorActionContext(
    'kyc:manage',
    'You do not have permission to edit business details.',
  )
  if ('error' in gate) {
    return { ok: false, error: gate.error }
  }

  return executeUpdateBusinessDetails(prodDb, gate.shop, input)
}

export async function updatePayoutMethodAction(
  input: UpdatePayoutMethodInput,
): Promise<UpdatePayoutMethodResult> {
  const gate = await requireVendorActionContext(
    'bank:manage',
    'You do not have permission to edit bank details.',
  )
  if ('error' in gate) {
    return { ok: false, error: gate.error }
  }

  return executeUpdatePayoutMethod(prodDb, gate.shop, input)
}
