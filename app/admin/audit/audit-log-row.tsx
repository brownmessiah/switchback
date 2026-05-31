'use client'

import { useState } from 'react'

import { AdminStatusBadge } from '@/app/admin/_components/admin-status-badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'

interface AuditLogRowProps {
  id: string
  actorUserId: string | null
  actorEmail: string | null
  actorName: string | null
  action: string
  entityType: string
  entityId: string
  payload: unknown
  createdAt: string
}

/**
 * Severity derived from the action prefix. Not stored in the schema (the
 * existing audit_logs table has no severity column), so it is inferred from the
 * action string for display only. Maps to the shared AdminStatusBadge severity
 * keys so the read-only type chip pairs colour WITH an icon (DESIGN.md §5).
 */
function inferSeverity(action: string): { status: string; label: string } {
  if (
    action.includes('delete') ||
    action.includes('revoke') ||
    action.includes('cancel')
  ) {
    return { status: 'severity_critical', label: 'Critical' }
  }
  if (
    action.includes('approve') ||
    action.includes('reject') ||
    action.includes('edit') ||
    action.includes('update')
  ) {
    return { status: 'severity_warning', label: 'Warning' }
  }
  return { status: 'severity_info', label: 'Info' }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function AuditLogRow({
  id,
  actorUserId,
  actorEmail,
  actorName,
  action,
  entityType,
  entityId,
  payload,
  createdAt,
}: AuditLogRowProps) {
  const [expanded, setExpanded] = useState(false)
  const severity = inferSeverity(action)

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
          {formatDate(createdAt)}
        </TableCell>
        <TableCell>
          <span data-testid="audit-action-badge">
            <AdminStatusBadge status={severity.status} label={severity.label} />
          </span>
        </TableCell>
        <TableCell className="font-mono text-sm">{action}</TableCell>
        <TableCell className="text-sm">
          <span className="text-muted-foreground">{entityType}</span>
          <span className="mx-1 text-muted-foreground/50">/</span>
          <span className="font-mono text-xs">{entityId}</span>
        </TableCell>
        <TableCell className="text-sm">
          {actorEmail ?? actorName ?? (actorUserId ? `ID: ${actorUserId}` : 'System')}
        </TableCell>
        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((prev) => !prev)
            }}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </Button>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30 p-4">
            <div className="space-y-2">
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <span className="font-medium text-muted-foreground">Log ID:</span>{' '}
                  <span className="font-mono">{id}</span>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Actor User ID:</span>{' '}
                  <span className="font-mono">{actorUserId ?? 'null (system)'}</span>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Entity Type:</span>{' '}
                  <span>{entityType}</span>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Entity ID:</span>{' '}
                  <span className="font-mono">{entityId}</span>
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Metadata (JSON):
                </p>
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
