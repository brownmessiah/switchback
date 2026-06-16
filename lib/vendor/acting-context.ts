import { cache } from 'react'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import {
  resolveActingVendorContext,
  resolveActingVendorScope,
  type ActingVendorContext,
  type VendorPermission,
  type VendorRole,
} from '@/lib/auth/permissions'
import { can } from '@/lib/auth/vendor-permissions'

/**
 * Per-request memoized acting Vendor context (issue #11).
 *
 * Wraps {@link resolveActingVendorContext} in React's `cache()` so the
 * `(dashboard)` layout AND every page resolve the acting user's
 * `{ vendorUserId (shop), role }` ONCE per request — no prop-drilling, no
 * duplicate queries, no drift between the layout's gate and a page's scope.
 *
 * Pages call `const { vendorUserId, role } = await getActingVendorContext()`
 * and use `vendorUserId` as the Vendor-account scope (the "shop") in place of
 * the raw `session.user.id`, gating on the resolved `role`.
 *
 * Auth: mirrors the layout — no session → redirect to /sign-in. No active
 * Vendor context (profile-less non-member, or closed-only profile with no
 * active membership) → `resolveActingVendorContext` itself redirects to
 * /vendor/onboarding.
 */
export const getActingVendorContext = cache(
  async (): Promise<ActingVendorContext> => {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      redirect('/sign-in')
    }
    return resolveActingVendorContext(db, session.user.id)
  },
)

/**
 * Resolved acting context for a Vendor Server Action (issue #11): the acting
 * human (`acting` = session id, for audit), the Vendor account they operate on
 * (`shop` = resolved vendorUserId, for scope/ownership), and their `role`.
 */
export interface VendorActionContext {
  /** The acting human's user id (session). The audit ACTOR (§5). */
  acting: string
  /** The Vendor account being acted on (resolved shop). The SCOPE (§5). */
  shop: string
  /** The acting user's role on that shop. */
  role: VendorRole
}

/**
 * Server-Action gate (issue #11) — the non-redirecting analogue of
 * `getActingVendorContext` for write boundaries. Reads the session, resolves
 * the acting shop (NO redirect — actions return typed envelopes), and authorizes
 * `permission` against the RESOLVED shop. On success returns
 * `{ acting, shop, role }`; on any failure returns `{ error }` so the caller can
 * `if ('error' in gate) return { ok: false, error: gate.error }`.
 *
 * `acting` is the session human (audit actor / §5), `shop` is the resolved
 * Vendor account (scope / ownership), keeping the two-id split explicit.
 */
export async function requireVendorActionContext(
  permission: VendorPermission,
  deniedMessage = 'You do not have permission to perform this action.',
): Promise<VendorActionContext | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: 'Sign in to continue.' }
  }
  const scope = await resolveActingVendorScope(db, session.user.id)
  if (!scope) {
    return { error: deniedMessage }
  }
  if (!can(scope.role, permission)) {
    return { error: deniedMessage }
  }
  return { acting: session.user.id, shop: scope.vendorUserId, role: scope.role }
}
