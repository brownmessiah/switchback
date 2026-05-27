import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'
import { loadTicketDetail } from '@/lib/admin/support-ticket-actions'

import {
  AddMessageForm,
  AssignToMeButton,
  StatusTransitionButton,
} from './ticket-actions'

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

function formatDateTime(date: Date | string | null): string {
  if (!date) return '—'
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ── Page ────────────────────────────────────────────────────────────

interface TicketDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function TicketDetailPage({ params }: TicketDetailPageProps) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()
  await requirePermission(db, session.user.id, 'support')

  const { id } = await params
  const data = await loadTicketDetail(db, id)
  if (!data) notFound()

  const { ticket, messages } = data

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="text-sm text-muted-foreground">
        <Link href="/admin/support" className="hover:underline">
          Support Tickets
        </Link>{' '}
        / {ticket.subject}
      </div>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{ticket.subject}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge
              variant={STATUS_VARIANTS[ticket.status] ?? 'outline'}
              className="capitalize text-xs"
            >
              {ticket.status.replace(/_/g, ' ')}
            </Badge>
            <Badge
              variant={PRIORITY_VARIANTS[ticket.priority] ?? 'outline'}
              className="capitalize text-xs"
            >
              {ticket.priority}
            </Badge>
            <Badge variant="outline" className="capitalize text-xs">
              {ticket.category}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusTransitionButton
            ticketId={ticket.id}
            currentStatus={ticket.status}
          />
          {!ticket.assignedToAdminId && (
            <AssignToMeButton
              ticketId={ticket.id}
              adminUserId={session.user.id}
            />
          )}
        </div>
      </div>

      {/* Metadata */}
      <Card>
        <CardContent className="p-4">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Created by</dt>
              <dd className="font-medium">{ticket.creatorName ?? ticket.creatorEmail ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Assigned to</dt>
              <dd className="font-medium">
                {ticket.assignedToAdminId ?? 'Unassigned'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="font-medium">{formatDateTime(ticket.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last updated</dt>
              <dd className="font-medium">{formatDateTime(ticket.updatedAt)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Messages */}
      <Card>
        <CardHeader>
          <CardTitle>Messages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {messages.map((msg, idx) => (
            <div key={msg.id}>
              {idx > 0 && <Separator className="mb-4" />}
              <div className="flex items-start justify-between">
                <div className="text-sm font-medium">
                  {msg.senderName ?? msg.senderEmail ?? msg.senderUserId}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDateTime(msg.createdAt)}
                </div>
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{msg.body}</p>
            </div>
          ))}

          <Separator />
          <AddMessageForm
            ticketId={ticket.id}
            isClosed={ticket.status === 'closed'}
          />
        </CardContent>
      </Card>
    </div>
  )
}
