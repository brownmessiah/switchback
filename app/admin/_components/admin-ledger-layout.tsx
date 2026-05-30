import type { ReactNode } from 'react'

import { Card, CardContent } from '@/components/ui/card'

/**
 * Shared "Split-View Ledger" shell for the admin money queues (#58 direction
 * B). A dense A3 queue list on the left and a persistent record-detail pane on
 * the right, so the Commission Snapshot breakdown and the approve/hold/reject
 * action are co-present (the load-bearing fix). Collapses to a single column on
 * narrow viewports. Token-true + English-only.
 *
 * The page owns the heading / subtitle / toolbar; this shell owns ONLY the
 * two-pane grid + the detail pane landmark (data-testid="ledger-detail-pane"),
 * so refunds / payouts / commission — and the later admin-table batches —
 * share one split-view layout with one detail-column width (24rem).
 */
export interface AdminLedgerLayoutProps {
  /** The A3 queue list (left pane). */
  list: ReactNode
  /** The record-detail pane (right pane): breakdown + action, co-present. */
  detail: ReactNode
}

export function AdminLedgerLayout({ list, detail }: AdminLedgerLayoutProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      {/* Left: the A3 queue list */}
      <div className="min-w-0">{list}</div>

      {/* Right: the persistent record-detail pane (breakdown + action) */}
      <aside className="lg:sticky lg:top-6 lg:self-start" data-testid="ledger-detail-pane">
        {detail}
      </aside>
    </div>
  )
}

/** Empty state for the detail pane when no record is selected. */
export function LedgerDetailEmpty({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        {message}
      </CardContent>
    </Card>
  )
}
