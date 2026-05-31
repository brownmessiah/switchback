'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import type { CategoryDataPoint, MonthDataPoint, WeekDataPoint } from './loaders'

// ── Brand chart tokens (DESIGN.md §2.1) ───────────────────────────
//
// The as-is charts used an off-brand literal `hsl(...)` palette. DESIGN.md
// §2.1 keeps the `--chart-1..5` token family verbatim — chart-1 is the coral
// brand (tracks `--primary`), charts 2–5 are theme-invariant (green / blue /
// amber / purple) and re-value automatically in `.dark`. recharts accepts a
// CSS-var string for fill/stroke (this is exactly what #74 vendor-dashboard
// did), so each series is bound to a token, not a baked literal.

/** Coral brand — booking volume bars (the platform's primary throughput). */
export const CHART_TOKEN_BOOKINGS = 'var(--chart-1)' as const
/** Green — revenue trend area (affirmative money growth). */
export const CHART_TOKEN_REVENUE = 'var(--chart-2)' as const
/** Purple — vendor growth line (supply-side, distinct from money/throughput). */
export const CHART_TOKEN_VENDORS = 'var(--chart-5)' as const

/** Full chart-1..5 family, cycled across the category-performance pie slices. */
export const CATEGORY_CHART_TOKENS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const

// ── Revenue trend (area chart, monthly) ───────────────────────────

interface RevenueTrendChartProps {
  readonly data: readonly MonthDataPoint[]
}

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[Number(month) - 1]} '${year?.slice(2)}`
}

export function RevenueTrendChart({ data }: RevenueTrendChartProps) {
  const chartData = data.map((d) => ({
    ...d,
    label: formatMonth(d.month),
  }))

  return (
    <Card data-testid="chart-revenue-trend" data-chart-token={CHART_TOKEN_REVENUE}>
      <CardHeader className="pb-2">
        <CardTitle className="text-h3 font-heading font-semibold">Revenue trend (monthly)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revenue-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_TOKEN_REVENUE} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_TOKEN_REVENUE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                tickLine={false}
                axisLine={false}
                width={50}
                tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                content={({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
                  if (!active || !payload?.length) return null
                  const point = payload[0]!.payload as MonthDataPoint & { label: string }
                  return (
                    <div className="rounded-[var(--radius-control)] border bg-popover p-2 shadow-md">
                      <p className="text-xs text-muted-foreground">{point.label}</p>
                      <p className="text-sm font-semibold tabular-nums">
                        ₹{point.value.toLocaleString('en-IN')}
                      </p>
                    </div>
                  )
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={CHART_TOKEN_REVENUE}
                strokeWidth={2}
                fill="url(#revenue-gradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Booking volume (bar chart, weekly) ────────────────────────────

interface BookingVolumeChartProps {
  readonly data: readonly WeekDataPoint[]
}

export function BookingVolumeChart({ data }: BookingVolumeChartProps) {
  return (
    <Card data-testid="chart-booking-volume" data-chart-token={CHART_TOKEN_BOOKINGS}>
      <CardHeader className="pb-2">
        <CardTitle className="text-h3 font-heading font-semibold">Booking volume (weekly)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                tickLine={false}
                axisLine={false}
                width={30}
                allowDecimals={false}
              />
              <Tooltip
                content={({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
                  if (!active || !payload?.length) return null
                  const point = payload[0]!.payload as WeekDataPoint
                  return (
                    <div className="rounded-[var(--radius-control)] border bg-popover p-2 shadow-md">
                      <p className="text-xs text-muted-foreground">{point.week}</p>
                      <p className="text-sm font-semibold tabular-nums">{point.value} bookings</p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="value" fill={CHART_TOKEN_BOOKINGS} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Vendor growth (line chart, monthly) ───────────────────────────

interface VendorGrowthChartProps {
  readonly data: readonly MonthDataPoint[]
}

export function VendorGrowthChart({ data }: VendorGrowthChartProps) {
  const chartData = data.map((d) => ({
    ...d,
    label: formatMonth(d.month),
  }))

  return (
    <Card data-testid="chart-vendor-growth" data-chart-token={CHART_TOKEN_VENDORS}>
      <CardHeader className="pb-2">
        <CardTitle className="text-h3 font-heading font-semibold">Vendor growth (monthly)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                tickLine={false}
                axisLine={false}
                width={30}
                allowDecimals={false}
              />
              <Tooltip
                content={({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
                  if (!active || !payload?.length) return null
                  const point = payload[0]!.payload as MonthDataPoint & { label: string }
                  return (
                    <div className="rounded-[var(--radius-control)] border bg-popover p-2 shadow-md">
                      <p className="text-xs text-muted-foreground">{point.label}</p>
                      <p className="text-sm font-semibold tabular-nums">{point.value} new vendors</p>
                    </div>
                  )
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={CHART_TOKEN_VENDORS}
                strokeWidth={2}
                dot={{ fill: CHART_TOKEN_VENDORS, r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Category performance (pie chart) ──────────────────────────────

interface CategoryPerformanceChartProps {
  readonly data: readonly CategoryDataPoint[]
}

function formatActivityName(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function CategoryPerformanceChart({ data }: CategoryPerformanceChartProps) {
  const chartData = data.map((d) => ({
    ...d,
    name: formatActivityName(d.name),
  }))

  return (
    <Card data-testid="chart-category-performance" data-chart-token={CATEGORY_CHART_TOKENS[0]}>
      <CardHeader className="pb-2">
        <CardTitle className="text-h3 font-heading font-semibold">Category performance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[280px] w-full">
          {chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No booking data yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }: { name?: string; percent?: number }) =>
                    `${name ?? ''} (${((percent ?? 0) * 100).toFixed(0)}%)`
                  }
                >
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={CATEGORY_CHART_TOKENS[i % CATEGORY_CHART_TOKENS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
                    if (!active || !payload?.length) return null
                    const point = payload[0]!.payload as CategoryDataPoint & { name: string }
                    return (
                      <div className="rounded-[var(--radius-control)] border bg-popover p-2 shadow-md">
                        <p className="text-xs text-muted-foreground">{point.name}</p>
                        <p className="text-sm font-semibold tabular-nums">{point.value} bookings</p>
                      </div>
                    )
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
