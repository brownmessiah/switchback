import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from '@/components/ui/responsive-table'

import { AdminStatusBadge } from '../_components/admin-status-badge'
import { formatRupees } from '../_components/money'
import { PromoActionsCell } from './promo-actions-cell'

/**
 * #95 — admin Promo codes as a DESIGN.md §4 A3 table (admin-table, direction B),
 * migrated to the shared `ResponsiveTable` (ADR-0018 / DESIGN.md §8.5): the
 * `≥ md` Table reverses to a stacked label:value Card list `< md`.
 *  - status (active / inactive / scheduled / expired) as a semantic
 *    `AdminStatusBadge` (status color + paired icon, never color alone —
 *    DESIGN.md §1.3 / §5).
 *  - the promo grants Switchback credit, so the credit amount is money →
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

const COLUMNS: ResponsiveTableColumn<PromoTableRow>[] = [
  {
    key: 'code',
    header: 'Code',
    primary: true,
    cell: (p) => <span className="font-mono">{p.code}</span>,
  },
  {
    key: 'creditAmount',
    header: 'Credit',
    align: 'right',
    cell: (p) => formatRupees(p.creditAmount),
  },
  {
    key: 'usage',
    header: 'Usage',
    align: 'right',
    cell: (p) => `${p.currentUses}${p.maxTotalUses ? ` / ${p.maxTotalUses}` : ''}`,
  },
  {
    key: 'perUserLimit',
    header: 'Per user',
    align: 'right',
    cell: (p) => p.perUserLimit,
  },
  {
    key: 'status',
    header: 'Status',
    cell: (p) => {
      const status = promoStatus(p)
      return <AdminStatusBadge status={status.key} label={status.label} />
    },
  },
  {
    key: 'dateRange',
    header: 'Date range',
    cell: (p) => (
      <span className="text-muted-foreground">
        {formatDate(p.startsAt)} — {formatDate(p.expiresAt)}
      </span>
    ),
  },
  {
    key: 'createdBy',
    header: 'Created by',
    cell: (p) => (
      <span className="text-muted-foreground">
        {p.adminEmail ?? p.adminName ?? '—'}
      </span>
    ),
  },
  {
    key: 'actions',
    header: 'Actions',
    cell: (p) => (
      <PromoActionsCell id={p.id} active={p.active} currentUses={p.currentUses} />
    ),
  },
]

export function PromoTable({ rows }: { rows: PromoTableRow[] }) {
  return (
    <ResponsiveTable<PromoTableRow>
      columns={COLUMNS}
      rows={rows}
      getRowKey={(p) => p.id}
      rowProps={(p) => ({ 'data-promo-id': p.id })}
      caption="Promo codes"
      empty="No promo codes yet. Create one above."
    />
  )
}
