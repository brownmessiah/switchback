'use client'

import { isValidElement, useState, type ReactNode } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

import { useIsDesktop } from './use-is-desktop'

/**
 * Shared "Split-View Ledger" shell for the admin money queues (#58 direction
 * B). A dense A3 queue list on the left and a persistent record-detail pane on
 * the right, so the Commission Snapshot breakdown and the approve/hold/reject
 * action are co-present (the load-bearing fix). Token-true + English-only.
 *
 * The page owns the heading / subtitle / toolbar; this shell owns ONLY the
 * two-pane layout + the detail pane landmark (data-testid="ledger-detail-pane"),
 * so refunds / payouts / commission / disputes — and the later admin-table
 * batches — share one split-view layout with one detail-column width (24rem).
 *
 * Responsive contract (DESIGN.md §8.4 / §8.5 item 6, ADR-0018): the `24rem`
 * detail column is an `lg`-only exception — at 768px it leaves ≈360px for the
 * list, too cramped. So:
 *   - `lg` (≥ 1024px): the side-by-side grid `[minmax(0,1fr)_24rem]`, detail
 *     `lg:sticky lg:top-6` — UNCHANGED.
 *   - `< lg`: the list takes the full width and the detail renders as a Sheet
 *     OVER the list, opening when a row is selected.
 *
 * Selection is owned by each consumer's local state; it is surfaced to this
 * shell ONLY through the `detail` prop — a real detail node when something is
 * selected, or `<LedgerDetailEmpty>` when nothing is. The shell reads that
 * sentinel (no consumer change required) to decide whether the Sheet is open.
 * Closing the Sheet dismisses the overlay; the consumer keeps its selection, so
 * re-selecting any row re-opens it.
 *
 * Exactly one `ledger-detail-pane` landmark is mounted at any width
 * (`useIsDesktop` mounts the column OR the Sheet, never both) so the strict
 * single-match E2E `getByTestId('ledger-detail-pane')` always resolves.
 */
export interface AdminLedgerLayoutProps {
  /** The A3 queue list (left pane). */
  list: ReactNode
  /** The record-detail pane: breakdown + action, co-present. */
  detail: ReactNode
  /**
   * Accessible title for the `< lg` detail Sheet. Defaults to "Record detail".
   * Optional — existing consumers need not pass it.
   */
  detailSheetTitle?: string
  /**
   * Screen-reader description for the `< lg` detail Sheet. Defaults to a generic
   * line. Optional — existing consumers need not pass it.
   */
  detailSheetDescription?: string
}

/**
 * A node is "selected" unless it is the `<LedgerDetailEmpty>` sentinel the
 * consumers render when nothing is selected. Checking the element type lets the
 * shell derive open/closed with zero consumer changes.
 */
function isSelectedDetail(detail: ReactNode): boolean {
  return !(isValidElement(detail) && detail.type === LedgerDetailEmpty)
}

/**
 * A best-effort stable key for the selected record, read from the detail
 * element's props (consumers wrap a `row`/`tier` object carrying an
 * `id`/`bookingId`). Used only to detect a selection CHANGE so a fresh row
 * re-opens the Sheet after a previous dismissal — never load-bearing, so it
 * falls back to a constant when the shape is unexpected.
 */
function selectionKey(detail: ReactNode): string {
  if (!isValidElement(detail)) return 'none'
  const props = detail.props as Record<string, unknown>
  const record =
    (props.row as Record<string, unknown> | undefined) ??
    (props.tier as Record<string, unknown> | undefined)
  if (record && typeof record === 'object') {
    const id = record.id ?? record.bookingId
    if (typeof id === 'string') return id
  }
  return 'selected'
}

export function AdminLedgerLayout({
  list,
  detail,
  detailSheetTitle = 'Record detail',
  detailSheetDescription = 'The selected record’s breakdown and actions.',
}: AdminLedgerLayoutProps) {
  const isDesktop = useIsDesktop()

  // `lg`: the original side-by-side split. Unchanged structure + testid.
  if (isDesktop) {
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

  // `< lg`: full-width list + the detail surfaced as a Sheet over it.
  return <LedgerDetailSheet list={list} detail={detail} title={detailSheetTitle} description={detailSheetDescription} />
}

/**
 * The `< lg` presentation: the list spans the full width and the detail pane is
 * a bottom Sheet (A4 contextual side task) that opens whenever a row is
 * selected. The same `detail` node and the same `data-testid="ledger-detail-pane"`
 * landmark live inside the Sheet, so detail-pane assertions hold at every width.
 */
function LedgerDetailSheet({
  list,
  detail,
  title,
  description,
}: {
  list: ReactNode
  detail: ReactNode
  title: string
  description: string
}) {
  const selected = isSelectedDetail(detail)
  const key = selected ? selectionKey(detail) : 'none'

  // Track manual dismissal so closing the Sheet does not immediately re-open
  // while the consumer still holds the SAME selection. A new selection (key
  // change) clears the dismissal during render so re-selecting any row — or a
  // different row — re-opens the Sheet.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const [prevKey, setPrevKey] = useState(key)
  if (prevKey !== key) {
    setPrevKey(key)
    if (dismissedKey !== null) setDismissedKey(null)
  }

  const open = selected && dismissedKey !== key

  return (
    <div className="min-w-0">
      {list}
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) setDismissedKey(key)
        }}
      >
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-[var(--radius-lg)] p-4 shadow-[var(--shadow-lg)]"
          aria-label={title}
        >
          <SheetHeader className="px-0 pt-0">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div data-testid="ledger-detail-pane">{detail}</div>
        </SheetContent>
      </Sheet>
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
