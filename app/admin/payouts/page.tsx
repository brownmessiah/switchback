import { eq, inArray } from 'drizzle-orm'

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
import { bookings, experiences, vendorProfiles } from '@/db/schema'

import { PayoutActionsCell } from './payout-actions-cell'

export default async function AdminPayoutsPage() {
  const rows = await db
    .select({
      bookingId: bookings.id,
      state: bookings.state,
      payoutState: bookings.payoutState,
      gross: bookings.grossTotalSnapshot,
      commissionRate: bookings.commissionRateSnapshot,
      tdsAmount: bookings.tdsAmountSnapshot,
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payout queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} booking{rows.length === 1 ? '' : 's'} in queue
          {pendingCount > 0 && (
            <> ({pendingCount} pending approval)</>
          )}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No payouts pending.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Experience</TableHead>
                  <TableHead>Gross</TableHead>
                  <TableHead>Commission</TableHead>
                  <TableHead>TDS</TableHead>
                  <TableHead>Net</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const gross = Math.floor(Number(row.gross ?? 0))
                  const commRate = Number(row.commissionRate ?? 20) / 100
                  const commission = Math.floor(gross * commRate)
                  const tds = Math.floor(Number(row.tdsAmount ?? 0))
                  const net = gross - commission - tds
                  return (
                    <TableRow key={row.bookingId}>
                      <TableCell className="font-medium">{row.vendorName}</TableCell>
                      <TableCell className="text-sm">{row.expTitle}</TableCell>
                      <TableCell className="text-sm">
                        ₹{gross.toLocaleString('en-IN')}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        -₹{commission.toLocaleString('en-IN')}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        -₹{tds.toLocaleString('en-IN')}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        ₹{net.toLocaleString('en-IN')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">
                          {row.state.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <PayoutActionsCell
                          bookingId={row.bookingId}
                          payoutState={row.payoutState}
                          manualPayoutsRemaining={row.manualPayoutsRemaining}
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
