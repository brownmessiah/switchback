import { CalendarCheck, Compass, Store, TrendingUp, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { formatRupees } from '../_components/money'
import type { ReportSummary } from './loaders'

/**
 * Token-true report summary band (#105). Mirrors the dashboard / analytics
 * money idiom: each figure renders in `.tabular-nums` (DESIGN.md §2.2), money
 * via the shared admin `formatRupees` (₹, en-IN, integer rupees), and each
 * card pairs its metric with a semantic-tone icon chip (status never by colour
 * alone — DESIGN.md §1.3 / §5). Read-only presentation; no loader changes.
 */

type Tone = 'success' | 'info' | 'credit' | 'warning'

const TONE_ICON_CLASS: Record<Tone, string> = {
  success: 'bg-success-subtle text-success',
  info: 'bg-info-subtle text-info',
  credit: 'bg-credit-subtle text-credit',
  warning: 'bg-warning-subtle text-warning',
}

interface SummaryCardSpec {
  readonly testId: string
  readonly label: string
  readonly value: string
  readonly icon: LucideIcon
  readonly tone: Tone
}

interface ReportSummaryCardsProps {
  readonly summary: ReportSummary
}

export function ReportSummaryCards({ summary }: ReportSummaryCardsProps) {
  const cards: readonly SummaryCardSpec[] = [
    {
      testId: 'report-total-revenue',
      label: 'Total revenue',
      value: formatRupees(summary.totalRevenue),
      icon: TrendingUp,
      tone: 'success',
    },
    {
      testId: 'report-total-bookings',
      label: 'Total bookings',
      value: summary.totalBookings.toLocaleString('en-IN'),
      icon: CalendarCheck,
      tone: 'info',
    },
    {
      testId: 'report-total-users',
      label: 'Total users',
      value: summary.totalUsers.toLocaleString('en-IN'),
      icon: Users,
      tone: 'info',
    },
    {
      testId: 'report-total-vendors',
      label: 'Total vendors',
      value: summary.totalVendors.toLocaleString('en-IN'),
      icon: Store,
      tone: 'credit',
    },
    {
      testId: 'report-total-experiences',
      label: 'Total experiences',
      value: summary.totalExperiences.toLocaleString('en-IN'),
      icon: Compass,
      tone: 'warning',
    },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <SummaryCard key={card.testId} {...card} />
      ))}
    </div>
  )
}

function SummaryCard({ testId, label, value, icon: Icon, tone }: SummaryCardSpec) {
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
