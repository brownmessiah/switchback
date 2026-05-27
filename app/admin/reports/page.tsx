import { headers } from 'next/headers'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'

import { CsvExportButton } from './csv-export-button'
import { loadReportSummary } from './loaders'

export default async function ReportsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  await requirePermission(db, session!.user.id, 'reports')

  const summary = await loadReportSummary(db)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-1 text-muted-foreground">
          Platform summary and data exports.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              ₹{summary.totalRevenue.toLocaleString('en-IN')}
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
            <p className="text-3xl font-semibold">
              {summary.totalBookings.toLocaleString('en-IN')}
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
            <p className="text-3xl font-semibold">
              {summary.totalUsers.toLocaleString('en-IN')}
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
            <p className="text-3xl font-semibold">
              {summary.totalVendors.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total experiences
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {summary.totalExperiences.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* CSV export section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Data exports</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Download platform data as CSV files. Each export includes all
            records sorted by creation date.
          </p>
          <div className="flex flex-wrap gap-3">
            <CsvExportButton entity="users" label="Export users" />
            <CsvExportButton entity="vendors" label="Export vendors" />
            <CsvExportButton entity="bookings" label="Export bookings" />
            <CsvExportButton entity="experiences" label="Export experiences" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
