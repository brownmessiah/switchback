'use client'

import Link from 'next/link'

import { Card, CardContent } from '@/components/ui/card'

interface ConversationRow {
  id: string
  customerUserId: string
  customerName: string | null
  subject: string
  status: string
  createdAt: Date
  updatedAt: Date
}

interface ConversationListProps {
  readonly conversations: ConversationRow[]
  readonly currentUserId: string
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function ConversationList({ conversations }: ConversationListProps) {
  return (
    <div className="space-y-2">
      {conversations.map((conv) => (
        <Link key={conv.id} href={`/vendor/messages/${conv.id}`}>
          <Card className="transition hover:bg-muted/50">
            <CardContent className="flex items-center justify-between py-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {conv.customerName ?? 'Customer'}
                </p>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {conv.subject}
                </p>
              </div>
              <div className="ml-4 shrink-0 text-right">
                <p className="text-xs text-muted-foreground">
                  {formatDate(conv.updatedAt)}
                </p>
                <span
                  className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    conv.status === 'active'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {conv.status}
                </span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )
}
