import { Download } from 'lucide-react'
import { headers } from 'next/headers'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'

import { CsvExportButton } from './csv-export-button'
import { loadReportSummary } from './loaders'
import { ReportSummaryCards } from './report-summary-cards'

const CSV_EXPORTS: ReadonlyArray<{
  entity: 'users' | 'vendors' | 'bookings' | 'experiences'
  label: string
  desc: string
}> = [
  { entity: 'users', label: 'Export users', desc: 'Accounts, contact, verification.' },
  { entity: 'vendors', label: 'Export vendors', desc: 'KYC tier, commission, status.' },
  { entity: 'bookings', label: 'Export bookings', desc: 'Snapshots, totals, lifecycle state.' },
  { entity: 'experiences', label: 'Export experiences', desc: 'Listings, pricing, moderation.' },
]

export default async function ReportsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  await requirePermission(db, session!.user.id, 'reports')

  const summary = await loadReportSummary(db)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-h2 font-semibold tracking-tight">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform summary and data exports.
        </p>
      </div>

      {/* Summary band — token-true money/count cards (DESIGN.md §2.2) */}
      <section aria-label="Platform summary">
        <ReportSummaryCards summary={summary} />
      </section>

      {/* CSV export section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Data exports</CardTitle>
          <p className="text-sm text-muted-foreground">
            Download platform data as CSV files. Each export includes all
            records sorted by creation date.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {CSV_EXPORTS.map(({ entity, label, desc }) => (
              <div
                key={entity}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-info-subtle text-info">
                    <Download className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium capitalize">{entity}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </div>
                <CsvExportButton entity={entity} label={label} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
