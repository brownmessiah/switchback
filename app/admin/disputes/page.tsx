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
import {
  availabilitySlots,
  bookings,
  experiences,
  users,
  vendorProfiles,
} from '@/db/schema'

import { DisputeActionsCell } from './dispute-actions-cell'

export default async function AdminDisputesPage() {
  const rows = await db
    .select({
      id: bookings.id,
      state: bookings.state,
      participantCount: bookings.participantCount,
      grossTotalSnapshot: bookings.grossTotalSnapshot,
      commissionRateSnapshot: bookings.commissionRateSnapshot,
      paymentMode: bookings.paymentMode,
      payoutState: bookings.payoutState,
      confirmedAt: bookings.confirmedAt,
      customerName: users.name,
      customerEmail: users.email,
      experienceTitle: experiences.title,
      vendorBusinessName: vendorProfiles.businessName,
      slotStart: availabilitySlots.startAt,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(users, eq(bookings.customerUserId, users.id))
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .leftJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .where(eq(bookings.state, 'disputed'))
    .orderBy(desc(bookings.confirmedAt))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dispute queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} disputed booking{rows.length === 1 ? '' : 's'} awaiting resolution.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No disputed bookings. All clear.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Experience</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Commission</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Payout</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const grossRupees = Math.floor(Number(row.grossTotalSnapshot))
                  return (
                    <TableRow key={row.id} data-booking-id={row.id}>
                      <TableCell>
                        <div className="text-sm font-medium">{row.customerName}</div>
                        <div className="text-xs text-muted-foreground">{row.customerEmail}</div>
                      </TableCell>
                      <TableCell className="text-sm">{row.experienceTitle}</TableCell>
                      <TableCell className="text-sm">{row.vendorBusinessName}</TableCell>
                      <TableCell className="text-sm font-medium">
                        ₹{grossRupees.toLocaleString('en-IN')}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.commissionRateSnapshot}%
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.slotStart
                          ? row.slotStart.toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={row.payoutState === 'held' ? 'outline' : 'secondary'}
                          className="text-xs"
                        >
                          {row.payoutState}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DisputeActionsCell
                          bookingId={row.id}
                          grossTotal={grossRupees}
                          commissionRate={row.commissionRateSnapshot}
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
