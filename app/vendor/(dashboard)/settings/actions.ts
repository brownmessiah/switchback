'use server'

import { headers } from 'next/headers'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'
import { hasVendorAccess } from '@/lib/auth/permissions'

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
 * Server Action wrappers (auth layer). Each derives the Vendor identity from
 * the session and gates with `hasVendorAccess` before delegating to the
 * db-injected core in ./settings-cores (issue #03). The cores are NOT exported
 * from this `'use server'` file (IDOR avoidance).
 *
 * Permissions:
 *  - business details (name/slug/about, the profile & business surface) →
 *    `kyc:manage`.
 *  - payout method (bank/UPI destination) → `bank:manage`.
 */

export async function updateBusinessDetailsAction(
  input: UpdateBusinessDetailsInput,
): Promise<UpdateBusinessDetailsResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }
  if (!(await hasVendorAccess(prodDb, session.user.id, 'kyc:manage'))) {
    return { ok: false, error: 'You do not have permission to edit business details.' }
  }

  return executeUpdateBusinessDetails(prodDb, session.user.id, input)
}

export async function updatePayoutMethodAction(
  input: UpdatePayoutMethodInput,
): Promise<UpdatePayoutMethodResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }
  if (!(await hasVendorAccess(prodDb, session.user.id, 'bank:manage'))) {
    return { ok: false, error: 'You do not have permission to edit bank details.' }
  }

  return executeUpdatePayoutMethod(prodDb, session.user.id, input)
}
