import { eq, inArray } from 'drizzle-orm'

import { db } from '@/db/client'
import { bookings, experiences, vendorProfiles } from '@/db/schema'
import { computeVendorNetPayout } from '@/lib/payments/payout-calculator'

import { PayoutLedger, type PayoutLedgerRow } from './payout-ledger'

export default async function AdminPayoutsPage() {
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
      completedAt: bookings.completedAt,
      payoutRejectionReason: bookings.payoutRejectionReason,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .where(inArray(bookings.state, ['completed', 'awaiting_completion']))
    .orderBy(bookings.completedAt)

  const pendingCount = rows.filter((r) => r.payoutState === 'pending').length

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
        <h1 className="text-2xl font-semibold tracking-tight">Payout queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} booking{rows.length === 1 ? '' : 's'} in queue
          {pendingCount > 0 && <> ({pendingCount} pending approval)</>}
        </p>
      </div>

      <PayoutLedger rows={ledgerRows} />
    </div>
  )
}
