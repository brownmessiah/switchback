'use server'

import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { promoCodes } from '@/db/schema/promo-codes'
import { auth } from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit/write'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Result types ────────────────────────────────────────────────────

export type PromoActionResult =
  | { ok: true }
  | { ok: false; error: string }

// ── Validation schemas ─────────────────────────────────────────────

const createPromoSchema = z.object({
  code: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .pipe(z.string().min(1, 'Code is required.').max(50, 'Code too long.')),
  creditAmount: z.coerce.number().int().positive('Credit amount must be positive.'),
  minBookingAmount: z.coerce.number().int().nonnegative().nullable().optional(),
  maxTotalUses: z.coerce.number().int().positive().nullable().optional(),
  perUserLimit: z.coerce.number().int().positive().default(1),
  active: z.coerce.boolean().default(true),
  startsAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
})

export type CreatePromoInput = z.infer<typeof createPromoSchema>

const updatePromoSchema = z.object({
  id: z.string().uuid(),
  active: z.coerce.boolean().optional(),
  maxTotalUses: z.coerce.number().int().positive().nullable().optional(),
  perUserLimit: z.coerce.number().int().positive().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
})

// ── Actions ────────────────────────────────────────────────────────

export async function createPromoCode(
  formData: FormData,
  injectedDb?: DBOrTx,
): Promise<PromoActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const raw = Object.fromEntries(formData.entries())
  const parsed = createPromoSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const db = injectedDb ?? prodDb

  try {
    await db.insert(promoCodes).values({
      code: parsed.data.code,
      creditAmount: parsed.data.creditAmount.toFixed(2),
      minBookingAmount: parsed.data.minBookingAmount
        ? parsed.data.minBookingAmount.toFixed(2)
        : null,
      maxTotalUses: parsed.data.maxTotalUses ?? null,
      perUserLimit: parsed.data.perUserLimit,
      active: parsed.data.active,
      startsAt: parsed.data.startsAt ?? null,
      expiresAt: parsed.data.expiresAt ?? null,
      createdByAdminId: session.user.id,
    })

    await writeAuditLog(db, {
      actorUserId: session.user.id,
      action: 'admin.promo_code.create',
      entityType: 'promo_code',
      entityId: parsed.data.code,
      payload: { code: parsed.data.code, creditAmount: parsed.data.creditAmount },
    })

    revalidatePath('/admin/promo')
    return { ok: true }
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('unique')) {
      return { ok: false, error: `Promo code "${parsed.data.code}" already exists.` }
    }
    return { ok: false, error: 'Failed to create promo code.' }
  }
}

export async function togglePromoCode(
  id: string,
  active: boolean,
): Promise<PromoActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  await prodDb
    .update(promoCodes)
    .set({ active })
    .where(eq(promoCodes.id, id))

  await writeAuditLog(prodDb, {
    actorUserId: session.user.id,
    action: active ? 'admin.promo_code.activate' : 'admin.promo_code.deactivate',
    entityType: 'promo_code',
    entityId: id,
    payload: { active },
  })

  revalidatePath('/admin/promo')
  return { ok: true }
}

export async function deletePromoCode(id: string): Promise<PromoActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  // Only allow deleting promos with 0 uses
  const [promo] = await prodDb
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.id, id))
    .limit(1)

  if (!promo) return { ok: false, error: 'Promo code not found.' }
  if (promo.currentUses > 0) {
    return { ok: false, error: 'Cannot delete a promo code that has been redeemed. Deactivate it instead.' }
  }

  await prodDb.delete(promoCodes).where(eq(promoCodes.id, id))

  await writeAuditLog(prodDb, {
    actorUserId: session.user.id,
    action: 'admin.promo_code.delete',
    entityType: 'promo_code',
    entityId: id,
    payload: { code: promo.code },
  })

  revalidatePath('/admin/promo')
  return { ok: true }
}
