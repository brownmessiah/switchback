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
import { formatRupees } from '../_components/money'
import { PromoActionsCell } from './promo-actions-cell'

/**
 * #95 — admin Promo codes as a DESIGN.md §4 A3 table (admin-table, direction B):
 *  - status (active / inactive / scheduled / expired) as a semantic
 *    `AdminStatusBadge` (status color + paired icon, never color alone —
 *    DESIGN.md §1.3 / §5).
 *  - the promo grants Outvers credit, so the credit amount is money →
 *    right-aligned + `.tabular-nums` with the ₹ glyph (DESIGN.md §1.3 / §2.2).
 *  - the promo CODE text stays in the row DOM (the E2E #26 flow matches the row
 *    by its code text).
 *  - per-row consequential actions (deactivate / delete) behind a confirm
 *    Dialog (PromoActionsCell), since deactivating stops a live promo and
 *    deleting removes it (ADR-0004).
 *
 * Presentational + split out so it is unit-testable; the page owns the data
 * load + the create-promo toolbar.
 */
export interface PromoTableRow {
  id: string
  code: string
  creditAmount: string | number
  maxTotalUses: number | null
  currentUses: number
  perUserLimit: number
  active: boolean
  startsAt: Date | string | null
  expiresAt: Date | string | null
  adminName: string | null
  adminEmail: string | null
}

function asDate(d: Date | string | null): Date | null {
  if (!d) return null
  return d instanceof Date ? d : new Date(d)
}

function formatDate(d: Date | string | null): string {
  const date = asDate(d)
  if (!date) return '—'
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Derive the promo status key for the shared AdminStatusBadge. An inactive
 * promo is neutral; a future-dated one is scheduled (info); an active promo
 * past its expiry reads as expired (destructive); otherwise active (success).
 */
function promoStatus(promo: {
  active: boolean
  startsAt: Date | string | null
  expiresAt: Date | string | null
}): { key: string; label: string } {
  if (!promo.active) return { key: 'inactive', label: 'Inactive' }
  const now = new Date()
  const startsAt = asDate(promo.startsAt)
  const expiresAt = asDate(promo.expiresAt)
  if (startsAt && now < startsAt) return { key: 'upcoming', label: 'Scheduled' }
  if (expiresAt && now > expiresAt) return { key: 'expired', label: 'Expired' }
  return { key: 'active', label: 'Active' }
}

export function PromoTable({ rows }: { rows: PromoTableRow[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <caption className="sr-only">Promo codes</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Code</TableHead>
              <TableHead scope="col" className="text-right">
                Credit
              </TableHead>
              <TableHead scope="col" className="text-right">
                Usage
              </TableHead>
              <TableHead scope="col" className="text-right">
                Per user
              </TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col">Date range</TableHead>
              <TableHead scope="col">Created by</TableHead>
              <TableHead scope="col" className="w-32">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  No promo codes yet. Create one above.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((p) => {
                const status = promoStatus(p)
                return (
                  <TableRow key={p.id} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-sm font-medium">{p.code}</TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums">
                      {formatRupees(p.creditAmount)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {p.currentUses}
                      {p.maxTotalUses ? ` / ${p.maxTotalUses}` : ''}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {p.perUserLimit}
                    </TableCell>
                    <TableCell>
                      <AdminStatusBadge status={status.key} label={status.label} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(p.startsAt)} — {formatDate(p.expiresAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.adminEmail ?? p.adminName ?? '—'}
                    </TableCell>
                    <TableCell>
                      <PromoActionsCell
                        id={p.id}
                        active={p.active}
                        currentUses={p.currentUses}
                      />
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
