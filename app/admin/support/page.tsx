import { inArray } from 'drizzle-orm'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { AdminStatusBadge } from '@/app/admin/_components/admin-status-badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from '@/components/ui/responsive-table'
import { db } from '@/db/client'
import { users } from '@/db/schema/users'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'
import { shortRef } from '@/lib/admin/short-ref'
import {
  loadTicketsList,
  type TicketListFilters,
} from '@/lib/admin/support-ticket-actions'

import { TicketCreateForm } from './ticket-create-form'
import { TicketFilters } from './ticket-filters'

// ── Helpers ─────────────────────────────────────────────────────────

/** Human label for the ticket status badge (English-only). */
const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

/** Priority is not a money/status family member — a neutral outline chip. */
const PRIORITY_VARIANTS: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  high: 'destructive',
  medium: 'default',
  low: 'outline',
}

function formatDate(date: Date | string | null): string {
  if (!date) return '—'
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ── Page ────────────────────────────────────────────────────────────

interface SupportPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function SupportPage({ searchParams }: SupportPageProps) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()
  await requirePermission(db, session.user.id, 'support')

  const params = await searchParams
  const filters: TicketListFilters = {
    status: typeof params.status === 'string' ? params.status : undefined,
    priority: typeof params.priority === 'string' ? params.priority : undefined,
    category: typeof params.category === 'string' ? params.category : undefined,
  }

  const tickets = await loadTicketsList(db, filters)
  type TicketRow = (typeof tickets)[number]
  const isFiltered = Object.values(filters).some(Boolean)

  // Resolve assignee user ids → display names in one query so the "Assigned To"
  // column never leaks a raw `u_seed_…` identifier into the operator UI.
  const assigneeIds = Array.from(
    new Set(tickets.map((t) => t.assignedToAdminId).filter((id): id is string => Boolean(id))),
  )
  const assigneeNameById = new Map<string, string>()
  if (assigneeIds.length > 0) {
    const assignees = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, assigneeIds))
    for (const a of assignees) {
      assigneeNameById.set(a.id, a.name ?? a.email ?? shortRef(a.id))
    }
  }

  // A3-reversal columns (DESIGN.md §8.5 / ADR-0018). Subject is the primary
  // (row-link) column; status keeps its `ticket-status-badge`-wrapped
  // `AdminStatusBadge`; the per-row `data-ticket-id` hook is threaded through
  // `rowProps` so the support-lifecycle E2E row selector survives both the
  // `≥ md` table and the `< md` stacked cards.
  const columns: ReadonlyArray<ResponsiveTableColumn<TicketRow>> = [
    {
      key: 'subject',
      header: 'Subject',
      primary: true,
      cell: (t) => t.subject,
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: (t) => t.creatorName ?? t.creatorEmail ?? '—',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (t) => (
        <span data-testid="ticket-status-badge">
          <AdminStatusBadge
            status={t.status}
            label={STATUS_LABELS[t.status] ?? t.status}
          />
        </span>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      cell: (t) => (
        <Badge
          variant={PRIORITY_VARIANTS[t.priority] ?? 'outline'}
          className="text-xs capitalize"
        >
          {t.priority}
        </Badge>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      cell: (t) => <span className="capitalize">{t.category}</span>,
    },
    {
      key: 'assignee',
      header: 'Assigned To',
      cell: (t) =>
        t.assignedToAdminId ? (
          <span title={t.assignedToAdminId}>
            {assigneeNameById.get(t.assignedToAdminId) ??
              shortRef(t.assignedToAdminId)}
          </span>
        ) : (
          'Unassigned'
        ),
    },
    {
      key: 'created',
      header: 'Created',
      align: 'right',
      cell: (t) => formatDate(t.createdAt),
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-h1 font-semibold tracking-tight">
          Support Tickets
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{tickets.length}</span> ticket
          {tickets.length === 1 ? '' : 's'}
          {isFiltered ? ' (filtered)' : ''}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-h3">Create Ticket</CardTitle>
        </CardHeader>
        <CardContent>
          <TicketCreateForm />
        </CardContent>
      </Card>

      <TicketFilters currentFilters={filters} />

      <ResponsiveTable<TicketRow>
        columns={columns}
        rows={tickets}
        getRowKey={(t) => t.id}
        rowHref={(t) => `/admin/support/${t.id}`}
        rowProps={(t) => ({ 'data-ticket-id': t.id })}
        caption="Support tickets with status, priority, category and assignee"
        empty={
          isFiltered ? 'No tickets match these filters.' : 'No tickets found.'
        }
      />
    </div>
  )
}
