import { CalendarDays } from 'lucide-react'
import type { ReactElement } from 'react'

import { EmptyState } from '@/components/empty-state'

export interface DashboardBookingsEmptyLabels {
  /** Already-translated heading (`CustomerNav.bookings.empty`). */
  readonly title: string
  /** Already-translated supporting hint (`CustomerNav.bookings.emptyHint`). */
  readonly hint: string
  /** Already-translated CTA label (`CustomerNav.bookings.explore`). */
  readonly cta: string
}

/**
 * "No bookings yet" empty state for the customer dashboard timeline (issue 25).
 * Replaces the page's ad-hoc dashed box with the shared EmptyState so the
 * customer surfaces stay consistent — and routes the CTA to the locale-neutral
 * `/search` (NOT a hardcoded `/en/search`, which the prior inline box used and
 * which violates the no-`/en`-prefix rule).
 */
export function DashboardBookingsEmpty({
  labels,
}: {
  labels: DashboardBookingsEmptyLabels
}): ReactElement {
  return (
    <EmptyState
      data-testid="bookings-empty"
      icon={CalendarDays}
      title={labels.title}
      description={labels.hint}
      cta={{ href: '/search', label: labels.cta }}
    />
  )
}
