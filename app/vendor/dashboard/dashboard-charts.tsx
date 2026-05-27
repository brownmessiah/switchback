'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DayDataPoint } from '@/lib/vendor/dashboard-loader'

interface TrendChartProps {
  readonly title: string
  readonly data: readonly DayDataPoint[]
  readonly color: string
  readonly formatValue?: (v: number) => string
  readonly type: 'area' | 'bar'
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function TrendChart({ title, data, color, formatValue, type }: TrendChartProps) {
  const formatter = formatValue ?? ((v: number) => String(v))

  // Show every 5th label to avoid crowding
  const chartData = data.map((d, i) => ({
    ...d,
    label: i % 5 === 0 ? formatDateLabel(d.date) : '',
  }))

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            {type === 'area' ? (
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`gradient-${color}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
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
                  width={40}
                  tickFormatter={formatter}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const point = payload[0]!.payload as DayDataPoint
                    return (
                      <div className="rounded-lg border bg-background p-2 shadow-sm">
                        <p className="text-xs text-muted-foreground">
                          {formatDateLabel(point.date)}
                        </p>
                        <p className="text-sm font-semibold">{formatter(point.value)}</p>
                      </div>
                    )
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#gradient-${color})`}
                />
              </AreaChart>
            ) : (
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
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
                  width={40}
                  tickFormatter={formatter}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const point = payload[0]!.payload as DayDataPoint
                    return (
                      <div className="rounded-lg border bg-background p-2 shadow-sm">
                        <p className="text-xs text-muted-foreground">
                          {formatDateLabel(point.date)}
                        </p>
                        <p className="text-sm font-semibold">{formatter(point.value)}</p>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
