import { LifeBuoy, MessageSquare } from 'lucide-react'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { listMyTickets } from '@/lib/support/customer-tickets'

import { NewTicketForm } from './new-ticket-form'

function formatDate(date: Date | string | null): string {
  if (!date) return '—'
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
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

export default async function CustomerSupportPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const t = await getTranslations('SupportPage')
  const tickets = await listMyTickets(db, session.user.id)

  return (
    <main
      data-testid="customer-support"
      className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-12"
    >
      <div className="mb-8 flex items-start gap-3">
        <LifeBuoy className="mt-1 size-6 shrink-0 text-primary" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
        </div>
      </div>

      {/* New ticket form */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-lg">{t('form.heading')}</CardTitle>
        </CardHeader>
        <CardContent>
          <NewTicketForm />
        </CardContent>
      </Card>

      {/* My tickets */}
      <section aria-labelledby="my-tickets-heading">
        <h2 id="my-tickets-heading" className="mb-3 text-sm font-medium text-muted-foreground">
          {t('list.heading')} ·{' '}
          <span className="tabular-nums">{t('list.ticketCount', { count: tickets.length })}</span>
        </h2>

        {tickets.length === 0 ? (
          <div
            data-testid="support-empty"
            className="rounded-xl border border-dashed py-16 text-center"
          >
            <MessageSquare
              className="mx-auto mb-3 size-8 text-muted-foreground"
              aria-hidden
            />
            <p className="text-lg font-medium">{t('list.emptyTitle')}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {t('list.emptyHint')}
            </p>
          </div>
        ) : (
          <ul data-testid="support-ticket-list" className="space-y-3">
            {tickets.map((ticket) => (
              <li key={ticket.id} data-ticket-id={ticket.id}>
                <Link
                  href={`/support/${ticket.id}`}
                  className="block rounded-xl border p-4 transition hover:border-foreground/20 hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-medium">{ticket.subject}</h3>
                        <Badge
                          variant={STATUS_VARIANTS[ticket.status] ?? 'outline'}
                          className="shrink-0 text-xs"
                        >
                          {t(`status.${ticket.status}`)}
                        </Badge>
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {t(`categories.${ticket.category}`)}
                        </Badge>
                      </div>
                      {ticket.lastMessageBody ? (
                        <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                          {ticket.lastMessageBody}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {t('list.lastUpdated', { date: formatDate(ticket.updatedAt) })}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
