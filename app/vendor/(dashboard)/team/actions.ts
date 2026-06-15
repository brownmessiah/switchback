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

async function gate(): Promise<
  { ok: true; vendorUserId: string } | { ok: false; result: TeamActionResult }
> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, result: { ok: false, error: 'Not authenticated.' } }
  }
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

  const result = await executeInviteTeamMember(prodDb, gated.vendorUserId, input)
  if (result.ok) revalidatePath(TEAM_PATH)
  return result
}

export async function editTeamMemberRole(
  input: EditTeamMemberRoleInput,
): Promise<TeamActionResult> {
  const gated = await gate()
  if (!gated.ok) return gated.result

  const result = await executeEditTeamMemberRole(prodDb, gated.vendorUserId, input)
  if (result.ok) revalidatePath(TEAM_PATH)
  return result
}

export async function deactivateTeamMember(
  input: DeactivateTeamMemberInput,
): Promise<TeamActionResult> {
  const gated = await gate()
  if (!gated.ok) return gated.result

  const result = await executeDeactivateTeamMember(prodDb, gated.vendorUserId, input)
  if (result.ok) revalidatePath(TEAM_PATH)
  return result
}

export async function removeTeamMember(
  input: RemoveTeamMemberInput,
): Promise<TeamActionResult> {
  const gated = await gate()
  if (!gated.ok) return gated.result

  const result = await executeRemoveTeamMember(prodDb, gated.vendorUserId, input)
  if (result.ok) revalidatePath(TEAM_PATH)
  return result
}
