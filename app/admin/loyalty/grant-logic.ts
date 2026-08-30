import { z } from 'zod'

import { grantCredit } from '@/lib/payments/wallet-ledger'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Result types ────────────────────────────────────────────────────

export type GrantCreditResult =
  | { ok: true; walletTransactionId: string }
  | { ok: false; error: string }

// ── Validation schemas ─────────────────────────────────────────────

export const manualGrantSchema = z.object({
  userId: z
    .string()
    .trim()
    .min(1, 'User ID is required.'),
  amountRupees: z.coerce.number().int().positive('Amount must be a positive integer.'),
  balanceType: z.enum(['switchback_credit', 'refund_balance']),
  reason: z.string().trim().min(1, 'Reason is required.').max(500),
})

export type ManualGrantInput = z.infer<typeof manualGrantSchema>

// ── Switchback-credit expiry (ADR-0004) ────────────────────────────────
//
// Per ADR-0004 the Switchback credit bucket is closed-loop promotional balance
// that "Expires 12–18 months from issue." A manual admin grant of Switchback
// credit MUST therefore carry an expires_at on its ledger row. We anchor it
// to the short end of the window (12 months from the grant instant), matching
// the seed's deterministic convention (creditIssuedAt + 12 months).
//
// The Refund balance is a real liability, cashable to the original payment
// method — it never expires, so a refund_balance grant carries NO expiry.
const SWITCHBACK_CREDIT_EXPIRY_MONTHS = 12

/**
 * Compute the expiry for a manual grant. Switchback credit expires
 * SWITCHBACK_CREDIT_EXPIRY_MONTHS from `issuedAt` (ADR-0004); the Refund balance
 * has no expiry.
 */
export function computeGrantExpiry(
  balanceType: 'switchback_credit' | 'refund_balance',
  issuedAt: Date,
): Date | undefined {
  if (balanceType !== 'switchback_credit') return undefined
  const expiry = new Date(issuedAt)
  expiry.setMonth(expiry.getMonth() + SWITCHBACK_CREDIT_EXPIRY_MONTHS)
  return expiry
}

// ── Core: grant credit ──────────────────────────────────────────────

/**
 * Grant credit to a Customer's wallet. Switchback-credit grants land in the
 * closed-loop promotional bucket WITH an expiry (ADR-0004); refund-balance
 * grants land in the cashable bucket with no expiry. Both write the
 * wallet.grant_credit audit row via the ledger helper.
 */
export async function executeGrantCredit(
  db: DBOrTx,
  adminUserId: string,
  input: ManualGrantInput,
): Promise<GrantCreditResult> {
  const parsed = manualGrantSchema.safeParse(input)
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
      expiresAt: computeGrantExpiry(parsed.data.balanceType, new Date()),
      actorUserId: adminUserId,
    })
    return { ok: true, walletTransactionId: result.walletTransactionId }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to grant credit.'
    return { ok: false, error: message }
  }
}
