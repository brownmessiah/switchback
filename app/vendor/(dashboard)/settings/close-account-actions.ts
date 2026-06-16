'use server'

import { db as prodDb } from '@/db/client'
import { requireVendorActionContext } from '@/lib/vendor/acting-context'

import { executeCloseVendorAccount } from './close-account-core'
import type {
  CloseVendorAccountInput,
  CloseVendorAccountResult,
} from './close-account-core'

/**
 * Server Action wrapper (auth layer) — the ONLY public entry point for the
 * vendor account-closure flow.
 *
 * Every exported async function in a `'use server'` module is a client-callable
 * Server Action reachable via a direct POST (see
 * node_modules/next/dist/docs/01-app/02-guides/data-security.md). So this file
 * exports a SINGLE function that derives the Vendor identity from the session —
 * never an arbitrary client-supplied id. The db-injected cores
 * (getVendorClosureEligibility / executeCloseVendorAccount) live in the plain
 * (non-`'use server'`) close-account-core.ts module precisely so they are NOT
 * registered as auth-bypassing endpoints.
 */
export async function closeVendorAccountAction(
  input: CloseVendorAccountInput,
): Promise<CloseVendorAccountResult> {
  // Permission: only the Owner may close the account (account:close is an
  // Owner-only permission — Manager and every member role are denied). The gate
  // resolves the acting shop; since account:close is owner-only, the resolved
  // shop is the acting owner's own account (acting === shop here).
  const gate = await requireVendorActionContext(
    'account:close',
    'Only the account owner can close this account.',
  )
  if ('error' in gate) {
    return { ok: false, error: gate.error }
  }

  return executeCloseVendorAccount(prodDb, gate.shop, input, gate.acting)
}
