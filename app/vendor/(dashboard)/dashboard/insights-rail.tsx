'use client'

import { Clock, Info, TrendingUp } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Insight } from '@/lib/vendor/dashboard-loader'

interface InsightsRailProps {
  readonly insights: readonly Insight[]
}

/**
 * Per-type presentation for a growth insight. Each type pairs a semantic
 * status token (DESIGN.md §2) WITH a lucide icon, so meaning is never carried
 * by color alone (DESIGN.md §1.3 / WCAG 1.4.1):
 *   - likely_to_sell_out → warning (urgency) + Clock
 *   - top_performer      → success (positive) + TrendingUp
 *   - off_peak_gap       → info (opportunity) + Info
 */
const INSIGHT_STYLE = {
  likely_to_sell_out: {
    Icon: Clock,
    accent: 'border-l-warning bg-warning-subtle',
    ink: 'text-warning',
  },
  top_performer: {
    Icon: TrendingUp,
    accent: 'border-l-success bg-success-subtle',
    ink: 'text-success',
  },
  off_peak_gap: {
    Icon: Info,
    accent: 'border-l-info bg-info-subtle',
    ink: 'text-info',
  },
} as const

export function InsightsRail({ insights }: InsightsRailProps) {
  return (
    <Card data-testid="insights-rail" className="h-fit">
      <CardHeader>
        <CardTitle className="text-lg">Insights &amp; Actions</CardTitle>
      </CardHeader>
      <CardContent>
        {insights.length === 0 ? (
          <p
            data-testid="insights-rail-empty"
            className="py-4 text-center text-sm text-muted-foreground"
          >
            No insights yet. They appear as your bookings grow.
          </p>
        ) : (
          <ul className="space-y-3">
            {insights.map((insight) => {
              const style = INSIGHT_STYLE[insight.type]
              const Icon = style.Icon
              return (
                <li
                  key={insight.id}
                  data-testid={`insight-${insight.type}`}
                  className={`flex items-start gap-3 rounded-lg border border-l-4 p-3 ${style.accent}`}
                >
                  <Icon
                    className={`mt-0.5 size-4 shrink-0 ${style.ink}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{insight.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      {insight.subtitle}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
