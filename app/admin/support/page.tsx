import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
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

import { TicketFilters } from './ticket-filters'

// ── Variant maps ───────────────────────────────────────────────────

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  open: 'destructive',
  in_progress: 'default',
  resolved: 'secondary',
  closed: 'outline',
}

const PRIORITY_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  high: 'destructive',
  medium: 'default',
  low: 'outline',
}

// ── Helpers ─────────────────────────────────────────────────────────

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Support Tickets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tickets.length} ticket{tickets.length === 1 ? '' : 's'}
          {Object.values(filters).some(Boolean) ? ' (filtered)' : ''}
        </p>
      </div>

      <TicketFilters currentFilters={filters} />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No tickets found.
                  </TableCell>
                </TableRow>
              ) : (
                tickets.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium max-w-[250px] truncate">
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
                      <Badge
                        variant={STATUS_VARIANTS[t.status] ?? 'outline'}
                        className="capitalize text-xs"
                      >
                        {t.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={PRIORITY_VARIANTS[t.priority] ?? 'outline'}
                        className="capitalize text-xs"
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
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(t.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
