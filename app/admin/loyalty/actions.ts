'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { grantCredit } from '@/lib/payments/wallet-ledger'

// ── Result types ────────────────────────────────────────────────────

export type GrantCreditResult =
  | { ok: true; walletTransactionId: string }
  | { ok: false; error: string }

// ── Validation schemas ─────────────────────────────────────────────

const manualGrantSchema = z.object({
  userId: z
    .string()
    .trim()
    .min(1, 'User ID is required.'),
  amountRupees: z.coerce.number().int().positive('Amount must be a positive integer.'),
  balanceType: z.enum(['outvers_credit', 'refund_balance']),
  reason: z.string().trim().min(1, 'Reason is required.').max(500),
})

// ── Actions ────────────────────────────────────────────────────────

export async function adminGrantCredit(
  formData: FormData,
): Promise<GrantCreditResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const raw = Object.fromEntries(formData.entries())
  const parsed = manualGrantSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  try {
    const result = await grantCredit(db, {
      userId: parsed.data.userId,
      amountRupees: parsed.data.amountRupees,
      source: 'admin',
      balanceType: parsed.data.balanceType,
      referenceId: `manual:${parsed.data.reason}`,
      actorUserId: session.user.id,
    })

    revalidatePath('/admin/loyalty')
    return { ok: true, walletTransactionId: result.walletTransactionId }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to grant credit.'
    return { ok: false, error: message }
  }
}
