'use client'

import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
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
 * Severity derived from action prefix. Not stored in the schema
 * (the existing audit_logs table does not have a severity column),
 * so we infer it from the action string for display purposes.
 */
function inferSeverity(action: string): {
  label: string
  variant: 'default' | 'secondary' | 'outline' | 'destructive'
} {
  if (action.includes('delete') || action.includes('revoke') || action.includes('cancel')) {
    return { label: 'critical', variant: 'destructive' }
  }
  if (action.includes('approve') || action.includes('reject') || action.includes('edit') || action.includes('update')) {
    return { label: 'warning', variant: 'secondary' }
  }
  return { label: 'info', variant: 'outline' }
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
        <TableCell className="text-xs text-muted-foreground font-mono">
          {formatDate(createdAt)}
        </TableCell>
        <TableCell className="text-sm">
          <Badge variant={severity.variant} className="text-xs">
            {severity.label}
          </Badge>
        </TableCell>
        <TableCell className="text-sm font-mono">{action}</TableCell>
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
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs font-mono">
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
