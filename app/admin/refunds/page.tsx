import { desc, eq } from 'drizzle-orm'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { db } from '@/db/client'
import { refundRequests, users } from '@/db/schema'

import { RefundActionsCell } from './refund-actions-cell'
import { RefundStatusFilter } from './refund-status-filter'

interface AdminRefundsPageProps {
  searchParams: Promise<{ status?: string }>
}

const STATE_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  approved: 'secondary',
  credited: 'default',
  failed: 'destructive',
  rejected: 'destructive',
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Refund requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} request{rows.length === 1 ? '' : 's'}
          {pendingCount > 0 && (
            <> ({pendingCount} pending review)</>
          )}
        </p>
      </div>

      <RefundStatusFilter currentStatus={statusFilter} />

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No refund requests{statusFilter ? ` with status "${statusFilter}"` : ''}.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Booking</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const amount = Math.floor(Number(row.amount))
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-sm">{row.customerEmail}</TableCell>
                      <TableCell className="text-sm font-mono text-xs">
                        {row.bookingId.slice(0, 8)}...
                      </TableCell>
                      <TableCell className="text-sm capitalize">
                        {row.reason.replace(/_/g, ' ')}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        ₹{amount.toLocaleString('en-IN')}
                      </TableCell>
                      <TableCell className="text-sm capitalize">
                        {row.destination.replace(/_/g, ' ')}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={STATE_BADGE_VARIANT[row.state] ?? 'outline'}
                          className="capitalize text-xs"
                        >
                          {row.state}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.createdAt.toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </TableCell>
                      <TableCell>
                        <RefundActionsCell
                          refundRequestId={row.id}
                          state={row.state}
                          amount={amount}
                          notes={row.notes}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
