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
import { auth } from '@/lib/auth'
import { loadVendorDashboard, slaColor } from '@/lib/vendor/dashboard-loader'

import { ActionItems } from './action-items'
import { TrendChart } from './dashboard-charts'

const SLA_COLOR_MAP = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
} as const

export default async function VendorDashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  const data = await loadVendorDashboard(db, userId)

  const slaColorKey = slaColor(data.slaScore)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          Welcome back{data.businessName ? `, ${data.businessName}` : ''}.
        </p>
      </div>

      {/* Enhanced stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Today&apos;s bookings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{data.todayBookings}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.totalBookings} total all time
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{data.pendingActionsCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              bookings needing response
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              This month&apos;s revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              ₹{data.monthRevenue.toLocaleString('en-IN')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              ₹{data.totalRevenue.toLocaleString('en-IN')} total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              SLA score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-semibold">{data.slaScore.toFixed(1)}%</p>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SLA_COLOR_MAP[slaColorKey]}`}
              >
                {slaColorKey === 'green'
                  ? 'Excellent'
                  : slaColorKey === 'yellow'
                    ? 'Needs improvement'
                    : 'At risk'}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Response time performance
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Trend charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TrendChart
          title="Bookings (last 30 days)"
          data={data.bookingsTrend}
          color="hsl(221, 83%, 53%)"
          type="area"
        />
        <TrendChart
          title="Revenue (last 30 days)"
          data={data.revenueTrend}
          color="hsl(142, 71%, 45%)"
          type="bar"
          formatAs="currency"
        />
      </div>

      {/* Action items */}
      <ActionItems items={data.actionItems} />

      {/* Upcoming bookings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Upcoming bookings</CardTitle>
        </CardHeader>
        <CardContent>
          {data.upcomingBookings.length === 0 ? (
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
                {data.upcomingBookings.map((b) => (
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
                    <TableCell>
                      ₹{b.gross.toLocaleString('en-IN')}
                    </TableCell>
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
