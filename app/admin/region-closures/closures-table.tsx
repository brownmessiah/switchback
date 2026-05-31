import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { AdminStatusBadge } from '../_components/admin-status-badge'
import { DeleteClosureButton } from './delete-closure-button'

/**
 * #94 — admin Region closures as a DESIGN.md §4 A3 table:
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

export function ClosuresTable({ rows }: { rows: ClosureTableRow[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <caption className="sr-only">Region closures</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Region</TableHead>
              <TableHead scope="col">Start</TableHead>
              <TableHead scope="col">End</TableHead>
              <TableHead scope="col">Reason</TableHead>
              <TableHead scope="col">Source</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col" className="w-20">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No region closures found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => {
                const status = closureStatus(c.startAt, c.endAt)
                return (
                  <TableRow key={c.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium">{c.regionSlug}</TableCell>
                    <TableCell className="text-sm">{formatDate(c.startAt)}</TableCell>
                    <TableCell className="text-sm">{formatDate(c.endAt)}</TableCell>
                    <TableCell className="max-w-[300px] truncate text-sm">{c.reason}</TableCell>
                    <TableCell>
                      <AdminStatusBadge status={c.source} label={c.source} className="capitalize" />
                    </TableCell>
                    <TableCell>
                      <AdminStatusBadge status={status.key} label={status.label} />
                    </TableCell>
                    <TableCell>
                      <DeleteClosureButton closureId={c.id} regionSlug={c.regionSlug} />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
