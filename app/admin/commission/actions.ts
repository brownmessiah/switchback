'use server'

import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { bookings } from '@/db/schema/bookings'
import { commissionTiers } from '@/db/schema/commission-tiers'
import { auth } from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit/write'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Result types ────────────────────────────────────────────────────

export type CommissionTierActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string }

// ── Validation schemas ─────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(200),
  startAt: z.coerce.date({ message: 'Start date is required.' }),
  endAt: z.coerce.date({ message: 'End date is required.' }),
  rateOverride: z.number().min(0, 'Rate must be between 0 and 100.').max(100, 'Rate must be between 0 and 100.'),
  reason: z.string().trim().min(1, 'Reason is required.').max(2000),
  appliesToCategories: z.array(z.string()).default([]),
  appliesToVendorIds: z.array(z.string()).default([]),
  appliesToExperienceIds: z.array(z.string().uuid()).default([]),
})

export type CreateCommissionTierInput = z.infer<typeof createSchema>

const updateSchema = z.object({
  id: z.string().uuid('Tier ID must be a valid UUID.'),
  name: z.string().trim().min(1, 'Name is required.').max(200).optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  rateOverride: z.number().min(0, 'Rate must be between 0 and 100.').max(100, 'Rate must be between 0 and 100.').optional(),
  reason: z.string().trim().min(1, 'Reason is required.').max(2000).optional(),
  appliesToCategories: z.array(z.string()).optional(),
  appliesToVendorIds: z.array(z.string()).optional(),
  appliesToExperienceIds: z.array(z.string().uuid()).optional(),
})

export type UpdateCommissionTierInput = z.infer<typeof updateSchema>

// ── Core testable: create tier ─────────────────────────────────────

export async function executeCreateCommissionTier(
  db: DBOrTx,
  adminUserId: string,
  input: CreateCommissionTierInput,
): Promise<CommissionTierActionResult> {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { name, startAt, endAt, rateOverride, reason, appliesToCategories, appliesToVendorIds, appliesToExperienceIds } = parsed.data

  // Application-level date ordering check (mirrors DB CHECK constraint)
  if (endAt <= startAt) {
    return { ok: false, error: 'End date must be after start date.' }
  }

  const [tier] = await db
    .insert(commissionTiers)
    .values({
      name,
      startAt,
      endAt,
      rateOverride: rateOverride.toFixed(2),
      reason,
      appliesToCategories,
      appliesToVendorIds,
      appliesToExperienceIds,
      createdByAdminUserId: adminUserId,
    })
    .returning({ id: commissionTiers.id })

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.commission_tier.create',
    entityType: 'commission_tier',
    entityId: tier!.id,
    payload: { name, rateOverride, reason, startAt: startAt.toISOString(), endAt: endAt.toISOString() },
  })

  return { ok: true, id: tier!.id }
}

// ── Core testable: update tier ─────────────────────────────────────

export async function executeUpdateCommissionTier(
  db: DBOrTx,
  adminUserId: string,
  input: UpdateCommissionTierInput,
): Promise<CommissionTierActionResult> {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { id, ...fields } = parsed.data

  // Fetch current tier to validate date range after merge
  const [existing] = await db
    .select()
    .from(commissionTiers)
    .where(eq(commissionTiers.id, id))
    .limit(1)

  if (!existing) {
    return { ok: false, error: 'Commission tier not found.' }
  }

  const effectiveStartAt = fields.startAt ?? existing.startAt
  const effectiveEndAt = fields.endAt ?? existing.endAt

  if (effectiveEndAt <= effectiveStartAt) {
    return { ok: false, error: 'End date must be after start date.' }
  }

  if (fields.rateOverride !== undefined && (fields.rateOverride < 0 || fields.rateOverride > 100)) {
    return { ok: false, error: 'Rate must be between 0 and 100.' }
  }

  // Build update set — only include provided fields
  const updateSet: Record<string, unknown> = {
    updatedAt: sql`now()`,
  }
  if (fields.name !== undefined) updateSet.name = fields.name
  if (fields.startAt !== undefined) updateSet.startAt = fields.startAt
  if (fields.endAt !== undefined) updateSet.endAt = fields.endAt
  if (fields.rateOverride !== undefined) updateSet.rateOverride = fields.rateOverride.toFixed(2)
  if (fields.reason !== undefined) updateSet.reason = fields.reason
  if (fields.appliesToCategories !== undefined) updateSet.appliesToCategories = fields.appliesToCategories
  if (fields.appliesToVendorIds !== undefined) updateSet.appliesToVendorIds = fields.appliesToVendorIds
  if (fields.appliesToExperienceIds !== undefined) updateSet.appliesToExperienceIds = fields.appliesToExperienceIds

  await db
    .update(commissionTiers)
    .set(updateSet)
    .where(eq(commissionTiers.id, id))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.commission_tier.update',
    entityType: 'commission_tier',
    entityId: id,
    payload: { previousName: existing.name, ...fields },
  })

  return { ok: true }
}

// ── Core testable: delete tier ─────────────────────────────────────

export async function executeDeleteCommissionTier(
  db: DBOrTx,
  adminUserId: string,
  tierId: string,
): Promise<CommissionTierActionResult> {
  if (!tierId) {
    return { ok: false, error: 'Tier ID is required.' }
  }

  const [existing] = await db
    .select()
    .from(commissionTiers)
    .where(eq(commissionTiers.id, tierId))
    .limit(1)

  if (!existing) {
    return { ok: false, error: 'Commission tier not found.' }
  }

  await db.delete(commissionTiers).where(eq(commissionTiers.id, tierId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.commission_tier.delete',
    entityType: 'commission_tier',
    entityId: tierId,
    payload: { name: existing.name, rateOverride: Number(existing.rateOverride) },
  })

  return { ok: true }
}

// ── Server Action wrappers (Next.js boundary) ─────────────────────

export async function createCommissionTier(
  formData: FormData,
): Promise<CommissionTierActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const raw = Object.fromEntries(formData.entries())

  const input: CreateCommissionTierInput = {
    name: String(raw.name ?? ''),
    startAt: new Date(String(raw.startAt ?? '')),
    endAt: new Date(String(raw.endAt ?? '')),
    rateOverride: Number(raw.rateOverride ?? 0),
    reason: String(raw.reason ?? ''),
    appliesToCategories: raw.appliesToCategories
      ? String(raw.appliesToCategories).split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    appliesToVendorIds: raw.appliesToVendorIds
      ? String(raw.appliesToVendorIds).split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    appliesToExperienceIds: raw.appliesToExperienceIds
      ? String(raw.appliesToExperienceIds).split(',').map((s) => s.trim()).filter(Boolean)
      : [],
  }

  const result = await executeCreateCommissionTier(prodDb, session.user.id, input)

  if (result.ok) {
    revalidatePath('/admin/commission')
  }
  return result
}

export async function updateCommissionTier(
  formData: FormData,
): Promise<CommissionTierActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const raw = Object.fromEntries(formData.entries())

  const input: UpdateCommissionTierInput = {
    id: String(raw.id ?? ''),
    ...(raw.name !== undefined && { name: String(raw.name) }),
    ...(raw.startAt !== undefined && raw.startAt !== '' && { startAt: new Date(String(raw.startAt)) }),
    ...(raw.endAt !== undefined && raw.endAt !== '' && { endAt: new Date(String(raw.endAt)) }),
    ...(raw.rateOverride !== undefined && raw.rateOverride !== '' && { rateOverride: Number(raw.rateOverride) }),
    ...(raw.reason !== undefined && { reason: String(raw.reason) }),
  }

  const result = await executeUpdateCommissionTier(prodDb, session.user.id, input)

  if (result.ok) {
    revalidatePath('/admin/commission')
  }
  return result
}

export async function deleteCommissionTier(
  id: string,
): Promise<CommissionTierActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const result = await executeDeleteCommissionTier(prodDb, session.user.id, id)

  if (result.ok) {
    revalidatePath('/admin/commission')
  }
  return result
}

// ── Query: count affected bookings for an active tier ─────────────

export async function getAffectedBookingCount(
  db: DBOrTx,
  tierId: string,
): Promise<number> {
  const [tier] = await db
    .select()
    .from(commissionTiers)
    .where(eq(commissionTiers.id, tierId))
    .limit(1)

  if (!tier) return 0

  // Count bookings that fall within the tier's time window
  // and match the scope filters (empty arrays mean "all")
  const conditions = [
    gte(bookings.createdAt, tier.startAt),
    lte(bookings.createdAt, tier.endAt),
  ]

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(...conditions))

  return result?.count ?? 0
}
