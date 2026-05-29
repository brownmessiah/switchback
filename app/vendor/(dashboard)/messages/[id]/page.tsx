import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { auth } from '@/lib/auth'
import {
  getConversationMessages,
  markConversationMessagesRead,
} from '@/lib/notifications/messaging-actions'

import { MessageThread } from './message-thread'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function VendorMessageThreadPage({ params }: PageProps) {
  const { id } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  const data = await getConversationMessages(id)
  if (!data) {
    notFound()
  }

  // Mark unread messages as read (messages sent by the other party)
  await markConversationMessagesRead(id, userId)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/vendor/messages"
          className="text-sm text-muted-foreground hover:text-foreground"
          aria-label="Back to messages"
        >
          &larr; Back
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">
          {data.conversation.subject}
        </h1>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">
            Conversation started{' '}
            {new Date(data.conversation.createdAt).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MessageThread
            conversationId={id}
            currentUserId={userId}
            initialMessages={data.messages}
          />
        </CardContent>
      </Card>
    </div>
  )
}
