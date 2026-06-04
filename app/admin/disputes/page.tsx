import { db } from '@/db/client'

import { DisputeLedger, type DisputeLedgerRow } from './dispute-ledger'
import { loadDisputedBookings } from './loaders'

export default async function AdminDisputesPage() {
  const rows = await loadDisputedBookings(db)

  const ledgerRows: DisputeLedgerRow[] = rows.map((row) => ({
    id: row.id,
    state: row.state,
    participantCount: row.participantCount,
    grossRupees: Math.floor(Number(row.grossTotalSnapshot)),
    commissionRatePercent: row.commissionRateSnapshot,
    paymentMode: row.paymentMode,
    payoutState: row.payoutState,
    confirmedAt: row.confirmedAt,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    experienceTitle: row.experienceTitle,
    vendorBusinessName: row.vendorBusinessName,
    slotStart: row.slotStart,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-h1 font-semibold tracking-tight">Dispute queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ledgerRows.length} disputed booking{ledgerRows.length === 1 ? '' : 's'} awaiting
          resolution.
        </p>
      </div>

      <DisputeLedger rows={ledgerRows} />
    </div>
  )
}
