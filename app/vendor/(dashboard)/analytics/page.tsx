import { TrendingDown, TrendingUp } from 'lucide-react'
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
  const m = data.keyMetrics

  /** Render a Booking-count delta vs the prior 30-day window, or an honest
   *  neutral hint when the prior period had no data to compare against — we
   *  NEVER fabricate a "+100%". */
  function deltaHint(change: number | null) {
    if (change === null) {
      return (
        <p className="mt-1 text-xs text-muted-foreground">{t('noPriorPeriod')}</p>
      )
    }
    const up = change >= 0
    const Icon = up ? TrendingUp : TrendingDown
    return (
      <p
        className={`mt-1 flex items-center gap-1 text-xs tabular-nums ${
          up ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
        }`}
      >
        <Icon className="size-3.5" aria-hidden />
        <span>
          {up ? '+' : ''}
          {change.toFixed(1)}% {t('vsPriorPeriod')}
        </span>
      </p>
    )
  }

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

      {/* Key Metrics grid — all figures derived from REAL Bookings. Rendered
          only when the Vendor has data; the empty state below covers the rest.
          Responsive per ADR-0018: 1-col (base) → 2-col (md:) → 4-col (lg:),
          mirroring the dashboard KPI grid idiom. Semantic tokens + tabular-nums.
          Revenue is GROSS (ADR-0016); no net/payout/"you keep X%" figure. */}
      {data.hasData ? (
        <section className="space-y-4" data-testid="analytics-key-metrics">
          <h2 className="text-lg font-semibold tracking-tight">
            {t('keyMetricsHeading')}
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('last30RevenueLabel')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">
                  ₹{m.last30Revenue.toLocaleString('en-IN')}
                </p>
                {deltaHint(m.last30RevenueChange)}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('last30BookingsLabel')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">
                  {m.last30Bookings.toLocaleString('en-IN')}
                </p>
                {deltaHint(m.last30BookingsChange)}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('avgBookingValueLabel')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">
                  ₹{m.avgBookingValue.toLocaleString('en-IN')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('avgBookingValueHint')}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('cancellationRateLabel')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">
                  {m.cancellationRate.toFixed(1)}%
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('cancellationRateHint')}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('upcoming7Label')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">
                  {m.upcoming7Confirmed.toLocaleString('en-IN')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('upcoming7Hint')}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('newBookings7Label')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">
                  {m.newBookings7.toLocaleString('en-IN')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('newBookings7Hint')}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('repeatCustomersLabel')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">
                  {m.repeatCustomers.toLocaleString('en-IN')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('repeatCustomersHint')}
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}

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
