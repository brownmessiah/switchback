import { ArrowLeft } from 'lucide-react'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { getMyTicketThread } from '@/lib/support/customer-tickets'

import { ReplyForm } from './reply-form'

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

const STATUS_VARIANTS: Record<
  string,
  'success' | 'warning' | 'info' | 'secondary' | 'outline'
> = {
  open: 'warning',
  in_progress: 'info',
  resolved: 'success',
  closed: 'secondary',
}

interface SupportThreadPageProps {
  params: Promise<{ id: string }>
}

export default async function SupportThreadPage({ params }: SupportThreadPageProps) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const { id } = await params
  const t = await getTranslations('SupportPage')

  const data = await getMyTicketThread(db, session.user.id, id)
  if (!data) notFound()

  const { ticket, messages } = data
  const isClosed = ticket.status === 'closed'

  return (
    <main
      data-testid="customer-support-thread"
      className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-12"
    >
      <Link
        href="/support"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('backToList')}
      </Link>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{ticket.subject}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge
            data-testid="thread-status"
            variant={STATUS_VARIANTS[ticket.status] ?? 'outline'}
            className="text-xs"
          >
            {t(`status.${ticket.status}`)}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {t(`categories.${ticket.category}`)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {t('thread.openedOn', { date: formatDateTime(ticket.createdAt) })}
          </span>
        </div>
      </div>

      {/* Conversation */}
      <section aria-label={t('thread.messagesHeading')} className="space-y-3">
        {messages.map((m) => {
          const isMine = m.senderUserId === session.user.id
          return (
            <Card
              key={m.id}
              data-testid="thread-message"
              className={isMine ? 'border-primary/30' : ''}
            >
              <CardContent className="p-4">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {isMine ? t('thread.you') : t('thread.supportTeam')}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(m.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-foreground">{m.body}</p>
              </CardContent>
            </Card>
          )
        })}
      </section>

      {/* Reply */}
      <div className="mt-6">
        {isClosed ? (
          <p
            data-testid="thread-closed-notice"
            className="rounded-lg border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground"
          >
            {t('reply.closedNotice')}
          </p>
        ) : (
          <ReplyForm ticketId={ticket.id} />
        )}
      </div>
    </main>
  )
}
