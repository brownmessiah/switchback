'use server'

import { eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'

import { db as prodDb } from '@/db/client'
import { adminProfiles } from '@/db/schema/admin-profiles'
import { subAdminInvites } from '@/db/schema/sub-admin-invites'
import { users } from '@/db/schema/users'
import { auth } from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit/write'
import { ADMIN_PERMISSIONS, hasAdminPermission, type AdminPermission } from '@/lib/auth/permissions'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Result types ────────────────────────────────────────────────────

export type SubAdminActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string }

// ── Validation schemas ─────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().trim().email('Valid email is required.').max(320),
  permissions: z
    .array(z.string())
    .min(1, 'At least one permission is required.')
    .refine(
      (perms) => perms.every((p) => (ADMIN_PERMISSIONS as readonly string[]).includes(p)),
      { message: 'Invalid permission value.' },
    ),
})

export type InviteSubAdminInput = z.infer<typeof inviteSchema>

const editPermissionsSchema = z.object({
  userId: z.string().min(1, 'User ID is required.'),
  permissions: z
    .array(z.string())
    .min(1, 'At least one permission is required.')
    .refine(
      (perms) => perms.every((p) => (ADMIN_PERMISSIONS as readonly string[]).includes(p)),
      { message: 'Invalid permission value.' },
    ),
})

export type EditPermissionsInput = z.infer<typeof editPermissionsSchema>

// ── Core testable: create sub-admin (demo mode: direct creation) ───

export async function executeInviteSubAdmin(
  db: DBOrTx,
  adminUserId: string,
  input: InviteSubAdminInput,
): Promise<SubAdminActionResult> {
  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { email, permissions } = parsed.data

  // Check if a user with this email already has an admin profile
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (existingUser) {
    const [existingAdmin] = await db
      .select({ userId: adminProfiles.userId })
      .from(adminProfiles)
      .where(eq(adminProfiles.userId, existingUser.id))
      .limit(1)

    if (existingAdmin) {
      return { ok: false, error: 'This user already has admin access.' }
    }
  }

  const token = randomBytes(32).toString('hex')

  // For demo mode: if user exists, create admin_profiles row directly
  // and mark invite as accepted. If user doesn't exist, create invite
  // as pending (would normally send email).
  if (existingUser) {
    await db.insert(adminProfiles).values({
      userId: existingUser.id,
      permissions: permissions as AdminPermission[],
      invitedByUserId: adminUserId,
    })

    const [invite] = await db
      .insert(subAdminInvites)
      .values({
        email,
        permissions,
        invitedByAdminId: adminUserId,
        token,
        status: 'accepted',
        acceptedAt: new Date(),
      })
      .returning({ id: subAdminInvites.id })

    await writeAuditLog(db, {
      actorUserId: adminUserId,
      action: 'admin.sub_admin.create',
      entityType: 'admin_profile',
      entityId: existingUser.id,
      payload: { email, permissions, inviteId: invite!.id },
    })

    return { ok: true, id: invite!.id }
  }

  // User doesn't exist yet — create pending invite
  const [invite] = await db
    .insert(subAdminInvites)
    .values({
      email,
      permissions,
      invitedByAdminId: adminUserId,
      token,
      status: 'pending',
    })
    .returning({ id: subAdminInvites.id })

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.sub_admin.invite',
    entityType: 'sub_admin_invite',
    entityId: invite!.id,
    payload: { email, permissions },
  })

  return { ok: true, id: invite!.id }
}

// ── Core testable: edit permissions ────────────────────────────────

export async function executeEditPermissions(
  db: DBOrTx,
  adminUserId: string,
  input: EditPermissionsInput,
): Promise<SubAdminActionResult> {
  const parsed = editPermissionsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { userId, permissions } = parsed.data

  const [existing] = await db
    .select({ permissions: adminProfiles.permissions })
    .from(adminProfiles)
    .where(eq(adminProfiles.userId, userId))
    .limit(1)

  if (!existing) {
    return { ok: false, error: 'Admin profile not found.' }
  }

  await db
    .update(adminProfiles)
    .set({
      permissions: permissions as AdminPermission[],
      updatedAt: sql`now()`,
    })
    .where(eq(adminProfiles.userId, userId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.sub_admin.edit_permissions',
    entityType: 'admin_profile',
    entityId: userId,
    payload: {
      previousPermissions: existing.permissions,
      newPermissions: permissions,
    },
  })

  return { ok: true }
}

// ── Core testable: revoke access ───────────────────────────────────

export async function executeRevokeSubAdmin(
  db: DBOrTx,
  adminUserId: string,
  targetUserId: string,
): Promise<SubAdminActionResult> {
  if (!targetUserId) {
    return { ok: false, error: 'User ID is required.' }
  }

  // Prevent self-revocation
  if (targetUserId === adminUserId) {
    return { ok: false, error: 'Cannot revoke your own admin access.' }
  }

  const [existing] = await db
    .select({ permissions: adminProfiles.permissions })
    .from(adminProfiles)
    .where(eq(adminProfiles.userId, targetUserId))
    .limit(1)

  if (!existing) {
    return { ok: false, error: 'Admin profile not found.' }
  }

  // Remove admin_profiles row
  await db
    .delete(adminProfiles)
    .where(eq(adminProfiles.userId, targetUserId))

  // Update any related invite records to 'revoked'
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1)

  if (user?.email) {
    await db
      .update(subAdminInvites)
      .set({ status: 'revoked', updatedAt: sql`now()` })
      .where(eq(subAdminInvites.email, user.email))
  }

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.sub_admin.revoke',
    entityType: 'admin_profile',
    entityId: targetUserId,
    payload: { previousPermissions: existing.permissions },
  })

  return { ok: true }
}

// ── Server Action wrappers (Next.js boundary) ─────────────────────

export async function inviteSubAdmin(
  formData: FormData,
): Promise<SubAdminActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'sub_admins'))) {
    return { ok: false, error: 'You do not have permission to manage sub-admins.' }
  }

  const raw = Object.fromEntries(formData.entries())
  const permissionKeys = Object.keys(raw).filter((k) => k.startsWith('perm_'))
  const permissions = permissionKeys.map((k) => k.replace('perm_', ''))

  const input: InviteSubAdminInput = {
    email: String(raw.email ?? ''),
    permissions,
  }

  const result = await executeInviteSubAdmin(prodDb, session.user.id, input)

  if (result.ok) {
    revalidatePath('/admin/sub-admins')
  }
  return result
}

export async function editSubAdminPermissions(
  formData: FormData,
): Promise<SubAdminActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'sub_admins'))) {
    return { ok: false, error: 'You do not have permission to manage sub-admins.' }
  }

  const raw = Object.fromEntries(formData.entries())
  const permissionKeys = Object.keys(raw).filter((k) => k.startsWith('perm_'))
  const permissions = permissionKeys.map((k) => k.replace('perm_', ''))

  const input: EditPermissionsInput = {
    userId: String(raw.userId ?? ''),
    permissions,
  }

  const result = await executeEditPermissions(prodDb, session.user.id, input)

  if (result.ok) {
    revalidatePath('/admin/sub-admins')
  }
  return result
}

export async function revokeSubAdmin(
  userId: string,
): Promise<SubAdminActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'sub_admins'))) {
    return { ok: false, error: 'You do not have permission to manage sub-admins.' }
  }

  const result = await executeRevokeSubAdmin(prodDb, session.user.id, userId)

  if (result.ok) {
    revalidatePath('/admin/sub-admins')
  }
  return result
}
