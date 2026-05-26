import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { db } from '@/db/client'
import { availabilitySlots, bookings, experiences, users } from '@/db/schema'
import { auth } from '@/lib/auth'

const STATE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  confirmed: 'default',
  awaiting_completion: 'secondary',
  completed: 'default',
  cancelled_by_customer: 'destructive',
  cancelled_by_vendor: 'destructive',
  disputed: 'destructive',
}

export default async function VendorBookingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  const rows = await db
    .select({
      bookingId: bookings.id,
      state: bookings.state,
      participantCount: bookings.participantCount,
      gross: bookings.grossTotalSnapshot,
      paymentMode: bookings.paymentMode,
      customerName: users.name,
      expTitle: experiences.title,
      slotStart: availabilitySlots.startAt,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(users, eq(bookings.customerUserId, users.id))
    .leftJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .where(eq(experiences.vendorUserId, userId))
    .orderBy(bookings.createdAt)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} booking{rows.length === 1 ? '' : 's'}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-lg font-medium">No bookings yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Bookings will appear here once customers start booking your experiences.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Experience</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Guests</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.bookingId}>
                    <TableCell className="font-medium">
                      {row.customerName ?? 'Customer'}
                    </TableCell>
                    <TableCell className="text-sm">{row.expTitle}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.slotStart
                        ? new Date(row.slotStart).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })
                        : '—'}
                    </TableCell>
                    <TableCell>{row.participantCount}</TableCell>
                    <TableCell>
                      ₹{Math.floor(Number(row.gross ?? 0)).toLocaleString('en-IN')}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={STATE_VARIANTS[row.state] ?? 'outline'}
                        className="capitalize text-xs"
                      >
                        {row.state.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
