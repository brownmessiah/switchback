import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
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

import { AuditFilters } from './audit-filters'
import { AuditLogRow } from './audit-log-row'
import { queryAuditLogs, getDistinctEntityTypes, getDistinctActions } from './loaders'

// ── Helpers ────────────────────────────────────────────────────────

const PAGE_SIZE = 50

interface AuditSearchParams {
  entityType?: string
  action?: string
  actorUserId?: string
  dateFrom?: string
  dateTo?: string
  page?: string
}

// ── Page ───────────────────────────────────────────────────────────

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<AuditSearchParams>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()
  await requirePermission(db, session.user.id, 'audit')

  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const offset = (page - 1) * PAGE_SIZE

  // Fetch data in parallel
  const [result, entityTypes, actions] = await Promise.all([
    queryAuditLogs(db, {
      entityType: params.entityType || undefined,
      action: params.action || undefined,
      actorUserId: params.actorUserId || undefined,
      dateFrom: params.dateFrom ? new Date(params.dateFrom) : undefined,
      dateTo: params.dateTo ? new Date(`${params.dateTo}T23:59:59.999Z`) : undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    getDistinctEntityTypes(db),
    getDistinctActions(db),
  ])

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))

  // Build pagination URLs
  function pageUrl(p: number): string {
    const sp = new URLSearchParams()
    if (params.entityType) sp.set('entityType', params.entityType)
    if (params.action) sp.set('action', params.action)
    if (params.actorUserId) sp.set('actorUserId', params.actorUserId)
    if (params.dateFrom) sp.set('dateFrom', params.dateFrom)
    if (params.dateTo) sp.set('dateTo', params.dateTo)
    if (p > 1) sp.set('page', String(p))
    const qs = sp.toString()
    return `/admin/audit${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-h1 font-semibold tracking-tight">
          Audit Logs
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{result.total}</span> log
          {result.total === 1 ? '' : 's'} total
          {params.entityType || params.action || params.actorUserId || params.dateFrom || params.dateTo
            ? ' (filtered)'
            : ''}
        </p>
      </div>

      <AuditFilters
        entityTypes={entityTypes}
        actions={actions}
        currentFilters={{
          entityType: params.entityType,
          action: params.action,
          actorUserId: params.actorUserId,
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
        }}
      />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <caption className="sr-only">
              Read-only audit log: timestamp, action type, action, target and actor
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Time</TableHead>
                <TableHead scope="col">Type</TableHead>
                <TableHead scope="col">Action</TableHead>
                <TableHead scope="col">Target</TableHead>
                <TableHead scope="col">Actor</TableHead>
                <TableHead scope="col" className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No audit logs found.
                  </TableCell>
                </TableRow>
              )}
              {result.rows.map((log) => (
                <AuditLogRow
                  key={log.id}
                  id={log.id}
                  actorUserId={log.actorUserId}
                  actorEmail={log.actorEmail}
                  actorName={log.actorName}
                  action={log.action}
                  entityType={log.entityType}
                  entityId={log.entityId}
                  payload={log.payload}
                  createdAt={log.createdAt.toISOString()}
                />
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <a href={pageUrl(page - 1)}>
                <Button variant="outline" size="sm">
                  Previous
                </Button>
              </a>
            )}
            {page < totalPages && (
              <a href={pageUrl(page + 1)}>
                <Button variant="outline" size="sm">
                  Next
                </Button>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
