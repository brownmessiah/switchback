import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from '@/components/ui/responsive-table'
import { getRegion } from '@/lib/regions/registry'

import { AdminStatusBadge } from '../_components/admin-status-badge'
import { DeleteClosureButton } from './delete-closure-button'

/**
 * Resolve a region slug to its English display name via the ADR-0013 registry.
 * Operators read "Leh-Ladakh", not the raw `leh-ladakh` URL slug; the slug
 * stays available behind the cell's `title` for copy / debugging.
 */
function regionDisplayName(slug: string): string {
  return getRegion(slug)?.displayName.en ?? slug
}

/**
 * #94 — admin Region closures as a DESIGN.md §4 A3 table, migrated to the shared
 * `ResponsiveTable` (ADR-0018 / DESIGN.md §8.5): the `≥ md` Table reverses to a
 * stacked label:value Card list `< md`.
 *  - closure status (active / upcoming / past) as a semantic `AdminStatusBadge`
 *    (status color + paired icon, never color alone — DESIGN.md §1.3 / §5)
 *  - the full closure reason kept in the row DOM (the E2E #25 flow matches the
 *    row by its reason text)
 *  - per-row destructive Delete behind a confirm Dialog (DeleteClosureButton,
 *    unchanged) — creating/deleting a closure pauses/restores real Bookings
 *    (ADR-0011), so the destructive action confirms before commit.
 *
 * Presentational + split out so it is unit-testable; the page owns the data
 * load + the create-closure toolbar.
 */
export interface ClosureTableRow {
  id: string
  regionSlug: string
  startAt: Date | string
  endAt: Date | string
  reason: string
  source: string
}

function asDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d)
}

function formatDate(date: Date | string): string {
  return asDate(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function closureStatus(
  startAt: Date | string,
  endAt: Date | string,
): { key: string; label: string } {
  const now = new Date()
  const start = asDate(startAt)
  const end = asDate(endAt)
  if (now >= start && now <= end) return { key: 'active', label: 'Active' }
  if (now < start) return { key: 'upcoming', label: 'Upcoming' }
  return { key: 'past', label: 'Past' }
}

const COLUMNS: ResponsiveTableColumn<ClosureTableRow>[] = [
  {
    key: 'region',
    header: 'Region',
    primary: true,
    cell: (c) => (
      <span className="font-medium" title={c.regionSlug}>
        {regionDisplayName(c.regionSlug)}
      </span>
    ),
  },
  {
    key: 'start',
    header: 'Start',
    cell: (c) => formatDate(c.startAt),
  },
  {
    key: 'end',
    header: 'End',
    cell: (c) => formatDate(c.endAt),
  },
  {
    key: 'reason',
    header: 'Reason',
    cell: (c) => <span className="text-sm">{c.reason}</span>,
  },
  {
    key: 'source',
    header: 'Source',
    cell: (c) => (
      <AdminStatusBadge status={c.source} label={c.source} className="capitalize" />
    ),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (c) => {
      const status = closureStatus(c.startAt, c.endAt)
      return <AdminStatusBadge status={status.key} label={status.label} />
    },
  },
  {
    key: 'actions',
    header: 'Actions',
    cell: (c) => (
      <DeleteClosureButton
        closureId={c.id}
        regionSlug={c.regionSlug}
        regionLabel={regionDisplayName(c.regionSlug)}
      />
    ),
  },
]

export function ClosuresTable({ rows }: { rows: ClosureTableRow[] }) {
  return (
    <ResponsiveTable<ClosureTableRow>
      columns={COLUMNS}
      rows={rows}
      getRowKey={(c) => c.id}
      rowProps={(c) => ({ 'data-closure-id': c.id })}
      caption="Region closures"
      empty="No region closures found."
    />
  )
}
