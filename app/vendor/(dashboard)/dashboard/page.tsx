import { AlertTriangle, CheckCircle2, ShieldCheck, TriangleAlert } from 'lucide-react'
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
import {
  loadVendorDashboard,
  slaColor,
  verifiedVendorBadgeLabel,
} from '@/lib/vendor/dashboard-loader'

import { ActionItems } from './action-items'
import { TrendChart } from './dashboard-charts'
import { InsightsRail } from './insights-rail'

/**
 * SLA badge presentation. Semantic status tokens (DESIGN.md §2) paired with a
 * lucide icon (DESIGN.md §1.3 / WCAG 1.4.1) so the status is never conveyed by
 * color alone — replacing the prior off-system green/yellow/red literals.
 */
const SLA_BADGE = {
  green: { variant: 'success' as const, Icon: CheckCircle2, label: 'Excellent' },
  yellow: { variant: 'warning' as const, Icon: TriangleAlert, label: 'Needs improvement' },
  red: { variant: 'destructive' as const, Icon: AlertTriangle, label: 'At risk' },
} as const

export default async function VendorDashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  const data = await loadVendorDashboard(db, userId)

  const slaColorKey = slaColor(data.slaScore)
  const slaBadge = SLA_BADGE[slaColorKey]
  const SlaIcon = slaBadge.Icon
  // ADR-0007: distinct trust badges per tier (identity vs business) — never
  // overstate the level. phone/unknown → null = no verified badge.
  const verifiedVendorLabel = verifiedVendorBadgeLabel(data.kycTier)

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {/* Main column */}
      <div className="space-y-8">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          {verifiedVendorLabel ? (
            <Badge variant="success" data-testid="verified-vendor-badge">
              <ShieldCheck aria-hidden="true" />
              {verifiedVendorLabel}
            </Badge>
          ) : null}
        </div>
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
            <p className="text-3xl font-semibold tabular-nums">{data.todayBookings}</p>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
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
            <p className="text-3xl font-semibold tabular-nums">{data.pendingActionsCount}</p>
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
            <p className="text-3xl font-semibold tabular-nums">
              ₹{data.monthRevenue.toLocaleString('en-IN')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
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
            {/* Wrap so the status pill drops below the figure at the 4-up
                breakpoint instead of clipping mid-word ("Exc…"). The pill keeps
                its full label and never truncates. */}
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p className="text-3xl font-semibold tabular-nums">
                {data.slaScore.toFixed(1)}%
              </p>
              <Badge variant={slaBadge.variant} className="whitespace-nowrap">
                <SlaIcon aria-hidden="true" />
                {slaBadge.label}
              </Badge>
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
          colorToken="chart-1"
          type="area"
        />
        <TrendChart
          title="Revenue (last 30 days)"
          data={data.revenueTrend}
          colorToken="chart-2"
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
                    <TableCell className="tabular-nums">{b.participantCount}</TableCell>
                    <TableCell className="tabular-nums">
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

      {/* Insights rail (C "Insight-First Growth Hub" — issue #74) */}
      <InsightsRail insights={data.insights} />
    </div>
  )
}
