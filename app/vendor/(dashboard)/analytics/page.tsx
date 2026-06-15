import { TrendingDown, TrendingUp } from 'lucide-react'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'

import { BookingStatusBadge } from '@/components/booking-status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ResponsiveTable } from '@/components/ui/responsive-table'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { bookingStatusBadge } from '@/lib/bookings/booking-status-badge'
import {
  type BookingStatusCount,
  type ExperienceRevenue,
  loadVendorAnalytics,
} from '@/lib/vendor/analytics-loader'

import { TrendChart } from '../dashboard/dashboard-charts'

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
  // Reuse the shared, already-translated Booking-state labels (the BookingStatus
  // namespace exists in every locale) rather than re-authoring state vocab.
  const ts = await getTranslations('BookingStatus')
  const m = data.keyMetrics

  /** Resolve a Booking state to its human label, reusing the shared badge
   *  helper's label-key (falls back to the raw state for an unknown value). */
  function statusLabel(state: string): string {
    const labelKey = bookingStatusBadge(state).labelKey
    // ts.has guards an unknown/future state so a missing key never throws.
    return ts.has(labelKey) ? ts(labelKey) : state.replace(/_/g, ' ')
  }

  // Per-section emptiness — an honest empty state keys off real backing data,
  // never a fabricated value. The day/month series are always FILLED windows,
  // so "no data" means every point is 0 (sum === 0).
  const dayHasData = data.revenueByDay.some((d) => d.value > 0)
  const monthHasData = data.revenueByMonth.some((d) => d.value > 0)

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
          up ? 'text-success' : 'text-destructive'
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

      {/* Charts + breakdowns (issue 03). Rendered for a Vendor WITH Bookings;
          each chart/section carries its OWN honest empty state so a partially
          populated Vendor never sees a fabricated value. Charts render THROUGH
          the SHARED dashboard `TrendChart` primitive (imported, never forked) —
          the same recharts wrapper the dashboard-home charts use. Revenue is
          GROSS (ADR-0016); no net/payout/"you keep X%" figure. */}
      {data.hasData ? (
        <>
          {/* Trends — daily (area) + monthly (bar) gross revenue. Each chart
              shows a muted "no data yet" placeholder when its series is all-0. */}
          <section className="space-y-4" data-testid="analytics-charts">
            <h2 className="text-lg font-semibold tracking-tight">
              {t('chartsHeading')}
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {dayHasData ? (
                <TrendChart
                  title={t('revenueDayChartTitle')}
                  data={data.revenueByDay}
                  colorToken="chart-2"
                  type="area"
                  formatAs="currency"
                />
              ) : (
                <Card data-testid="analytics-revenue-day-empty">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-medium">
                      {t('revenueDayChartTitle')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                    {t('chartNoData')}
                  </CardContent>
                </Card>
              )}

              {monthHasData ? (
                <TrendChart
                  title={t('revenueMonthChartTitle')}
                  data={data.revenueByMonth}
                  colorToken="chart-1"
                  type="bar"
                  formatAs="currency"
                />
              ) : (
                <Card data-testid="analytics-revenue-month-empty">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-medium">
                      {t('revenueMonthChartTitle')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                    {t('chartNoData')}
                  </CardContent>
                </Card>
              )}
            </div>
          </section>

          {/* Booking status breakdown — counts grouped by Booking state, using
              the SHARED ResponsiveTable + BookingStatusBadge so the colour/icon/
              label triple matches the bookings table. Only occurring states show. */}
          <section className="space-y-4" data-testid="analytics-status-breakdown">
            <h2 className="text-lg font-semibold tracking-tight">
              {t('statusBreakdownHeading')}
            </h2>
            <ResponsiveTable<BookingStatusCount>
              caption={t('statusBreakdownHeading')}
              rows={data.bookingStatusBreakdown}
              getRowKey={(r) => r.state}
              rowProps={(r) => ({ 'data-booking-state': r.state })}
              empty={t('statusBreakdownEmpty')}
              columns={[
                {
                  key: 'state',
                  header: t('statusColumnLabel'),
                  primary: true,
                  cell: (r) => (
                    <BookingStatusBadge
                      state={r.state}
                      label={statusLabel(r.state)}
                      className="text-xs"
                    />
                  ),
                },
                {
                  key: 'count',
                  header: t('statusCountColumn'),
                  align: 'right',
                  cell: (r) => r.count.toLocaleString('en-IN'),
                },
              ]}
            />
          </section>

          {/* Revenue by Experience — each Experience's Booking count + GROSS
              revenue, ordered by revenue desc, via the SHARED ResponsiveTable.
              Experiences with no Bookings are omitted (honest, no 0/0 noise). */}
          <section
            className="space-y-4"
            data-testid="analytics-revenue-by-experience"
          >
            <h2 className="text-lg font-semibold tracking-tight">
              {t('revenueByExperienceHeading')}
            </h2>
            <ResponsiveTable<ExperienceRevenue>
              caption={t('revenueByExperienceHeading')}
              rows={data.revenueByExperience}
              getRowKey={(r) => r.experienceId}
              rowProps={(r) => ({ 'data-experience-id': r.experienceId })}
              empty={t('revenueByExperienceEmpty')}
              columns={[
                {
                  key: 'title',
                  header: t('experienceColumn'),
                  primary: true,
                  cell: (r) => r.title,
                },
                {
                  key: 'bookings',
                  header: t('bookingsColumn'),
                  align: 'right',
                  cell: (r) => r.bookings.toLocaleString('en-IN'),
                },
                {
                  key: 'revenue',
                  header: t('revenueColumn'),
                  align: 'right',
                  cell: (r) => `₹${r.revenue.toLocaleString('en-IN')}`,
                },
              ]}
            />
          </section>
        </>
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
