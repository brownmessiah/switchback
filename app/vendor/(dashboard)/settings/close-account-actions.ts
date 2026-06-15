'use server'

import { headers } from 'next/headers'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'

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
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }

  return executeCloseVendorAccount(prodDb, session.user.id, input)
}
