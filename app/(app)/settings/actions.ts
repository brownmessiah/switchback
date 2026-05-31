'use server'

import { headers } from 'next/headers'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import {
  updateCustomerProfile,
  type UpdateCustomerProfileInput,
  type UpdateCustomerProfileResult,
} from '@/lib/customer/profile'

/**
 * Server Action wrapper for the customer profile editor. Adds the auth
 * layer only — all validation + persistence lives in the pure core
 * `updateCustomerProfile` (lib/customer/profile.ts), which is exercised
 * directly by the unit test suite.
 *
 * The NotificationPreferences grid wires its own existing actions
 * (`getNotificationPreferences` / `upsertNotificationPreference` in
 * lib/notifications/actions.ts) — they are NOT duplicated here.
 */
export async function updateCustomerProfileAction(
  input: UpdateCustomerProfileInput,
): Promise<UpdateCustomerProfileResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }

  return updateCustomerProfile(db, session.user.id, input)
}
