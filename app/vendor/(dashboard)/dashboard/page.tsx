import { AlertTriangle, CheckCircle2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { headers } from 'next/headers'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ResponsiveTable } from '@/components/ui/responsive-table'
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
import { VendorQuickActions } from './quick-actions'

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
    // grid-cols-1 at the base breakpoint pins the single mobile column to the
    // track width — without it the column auto-sizes to max-content and the
    // charts/insights push the page wider than the viewport (mobile h-overflow).
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {/* Main column */}
      <div className="min-w-0 space-y-8">
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

      {/* Quick-action wayfinding row (#04) — shortcuts to the highest-frequency
          Vendor surfaces. Placed above the KPI grid; existing KPIs/charts/
          action-items/upcoming-bookings below are unchanged. */}
      <VendorQuickActions />

      {/* Enhanced stat cards — compact single-metric KPI row: 1-col (base) →
          2-col (md:) → 4-col (lg:). The structural flip keys off md:/lg: per
          §8.1 (never sm:); 4-up at lg is permitted for compact KPI rows. */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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

      {/* Upcoming bookings — A3 table migrated to ResponsiveTable (ADR-0018 /
          DESIGN.md §8.5): Table ≥ md, stacked label:value Cards < md. The
          heading rides above the table since ResponsiveTable owns its own
          Card shell (no nested card-in-card). */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Upcoming bookings</h2>
        <ResponsiveTable
          caption="Upcoming bookings"
          rows={data.upcomingBookings}
          getRowKey={(b) => b.bookingId}
          rowProps={(b) => ({ 'data-booking-id': b.bookingId })}
          empty="No upcoming bookings yet."
          columns={[
            {
              key: 'expTitle',
              header: 'Experience',
              primary: true,
              cell: (b) => b.expTitle,
            },
            {
              key: 'date',
              header: 'Date',
              cell: (b) => (
                <span className="text-sm text-muted-foreground">
                  {b.slotStart
                    ? new Date(b.slotStart).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      })
                    : '—'}
                </span>
              ),
            },
            {
              key: 'guests',
              header: 'Guests',
              align: 'right',
              cell: (b) => b.participantCount,
            },
            {
              key: 'amount',
              header: 'Amount',
              align: 'right',
              cell: (b) => `₹${b.gross.toLocaleString('en-IN')}`,
            },
            {
              key: 'status',
              header: 'Status',
              cell: (b) => (
                <Badge variant="outline" className="capitalize text-xs">
                  {b.state}
                </Badge>
              ),
            },
          ]}
        />
      </div>
      </div>

      {/* Insights rail (C "Insight-First Growth Hub" — issue #74) */}
      <InsightsRail insights={data.insights} />
    </div>
  )
}
