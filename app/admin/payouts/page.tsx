import { eq, inArray } from 'drizzle-orm'

import { db } from '@/db/client'
import { availabilitySlots, bookings, experiences, vendorProfiles } from '@/db/schema'
import { computeVendorNetPayout } from '@/lib/payments/payout-calculator'
import { destinationFingerprint } from '@/lib/payments/payout-destination'
import { resolveFundAccount } from '@/lib/payments/fund-account-resolver'
import {
  classifyPayoutQueueItem,
  type PayoutQueueCategory,
} from '@/lib/payments/payout-queue'

import { PayoutLedger, type PayoutLedgerRow } from './payout-ledger'

/** Two timestamps span more than one UTC calendar day (mirrors the cron worker). */
function isMultiDay(startAt: Date, endAt: Date): boolean {
  return startAt.toISOString().slice(0, 10) !== endAt.toISOString().slice(0, 10)
}

export default async function AdminPayoutsPage() {
  const now = new Date()

  const rows = await db
    .select({
      bookingId: bookings.id,
      state: bookings.state,
      payoutState: bookings.payoutState,
      gross: bookings.grossTotalSnapshot,
      commissionRate: bookings.commissionRateSnapshot,
      gstRateOnCommission: bookings.gstRateOnCommissionSnapshot,
      tdsAmount: bookings.tdsAmountSnapshot,
      tcsAmount: bookings.tcsAmountSnapshot,
      vendorName: vendorProfiles.businessName,
      vendorUserId: vendorProfiles.userId,
      manualPayoutsRemaining: vendorProfiles.manualPayoutsRemaining,
      expTitle: experiences.title,
      requiredPermits: experiences.requiredPermits,
      completedAt: bookings.completedAt,
      payoutRejectionReason: bookings.payoutRejectionReason,
      payoutDestinationSnapshot: bookings.payoutDestinationSnapshot,
      payoutBatchId: bookings.payoutBatchId,
      slotStartAt: availabilitySlots.startAt,
      slotEndAt: availabilitySlots.endAt,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .innerJoin(availabilitySlots, eq(availabilitySlots.id, bookings.slotId))
    .where(inArray(bookings.state, ['completed', 'awaiting_completion']))
    .orderBy(bookings.completedAt)

  // Classify each Payout into the queue category the admin sees, so the first-3
  // queue (story 11) and the fund-account-blocked exceptions (story 14) are
  // VISIBLE rather than silently dropped. Reuses the SAME maturity window +
  // fingerprint + Fund Account resolver the 5pm-IST cron uses, so the queue and
  // the cron agree exactly. Only matured-eligible-unbatched rows need a Fund
  // Account lookup — we resolve those, classify the rest from row facts alone.
  const categories = new Map<string, PayoutQueueCategory>()
  for (const row of rows) {
    const permitRequired = (row.requiredPermits ?? []).length > 0
    const multiDay = isMultiDay(row.slotStartAt, row.slotEndAt)
    const alreadyBatched = row.payoutBatchId !== null

    // Resolve a Fund Account only for a matured, unbatched Payout that is
    // eligible to batch (approved, or pending with the first-3 gate open) — the
    // only case where a missing/cooling-off account becomes a visible exception.
    // The classifier ignores fundAccount for every other category, so a benign
    // 'missing' default keeps the shape without an unnecessary DB read.
    const eligibleToBatch =
      row.payoutState === 'approved' ||
      (row.payoutState === 'pending' && row.manualPayoutsRemaining === 0)
    const fundAccount: Awaited<ReturnType<typeof resolveFundAccount>> =
      !alreadyBatched && eligibleToBatch && row.payoutDestinationSnapshot !== null
        ? await resolveFundAccount(db, {
            vendorUserId: row.vendorUserId,
            destinationFingerprint: destinationFingerprint(row.payoutDestinationSnapshot),
            now,
          })
        : { status: 'admin_queue', reason: 'missing' }

    categories.set(
      row.bookingId,
      classifyPayoutQueueItem({
        payoutState: row.payoutState,
        completedAt: row.completedAt,
        permitRequired,
        multiDay,
        manualPayoutsRemaining: row.manualPayoutsRemaining,
        alreadyBatched,
        fundAccount,
        now,
      }),
    )
  }

  const awaitingApprovalCount = [...categories.values()].filter(
    (c) => c === 'awaiting_approval',
  ).length
  const blockedCount = [...categories.values()].filter(
    (c) => c === 'blocked_fund_account',
  ).length

  // Build the full Commission Snapshot per row from the LOCKED snapshot columns
  // (ADR-0016) via the canonical pure calculator. Read-only — no money write.
  const ledgerRows: PayoutLedgerRow[] = rows.map((row) => {
    const grossRupees = Math.floor(Number(row.gross ?? 0))
    const commissionRatePercent = String(row.commissionRate ?? '20.00')
    const gstRateOnCommissionPercent = String(row.gstRateOnCommission ?? '18.00')
    const tdsRupees = Math.floor(Number(row.tdsAmount ?? 0))
    const tcsRupees = Math.floor(Number(row.tcsAmount ?? 0))

    // Guard: the calculator throws on inconsistent snapshots (negative net).
    // The queue must still render, so fall back to a clamped manual waterfall
    // mirroring the same formula (display-only; the money write uses the lib).
    let snapshot
    try {
      snapshot = computeVendorNetPayout({
        grossRupees,
        commissionRatePercent,
        gstRateOnCommissionPercent,
        tdsRupees,
        tcsRupees,
      })
    } catch {
      const commissionRupees = Math.floor((grossRupees * Number(commissionRatePercent)) / 100)
      const gstOnCommissionRupees = Math.floor(
        (commissionRupees * Number(gstRateOnCommissionPercent)) / 100,
      )
      snapshot = {
        grossRupees,
        commissionRupees,
        gstOnCommissionRupees,
        tdsRupees,
        tcsRupees,
        netPayoutRupees: Math.max(
          0,
          grossRupees - commissionRupees - gstOnCommissionRupees - tdsRupees - tcsRupees,
        ),
      }
    }

    return {
      bookingId: row.bookingId,
      state: row.state,
      payoutState: row.payoutState,
      category: categories.get(row.bookingId) ?? 'not_matured',
      manualPayoutsRemaining: row.manualPayoutsRemaining,
      vendorName: row.vendorName,
      expTitle: row.expTitle,
      grossRupees: snapshot.grossRupees,
      commissionRupees: snapshot.commissionRupees,
      commissionRatePercent,
      gstOnCommissionRupees: snapshot.gstOnCommissionRupees,
      tdsRupees: snapshot.tdsRupees,
      tcsRupees: snapshot.tcsRupees,
      netPayoutRupees: snapshot.netPayoutRupees,
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-h1 font-semibold tracking-tight">Payout queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} booking{rows.length === 1 ? '' : 's'} in queue
          {awaitingApprovalCount > 0 && <> ({awaitingApprovalCount} awaiting approval)</>}
          {blockedCount > 0 && <> ({blockedCount} fund account blocked)</>}
        </p>
      </div>

      <PayoutLedger rows={ledgerRows} />
    </div>
  )
}
