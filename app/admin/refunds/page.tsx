import { desc, eq } from 'drizzle-orm'

import { db } from '@/db/client'
import { refundRequests, users } from '@/db/schema'

import { RefundLedger, type RefundLedgerRow } from './refund-ledger'
import { RefundStatusFilter } from './refund-status-filter'

interface AdminRefundsPageProps {
  searchParams: Promise<{ status?: string }>
}

export default async function AdminRefundsPage({ searchParams }: AdminRefundsPageProps) {
  const params = await searchParams
  const statusFilter = params.status

  let query = db
    .select({
      id: refundRequests.id,
      state: refundRequests.state,
      amount: refundRequests.amount,
      reason: refundRequests.reason,
      destination: refundRequests.destination,
      bookingId: refundRequests.bookingId,
      customerEmail: users.email,
      customerUserId: refundRequests.requestedByUserId,
      notes: refundRequests.notes,
      createdAt: refundRequests.createdAt,
      resolvedAt: refundRequests.resolvedAt,
    })
    .from(refundRequests)
    .innerJoin(users, eq(refundRequests.requestedByUserId, users.id))
    .orderBy(desc(refundRequests.createdAt))
    .$dynamic()

  if (statusFilter && ['pending', 'approved', 'credited', 'failed', 'rejected'].includes(statusFilter)) {
    query = query.where(
      eq(refundRequests.state, statusFilter as typeof refundRequests.state.enumValues[number]),
    )
  }

  const rows = await query

  const pendingCount = rows.filter((r) => r.state === 'pending').length

  const ledgerRows: RefundLedgerRow[] = rows.map((row) => ({
    id: row.id,
    state: row.state,
    amount: Math.floor(Number(row.amount)),
    reason: row.reason,
    destination: row.destination,
    bookingId: row.bookingId,
    customerEmail: row.customerEmail,
    notes: row.notes,
    createdAtLabel: row.createdAt.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Refund requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} request{rows.length === 1 ? '' : 's'}
          {pendingCount > 0 && <> ({pendingCount} pending review)</>}
        </p>
      </div>

      <RefundStatusFilter currentStatus={statusFilter} />

      <RefundLedger rows={ledgerRows} />
    </div>
  )
}
