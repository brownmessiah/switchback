/**
 * Post-auth destination resolution (launch-readiness 02).
 *
 * DB-injected core behind the sign-in page's `resolvePostAuthPath`
 * Server Action — the action stays a thin session wrapper (a 'use
 * server' module is a client-callable endpoint and may export only
 * async functions; logic lives here where tests reach it).
 *
 * Precedence:
 *   1. A sanitized `returnTo` — explicit intent beats role defaults.
 *      Hostile values sanitize to null and fall through silently.
 *   2. Role defaults, unchanged from before returnTo existed:
 *      Admin → Vendor (with a profile) → Customer.
 *
 * The "existing Vendor is not re-onboarded" rule is NOT duplicated
 * here: /vendor/onboarding's own guard redirects profile-holders to
 * /vendor/dashboard.
 */

import { eq } from 'drizzle-orm'

import { adminProfiles, vendorProfiles } from '@/db/schema'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import { sanitizeReturnTo } from './return-to'

export async function resolvePostAuthPathForUser(
  db: DBOrTx,
  userId: string | null,
  rawReturnTo?: unknown,
): Promise<string> {
  if (!userId) return '/sign-in'

  const returnTo = sanitizeReturnTo(rawReturnTo)
  if (returnTo) return returnTo

  const [admin] = await db
    .select({ userId: adminProfiles.userId })
    .from(adminProfiles)
    .where(eq(adminProfiles.userId, userId))
    .limit(1)
  if (admin) return '/admin/dashboard'

  const [vendor] = await db
    .select({ userId: vendorProfiles.userId })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, userId))
    .limit(1)
  if (vendor) return '/vendor/dashboard'

  return '/dashboard'
}
