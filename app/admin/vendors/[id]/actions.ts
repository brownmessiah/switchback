'use server'

import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { auth } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit/write'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Result types ────────────────────────────────────────────────────

export type AdminVendorActionResult =
  | { ok: true }
  | { ok: false; error: string }

// ── KYC tier promotion ordering ─────────────────────────────────────

/**
 * Valid KYC tier promotions per ADR-0007. Must proceed in strict order:
 * phone → identity → business. Skipping tiers is forbidden.
 */
const VALID_PROMOTIONS: ReadonlyMap<string, string> = new Map([
  ['phone', 'identity'],
  ['identity', 'business'],
])

// ── Validation schemas ─────────────────────────────────────────────

const kycApprovalSchema = z.object({
  vendorUserId: z.string().min(1, 'Vendor user ID is required.'),
  notes: z.string().trim().min(1, 'Notes are required for KYC decisions.').max(2000),
})

const kycRejectionSchema = z.object({
  vendorUserId: z.string().min(1, 'Vendor user ID is required.'),
  reason: z.string().trim().min(1, 'Rejection reason is required.').max(2000),
})

const commissionRateSchema = z.object({
  vendorUserId: z.string().min(1, 'Vendor user ID is required.'),
  commissionRate: z.coerce
    .number()
    .min(0, 'Commission rate cannot be negative.')
    .max(100, 'Commission rate cannot exceed 100%.'),
})

const suspendToggleSchema = z.object({
  vendorUserId: z.string().min(1, 'Vendor user ID is required.'),
  notes: z.string().trim().min(1, 'Notes are required.').max(2000),
})

// ── Core testable functions ─────────────────────────────────────────

export async function executeKycApproval(
  db: DBOrTx,
  adminUserId: string,
  input: { vendorUserId: string; notes: string },
): Promise<AdminVendorActionResult> {
  const parsed = kycApprovalSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { vendorUserId, notes } = parsed.data

  // Fetch current vendor KYC tier
  const [vendor] = await db
    .select({ kycTier: vendorProfiles.kycTier })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  if (!vendor) {
    return { ok: false, error: 'Vendor not found.' }
  }

  const nextTier = VALID_PROMOTIONS.get(vendor.kycTier)
  if (!nextTier) {
    return { ok: false, error: `Vendor is already at the highest KYC tier (${vendor.kycTier}).` }
  }

  await db
    .update(vendorProfiles)
    .set({
      kycTier: nextTier as 'identity' | 'business',
      updatedAt: new Date(),
    })
    .where(eq(vendorProfiles.userId, vendorUserId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.kyc.approve',
    entityType: 'vendor_profile',
    entityId: vendorUserId,
    payload: {
      previousTier: vendor.kycTier,
      newTier: nextTier,
      notes,
    },
  })

  return { ok: true }
}

export async function executeKycRejection(
  db: DBOrTx,
  adminUserId: string,
  input: { vendorUserId: string; reason: string },
): Promise<AdminVendorActionResult> {
  const parsed = kycRejectionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { vendorUserId, reason } = parsed.data

  // Verify vendor exists
  const [vendor] = await db
    .select({ kycTier: vendorProfiles.kycTier })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  if (!vendor) {
    return { ok: false, error: 'Vendor not found.' }
  }

  // KYC rejection does NOT change the tier — it just creates an audit log
  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.kyc.reject',
    entityType: 'vendor_profile',
    entityId: vendorUserId,
    payload: {
      currentTier: vendor.kycTier,
      reason,
    },
  })

  return { ok: true }
}

export async function executeCommissionRateUpdate(
  db: DBOrTx,
  adminUserId: string,
  input: { vendorUserId: string; commissionRate: number },
): Promise<AdminVendorActionResult> {
  const parsed = commissionRateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { vendorUserId, commissionRate } = parsed.data

  // Fetch current rate for the audit log
  const [vendor] = await db
    .select({ commissionRate: vendorProfiles.commissionRate })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  if (!vendor) {
    return { ok: false, error: 'Vendor not found.' }
  }

  const newRate = commissionRate.toFixed(2)

  await db
    .update(vendorProfiles)
    .set({
      commissionRate: newRate,
      updatedAt: new Date(),
    })
    .where(eq(vendorProfiles.userId, vendorUserId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.commission_rate.update',
    entityType: 'vendor_profile',
    entityId: vendorUserId,
    payload: {
      previousRate: vendor.commissionRate,
      newRate,
    },
  })

  return { ok: true }
}

export async function executeSuspendToggle(
  db: DBOrTx,
  adminUserId: string,
  input: { vendorUserId: string; notes: string },
): Promise<AdminVendorActionResult> {
  const parsed = suspendToggleSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { vendorUserId, notes } = parsed.data

  const [vendor] = await db
    .select({ suspended: vendorProfiles.suspended })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  if (!vendor) {
    return { ok: false, error: 'Vendor not found.' }
  }

  const newSuspendedState = !vendor.suspended

  await db
    .update(vendorProfiles)
    .set({
      suspended: newSuspendedState,
      updatedAt: new Date(),
    })
    .where(eq(vendorProfiles.userId, vendorUserId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: newSuspendedState ? 'admin.vendor.suspend' : 'admin.vendor.reactivate',
    entityType: 'vendor_profile',
    entityId: vendorUserId,
    payload: {
      suspended: newSuspendedState,
      notes,
    },
  })

  return { ok: true }
}

// ── Server action wrappers (auth layer) ─────────────────────────────

export async function approveKycAction(
  formData: FormData,
): Promise<AdminVendorActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'vendors'))) {
    return { ok: false, error: 'You do not have permission to manage vendors.' }
  }

  const vendorUserId = formData.get('vendorUserId') as string
  const notes = formData.get('notes') as string

  const result = await executeKycApproval(prodDb, session.user.id, {
    vendorUserId,
    notes,
  })

  if (result.ok) revalidatePath(`/admin/vendors/${vendorUserId}`)
  return result
}

export async function rejectKycAction(
  formData: FormData,
): Promise<AdminVendorActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'vendors'))) {
    return { ok: false, error: 'You do not have permission to manage vendors.' }
  }

  const vendorUserId = formData.get('vendorUserId') as string
  const reason = formData.get('reason') as string

  const result = await executeKycRejection(prodDb, session.user.id, {
    vendorUserId,
    reason,
  })

  if (result.ok) revalidatePath(`/admin/vendors/${vendorUserId}`)
  return result
}

export async function updateCommissionRateAction(
  formData: FormData,
): Promise<AdminVendorActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'vendors'))) {
    return { ok: false, error: 'You do not have permission to manage vendors.' }
  }

  const vendorUserId = formData.get('vendorUserId') as string
  const commissionRate = Number(formData.get('commissionRate'))

  const result = await executeCommissionRateUpdate(prodDb, session.user.id, {
    vendorUserId,
    commissionRate,
  })

  if (result.ok) revalidatePath(`/admin/vendors/${vendorUserId}`)
  return result
}

export async function toggleSuspendAction(
  formData: FormData,
): Promise<AdminVendorActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'vendors'))) {
    return { ok: false, error: 'You do not have permission to manage vendors.' }
  }

  const vendorUserId = formData.get('vendorUserId') as string
  const notes = formData.get('notes') as string

  const result = await executeSuspendToggle(prodDb, session.user.id, {
    vendorUserId,
    notes,
  })

  if (result.ok) revalidatePath(`/admin/vendors/${vendorUserId}`)
  return result
}
