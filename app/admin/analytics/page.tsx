import {
  BadgeIndianRupee,
  CalendarCheck,
  Compass,
  Store,
  TrendingUp,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { headers } from 'next/headers'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'
import { cn } from '@/lib/utils'

import { formatRupees } from '../_components/money'
import {
  BookingVolumeChart,
  CategoryPerformanceChart,
  RevenueTrendChart,
  VendorGrowthChart,
} from './analytics-charts'
import { loadAnalytics } from './loaders'

/** Semantic accent for each KPI tile (status never by colour alone — §1.3). */
type Tone = 'success' | 'info' | 'credit' | 'warning'

const TONE_ICON_CLASS: Record<Tone, string> = {
  success: 'bg-success-subtle text-success',
  info: 'bg-info-subtle text-info',
  credit: 'bg-credit-subtle text-credit',
  warning: 'bg-warning-subtle text-warning',
}

interface KpiCardSpec {
  readonly testId: string
  readonly label: string
  readonly value: string
  readonly icon: LucideIcon
  readonly tone: Tone
}

export default async function AnalyticsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  await requirePermission(db, session!.user.id, 'analytics')

  const { kpi, revenueTrend, bookingVolume, vendorGrowth, categoryPerformance } =
    await loadAnalytics(db)

  // Token-true KPI band — money via formatRupees, all figures .tabular-nums
  // (DESIGN.md §2.2). Exact 6 labels preserved (E2E matches them by text).
  const kpis: readonly KpiCardSpec[] = [
    {
      testId: 'kpi-total-revenue',
      label: 'Total revenue',
      value: formatRupees(kpi.totalRevenue),
      icon: TrendingUp,
      tone: 'success',
    },
    {
      testId: 'kpi-total-bookings',
      label: 'Total bookings',
      value: kpi.totalBookings.toLocaleString('en-IN'),
      icon: CalendarCheck,
      tone: 'info',
    },
    {
      testId: 'kpi-avg-booking-value',
      label: 'Avg booking value',
      value: formatRupees(kpi.averageBookingValue),
      icon: BadgeIndianRupee,
      tone: 'success',
    },
    {
      testId: 'kpi-total-users',
      label: 'Total users',
      value: kpi.totalUsers.toLocaleString('en-IN'),
      icon: Users,
      tone: 'info',
    },
    {
      testId: 'kpi-total-vendors',
      label: 'Total vendors',
      value: kpi.totalVendors.toLocaleString('en-IN'),
      icon: Store,
      tone: 'credit',
    },
    {
      testId: 'kpi-published-experiences',
      label: 'Published experiences',
      value: kpi.publishedExperiences.toLocaleString('en-IN'),
      icon: Compass,
      tone: 'warning',
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-h2 font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform performance and growth metrics.
        </p>
      </div>

      {/* KPI band */}
      <section aria-label="Platform KPIs">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {kpis.map((k) => (
            <KpiCard key={k.testId} {...k} />
          ))}
        </div>
      </section>

      {/* Charts — 2x2 grid, brand chart tokens (DESIGN.md §2.1) */}
      <section aria-label="Trends" className="grid gap-4 lg:grid-cols-2">
        <RevenueTrendChart data={revenueTrend} />
        <BookingVolumeChart data={bookingVolume} />
        <VendorGrowthChart data={vendorGrowth} />
        <CategoryPerformanceChart data={categoryPerformance} />
      </section>
    </div>
  )
}

function KpiCard({ testId, label, value, icon: Icon, tone }: KpiCardSpec) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
          <span
            className={cn(
              'flex size-8 items-center justify-center rounded-[var(--radius-control)]',
              TONE_ICON_CLASS[tone],
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums" data-testid={testId}>
          {value}
        </p>
      </CardContent>
    </Card>
  )
}
