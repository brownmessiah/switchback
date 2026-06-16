'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'
import { hasVendorAccess } from '@/lib/auth/permissions'

import {
  executeDeactivateTeamMember,
  executeEditTeamMemberRole,
  executeInviteTeamMember,
  executeRemoveTeamMember,
  type DeactivateTeamMemberInput,
  type EditTeamMemberRoleInput,
  type InviteTeamMemberInput,
  type RemoveTeamMemberInput,
  type TeamActionResult,
} from './team-core'

/**
 * Server Action boundary for vendor team management (issue #04).
 *
 * SECURITY (issue #03 pattern): every export in this `'use server'` file is a
 * client-callable endpoint, so each one (a) derives the trusted session id,
 * (b) gates on the `team:manage` permission — owner-only — via
 * `hasVendorAccess`, returning a denial envelope when false, then (c) delegates
 * to the db-injected core in `./team-core`, passing the SESSION-DERIVED id as
 * `vendorUserId` (never a client value). The owner manages their own account,
 * so `vendorUserId` is the session id. No db-injected core is exported here.
 */

const TEAM_PATH = '/vendor/team'

/**
 * Sanitized fallback envelope (security review LOW-3). The team cores return
 * typed `{ ok: false, error }` envelopes for every expected denial/validation
 * case; this only catches an UNEXPECTED throw (e.g. a unique-index race on
 * `(vendor_user_id, member_user_id)` slipping past the application-layer check)
 * so a raw Postgres error never propagates to the client. Mirrors the
 * error-envelope style in `bookings/action-cores.ts`.
 */
const UNEXPECTED_ERROR: TeamActionResult = {
  ok: false,
  error: 'An unexpected error occurred.',
}

async function gate(): Promise<
  { ok: true; vendorUserId: string } | { ok: false; result: TeamActionResult }
> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, result: { ok: false, error: 'Not authenticated.' } }
  }
  // INTENTIONAL: no resolved-shop arg (issue #11). `team:manage` is owner-only
  // and `hasVendorAccess` defaults `vendorUserId` to the acting id, so this
  // checks "is the session user the OWNER of their OWN account?". A non-owner
  // member never resolves to `owner` on their own id → denied. The implicit
  // self-scope is the safety; the session id is then passed downstream AS the
  // `vendorUserId` (owner manages their own account), never a client value. Do
  // NOT pass a resolved shop here — that would admit a member of the shop into
  // an owner-only action.
  if (!(await hasVendorAccess(prodDb, session.user.id, 'team:manage'))) {
    return {
      ok: false,
      result: { ok: false, error: 'You do not have permission to manage your team.' },
    }
  }
  return { ok: true, vendorUserId: session.user.id }
}

export async function inviteTeamMember(
  input: InviteTeamMemberInput,
): Promise<TeamActionResult> {
  const gated = await gate()
  if (!gated.ok) return gated.result

  try {
    const result = await executeInviteTeamMember(prodDb, gated.vendorUserId, input)
    if (result.ok) revalidatePath(TEAM_PATH)
    return result
  } catch {
    return UNEXPECTED_ERROR
  }
}

export async function editTeamMemberRole(
  input: EditTeamMemberRoleInput,
): Promise<TeamActionResult> {
  const gated = await gate()
  if (!gated.ok) return gated.result

  try {
    const result = await executeEditTeamMemberRole(prodDb, gated.vendorUserId, input)
    if (result.ok) revalidatePath(TEAM_PATH)
    return result
  } catch {
    return UNEXPECTED_ERROR
  }
}

export async function deactivateTeamMember(
  input: DeactivateTeamMemberInput,
): Promise<TeamActionResult> {
  const gated = await gate()
  if (!gated.ok) return gated.result

  try {
    const result = await executeDeactivateTeamMember(prodDb, gated.vendorUserId, input)
    if (result.ok) revalidatePath(TEAM_PATH)
    return result
  } catch {
    return UNEXPECTED_ERROR
  }
}

export async function removeTeamMember(
  input: RemoveTeamMemberInput,
): Promise<TeamActionResult> {
  const gated = await gate()
  if (!gated.ok) return gated.result

  try {
    const result = await executeRemoveTeamMember(prodDb, gated.vendorUserId, input)
    if (result.ok) revalidatePath(TEAM_PATH)
    return result
  } catch {
    return UNEXPECTED_ERROR
  }
}
