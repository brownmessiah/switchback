import { and, count, eq, gte, sql, sum } from 'drizzle-orm'
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
import { availabilitySlots, bookings, experiences, vendorProfiles } from '@/db/schema'
import { auth } from '@/lib/auth'

export default async function VendorDashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  const [vendor] = await db
    .select()
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, userId))
    .limit(1)

  const [expCount] = await db
    .select({ count: count() })
    .from(experiences)
    .where(eq(experiences.vendorUserId, userId))

  const [bookingStats] = await db
    .select({
      total: count(),
      revenue: sum(bookings.grossTotalSnapshot),
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(eq(experiences.vendorUserId, userId))

  const upcomingBookings = await db
    .select({
      bookingId: bookings.id,
      participantCount: bookings.participantCount,
      state: bookings.state,
      gross: bookings.grossTotalSnapshot,
      slotStart: availabilitySlots.startAt,
      expTitle: experiences.title,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .where(
      and(
        eq(experiences.vendorUserId, userId),
        gte(availabilitySlots.startAt, new Date()),
      ),
    )
    .orderBy(availabilitySlots.startAt)
    .limit(5)

  const totalRevenue = Math.floor(Number(bookingStats?.revenue ?? 0))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          Welcome back{vendor ? `, ${vendor.businessName}` : ''}.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Listings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{expCount?.count ?? 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total bookings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{bookingStats?.total ?? 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              ₹{totalRevenue.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              KYC tier
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={vendor?.kycTier === 'business' ? 'default' : 'secondary'} className="capitalize">
              {vendor?.kycTier ?? 'phone'}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming bookings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Upcoming bookings</CardTitle>
        </CardHeader>
        <CardContent>
          {upcomingBookings.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No upcoming bookings yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Experience</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Guests</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upcomingBookings.map((b) => (
                  <TableRow key={b.bookingId}>
                    <TableCell className="font-medium">{b.expTitle}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {b.slotStart
                        ? new Date(b.slotStart).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                          })
                        : '—'}
                    </TableCell>
                    <TableCell>{b.participantCount}</TableCell>
                    <TableCell>₹{Math.floor(Number(b.gross ?? 0)).toLocaleString('en-IN')}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize text-xs">
                        {b.state}
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
