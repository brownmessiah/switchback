import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { loadVendorAnalytics } from '@/lib/vendor/analytics-loader'

/**
 * Vendor Analytics surface (issue 01 — tracer bullet).
 *
 * Lives inside the `(dashboard)` route group, so it inherits the auth +
 * vendor-profile gate and the VendorSidebar/<main> shell from
 * `app/vendor/(dashboard)/layout.tsx` (ADR-0006). No gate or shell is
 * re-implemented here.
 *
 * Renders the two headline KPIs from REAL aggregated data:
 *   - Total revenue — GROSS Vendor-attributable Booking value (before
 *     Commission / GST / TDS / TCS — those live on the Payouts ledger,
 *     ADR-0016). Labelled consistently with the Payouts page; no
 *     "you keep X%" figure is shown.
 *   - Total bookings — all-time confirmed reservations across the Vendor's
 *     Experiences.
 *
 * When the Vendor has no Bookings, an honest empty state is shown instead of a
 * fabricated value (ADR-0012: all visible strings via next-intl).
 */
export default async function VendorAnalyticsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  const data = await loadVendorAnalytics(db, userId)
  const t = await getTranslations('VendorAnalytics')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Headline KPI row — 1-col (base) → 2-col (md:), mirroring the dashboard
          KPI cards. Semantic tokens only; figures use tabular-nums. */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('totalRevenue')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              ₹{data.totalRevenue.toLocaleString('en-IN')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('totalRevenueHint')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('totalBookings')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              {data.totalBookings.toLocaleString('en-IN')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('totalBookingsHint')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Honest empty state — no fabricated values when there are no Bookings. */}
      {!data.hasData ? (
        <Card data-testid="analytics-empty-state">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t('emptyState')}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
