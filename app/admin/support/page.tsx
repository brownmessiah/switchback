import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AdminStatusBadge } from '@/app/admin/_components/admin-status-badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'
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
  const isFiltered = Object.values(filters).some(Boolean)

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

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <caption className="sr-only">
                Support tickets with status, priority, category and assignee
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Subject</TableHead>
                  <TableHead scope="col">Customer</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Priority</TableHead>
                  <TableHead scope="col">Category</TableHead>
                  <TableHead scope="col">Assigned To</TableHead>
                  <TableHead scope="col">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-muted-foreground"
                    >
                      {isFiltered
                        ? 'No tickets match these filters.'
                        : 'No tickets found.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  tickets.map((t) => (
                    <TableRow
                      key={t.id}
                      data-ticket-id={t.id}
                      className="hover:bg-muted/50"
                    >
                      <TableCell className="max-w-[250px] truncate font-medium">
                        <Link
                          href={`/admin/support/${t.id}`}
                          className="hover:underline"
                        >
                          {t.subject}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        {t.creatorName ?? t.creatorEmail ?? '—'}
                      </TableCell>
                      <TableCell>
                        <span data-testid="ticket-status-badge">
                          <AdminStatusBadge
                            status={t.status}
                            label={STATUS_LABELS[t.status] ?? t.status}
                          />
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={PRIORITY_VARIANTS[t.priority] ?? 'outline'}
                          className="text-xs capitalize"
                        >
                          {t.priority}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm capitalize">
                        {t.category}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t.assignedToAdminId
                          ? t.assignedToAdminId.slice(0, 8) + '...'
                          : 'Unassigned'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">
                        {formatDate(t.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
