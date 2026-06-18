import { and, eq } from 'drizzle-orm'

import { vendorFundAccounts } from '@/db/schema/vendor-fund-accounts'

import type { DBOrTx } from './commission-resolver'

/**
 * Fund Account resolver per ADR-0016 (2026-06-18 amendment).
 *
 * Maps a Booking's snapshotted destination → the provisioned Razorpay X
 * `razorpayFundAccountId`, by reading `vendor_fund_accounts` keyed on
 * (vendorUserId, destinationFingerprint). The caller fingerprints the
 * Booking's `payoutDestinationSnapshot` with the SAME shared hash slice 03
 * used (lib/payments/payout-destination.ts), so the snapshot matches the row
 * provisioned for that destination.
 *
 * NEVER provisions inline — provisioning is slice 03's eager path. A missing,
 * legacy (= also no row), or still-cooling-off account drops the group to the
 * admin queue:
 *
 *   no row                 → admin_queue, reason 'missing'
 *   coolingOffUntil > now  → admin_queue, reason 'cooling_off'
 *   else                   → ok, fundAccountId
 *
 * Pure-read — no writes, no Razorpay I/O.
 */

export type ResolveFundAccountResult =
  | { status: 'ok'; fundAccountId: string }
  | { status: 'admin_queue'; reason: 'missing' | 'cooling_off' }

export interface ResolveFundAccountArgs {
  vendorUserId: string
  destinationFingerprint: string
  now: Date
}

export async function resolveFundAccount(
  db: DBOrTx,
  args: ResolveFundAccountArgs,
): Promise<ResolveFundAccountResult> {
  const [row] = await db
    .select({
      razorpayFundAccountId: vendorFundAccounts.razorpayFundAccountId,
      coolingOffUntil: vendorFundAccounts.coolingOffUntil,
    })
    .from(vendorFundAccounts)
    .where(
      and(
        eq(vendorFundAccounts.vendorUserId, args.vendorUserId),
        eq(vendorFundAccounts.destinationFingerprint, args.destinationFingerprint),
      ),
    )
    .limit(1)

  if (!row) {
    return { status: 'admin_queue', reason: 'missing' }
  }

  if (row.coolingOffUntil.getTime() > args.now.getTime()) {
    return { status: 'admin_queue', reason: 'cooling_off' }
  }

  return { status: 'ok', fundAccountId: row.razorpayFundAccountId }
}
