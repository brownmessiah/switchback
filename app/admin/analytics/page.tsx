import { headers } from 'next/headers'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'

import {
  BookingVolumeChart,
  CategoryPerformanceChart,
  RevenueTrendChart,
  VendorGrowthChart,
} from './analytics-charts'
import { loadAnalytics } from './loaders'

export default async function AnalyticsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  await requirePermission(db, session!.user.id, 'analytics')

  const { kpi, revenueTrend, bookingVolume, vendorGrowth, categoryPerformance } =
    await loadAnalytics(db)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 text-muted-foreground">
          Platform performance and growth metrics.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              ₹{kpi.totalRevenue.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total bookings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {kpi.totalBookings.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg booking value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              ₹{kpi.averageBookingValue.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {kpi.totalUsers.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total vendors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {kpi.totalVendors.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Published experiences
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {kpi.publishedExperiences.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts — 2x2 grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        <RevenueTrendChart data={revenueTrend} />
        <BookingVolumeChart data={bookingVolume} />
        <VendorGrowthChart data={vendorGrowth} />
        <CategoryPerformanceChart data={categoryPerformance} />
      </div>
    </div>
  )
}
