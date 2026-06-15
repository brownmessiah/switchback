import { randomUUID } from 'node:crypto'

import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import {
  vendorTeamMembers,
  type VendorMemberStatus,
} from '@/db/schema/vendor-team-members'
import { writeAuditLog } from '@/lib/audit/write'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Vendor team-member backend (issue #04). DB-injected, framework-free core.
 *
 * This module is DELIBERATELY NOT a `'use server'` file: every export here
 * takes an explicit `db` handle and a trusted, session-derived `vendorUserId`.
 * The thin Server Action wrappers in `./actions.ts` derive the session id,
 * gate on the `team:manage` permission, then delegate here — so nothing in
 * this file is a client-callable endpoint (issue #03 security pattern).
 *
 * Owner is implicit (`vendor_profiles.user_id`) and is never a membership row.
 * Owner protection is enforced three ways: the assignable-role enum excludes
 * `'owner'`, an invite may not target the Owner's own email, and every
 * mutation is scoped to an EXISTING `(vendor_user_id, member_user_id)` row —
 * which by construction is non-owner.
 */

// ── Result envelope (English; the team UI + i18n live in issue #05) ──

export type TeamActionResult =
  | { ok: true; memberUserId?: string }
  | { ok: false; error: string }

// ── A row as the loader returns it (joined with `users`) ──

export interface VendorTeamMemberRow {
  memberUserId: string
  name: string | null
  email: string | null
  role: AssignableRole
  status: VendorMemberStatus
  invitedAt: Date | null
  lastActiveAt: Date | null
}

// ── Validation (zod at the boundary) ──

/**
 * The four roles a Vendor may assign. `'owner'` is deliberately absent — the
 * Owner is implicit and a DB CHECK (`vendor_team_members_no_owner_role`) is the
 * last line of defense. Surfacing the rejection here gives a clean message
 * before the constraint fires.
 */
const ASSIGNABLE_ROLES = ['manager', 'booking_staff', 'guide', 'accountant'] as const

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

const assignableRoleSchema = z.enum(ASSIGNABLE_ROLES)

const memberStatusSchema = z.enum(['active', 'inactive'])

const inviteSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().toLowerCase().email('A valid email is required.').max(320),
  phone: z.string().trim().min(1).max(20).optional(),
  role: assignableRoleSchema,
  status: memberStatusSchema.optional(),
})

export type InviteTeamMemberInput = z.input<typeof inviteSchema>

const editRoleSchema = z.object({
  memberUserId: z.string().min(1, 'A member is required.'),
  role: assignableRoleSchema,
})

export type EditTeamMemberRoleInput = z.input<typeof editRoleSchema>

const deactivateSchema = z.object({
  memberUserId: z.string().min(1, 'A member is required.'),
  status: memberStatusSchema,
})

export type DeactivateTeamMemberInput = z.input<typeof deactivateSchema>

const removeSchema = z.object({
  memberUserId: z.string().min(1, 'A member is required.'),
})

export type RemoveTeamMemberInput = z.input<typeof removeSchema>

// ── Internal helpers ──

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Validation failed.'
}

/**
 * Look up the (non-owner) membership row for `memberUserId` on the
 * `vendorUserId` account. Returns null for a non-member (or a member of a
 * different account) — every mutation rejects on null with a not-found error.
 */
async function findMembership(
  db: DBOrTx,
  vendorUserId: string,
  memberUserId: string,
): Promise<{ role: AssignableRole; status: VendorMemberStatus } | null> {
  const [row] = await db
    .select({ role: vendorTeamMembers.role, status: vendorTeamMembers.status })
    .from(vendorTeamMembers)
    .where(
      and(
        eq(vendorTeamMembers.vendorUserId, vendorUserId),
        eq(vendorTeamMembers.memberUserId, memberUserId),
      ),
    )
    .limit(1)

  if (!row) return null
  // A stored row can never be 'owner' (DB CHECK), so the narrowing is sound.
  return { role: row.role as AssignableRole, status: row.status }
}

// ── Invite (create-or-link) ──

/**
 * Invite a human by email onto the `vendorUserId` Vendor account.
 *
 *   - email is unknown → CREATE a real `users` row (own phone/email better-auth
 *     login; `users.id` is a text PK with no default, so we generate one via
 *     `randomUUID()`), then the membership row — both inside one
 *     `db.transaction` so a partial failure cannot orphan a user.
 *   - email is known → LINK the existing user (no duplicate); error if they are
 *     already a member of THIS account.
 *
 * Owner protection: the Owner's own email is rejected (the Owner is implicit,
 * never a membership row), and `role: 'owner'` is rejected by the schema.
 *
 * Demo-mode caveat (mirrors the sub-admin invite): we do not send an invite
 * email here. The invited user claims access by logging in with their own
 * better-auth credentials (email OTP / phone) — the credential-claim flow is
 * the user's own login, not this backend's concern.
 */
export async function executeInviteTeamMember(
  db: DBOrTx,
  vendorUserId: string,
  input: InviteTeamMemberInput,
): Promise<TeamActionResult> {
  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) }
  }

  const { fullName, email, phone, role, status } = parsed.data

  // Owner protection: never invite the Owner's own email as a member.
  const [ownerRow] = await db
    .select({ email: users.email })
    .from(vendorProfiles)
    .innerJoin(users, eq(users.id, vendorProfiles.userId))
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  if (ownerRow?.email && ownerRow.email.toLowerCase() === email) {
    return { ok: false, error: 'You are the account owner and already have full access.' }
  }

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (existingUser) {
    // Already on THIS team (any status) → clear, idempotent-safe error.
    const existingMembership = await findMembership(db, vendorUserId, existingUser.id)
    if (existingMembership) {
      return { ok: false, error: 'This person is already on your team.' }
    }

    await db.insert(vendorTeamMembers).values({
      vendorUserId,
      memberUserId: existingUser.id,
      role,
      status: status ?? 'active',
      invitedAt: new Date(),
    })

    await writeAuditLog(db, {
      actorUserId: vendorUserId,
      action: 'vendor.team.invite',
      entityType: 'vendor_team_member',
      entityId: existingUser.id,
      payload: { email, role, linkedExistingUser: true },
    })

    return { ok: true, memberUserId: existingUser.id }
  }

  // Unknown email → create the auth user + membership atomically.
  const newUserId = randomUUID()

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: newUserId,
      email,
      name: fullName ?? null,
      phoneNumber: phone ?? null,
      emailVerified: false,
    })

    await tx.insert(vendorTeamMembers).values({
      vendorUserId,
      memberUserId: newUserId,
      role,
      status: status ?? 'active',
      invitedAt: new Date(),
    })

    await writeAuditLog(tx, {
      actorUserId: vendorUserId,
      action: 'vendor.team.invite',
      entityType: 'vendor_team_member',
      entityId: newUserId,
      payload: { email, role, createdNewUser: true },
    })
  })

  return { ok: true, memberUserId: newUserId }
}

// ── Edit role ──

export async function executeEditTeamMemberRole(
  db: DBOrTx,
  vendorUserId: string,
  input: EditTeamMemberRoleInput,
): Promise<TeamActionResult> {
  const parsed = editRoleSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) }
  }

  const { memberUserId, role } = parsed.data

  const existing = await findMembership(db, vendorUserId, memberUserId)
  if (!existing) {
    return { ok: false, error: 'Team member not found.' }
  }

  await db
    .update(vendorTeamMembers)
    .set({ role, updatedAt: sql`now()` })
    .where(
      and(
        eq(vendorTeamMembers.vendorUserId, vendorUserId),
        eq(vendorTeamMembers.memberUserId, memberUserId),
      ),
    )

  await writeAuditLog(db, {
    actorUserId: vendorUserId,
    action: 'vendor.team.edit_role',
    entityType: 'vendor_team_member',
    entityId: memberUserId,
    payload: { previousRole: existing.role, newRole: role },
  })

  return { ok: true, memberUserId }
}

// ── Deactivate / reactivate (status flip) ──

export async function executeDeactivateTeamMember(
  db: DBOrTx,
  vendorUserId: string,
  input: DeactivateTeamMemberInput,
): Promise<TeamActionResult> {
  const parsed = deactivateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) }
  }

  const { memberUserId, status } = parsed.data

  const existing = await findMembership(db, vendorUserId, memberUserId)
  if (!existing) {
    return { ok: false, error: 'Team member not found.' }
  }

  await db
    .update(vendorTeamMembers)
    .set({ status, updatedAt: sql`now()` })
    .where(
      and(
        eq(vendorTeamMembers.vendorUserId, vendorUserId),
        eq(vendorTeamMembers.memberUserId, memberUserId),
      ),
    )

  await writeAuditLog(db, {
    actorUserId: vendorUserId,
    action: 'vendor.team.deactivate',
    entityType: 'vendor_team_member',
    entityId: memberUserId,
    payload: { previousStatus: existing.status, newStatus: status },
  })

  return { ok: true, memberUserId }
}

// ── Remove (delete membership; the auth user is untouched) ──

export async function executeRemoveTeamMember(
  db: DBOrTx,
  vendorUserId: string,
  input: RemoveTeamMemberInput,
): Promise<TeamActionResult> {
  const parsed = removeSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) }
  }

  const { memberUserId } = parsed.data

  const existing = await findMembership(db, vendorUserId, memberUserId)
  if (!existing) {
    return { ok: false, error: 'Team member not found.' }
  }

  await db
    .delete(vendorTeamMembers)
    .where(
      and(
        eq(vendorTeamMembers.vendorUserId, vendorUserId),
        eq(vendorTeamMembers.memberUserId, memberUserId),
      ),
    )

  await writeAuditLog(db, {
    actorUserId: vendorUserId,
    action: 'vendor.team.remove',
    entityType: 'vendor_team_member',
    entityId: memberUserId,
    payload: { removedRole: existing.role },
  })

  return { ok: true, memberUserId }
}

// ── Loader ──

/**
 * The membership roster for a Vendor account, joined with `users` for display.
 * Includes inactive members (the UI shows them; the gate denies them). The
 * Owner is implicit and is rendered separately by the UI, so it is not a row
 * here. Ordered oldest-invited first for a stable list.
 */
export async function loadVendorTeam(
  db: DBOrTx,
  vendorUserId: string,
): Promise<VendorTeamMemberRow[]> {
  const rows = await db
    .select({
      memberUserId: vendorTeamMembers.memberUserId,
      name: users.name,
      email: users.email,
      role: vendorTeamMembers.role,
      status: vendorTeamMembers.status,
      invitedAt: vendorTeamMembers.invitedAt,
      lastActiveAt: vendorTeamMembers.lastActiveAt,
    })
    .from(vendorTeamMembers)
    .innerJoin(users, eq(users.id, vendorTeamMembers.memberUserId))
    .where(eq(vendorTeamMembers.vendorUserId, vendorUserId))
    .orderBy(asc(vendorTeamMembers.invitedAt), asc(vendorTeamMembers.createdAt))

  return rows.map((row) => ({
    ...row,
    role: row.role as AssignableRole,
  }))
}
