import { MessagesSquare } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { getVendorConversations } from '@/lib/notifications/messaging-actions'

import { ConversationList } from './conversation-list'
import { SplitView } from './split-view'

/**
 * Vendor inbox. The conversation list is scoped to the acting user's RESOLVED
 * shop (issue #11): `getVendorConversations` derives the session + resolves the
 * shop server-side, so a team member sees the SHOP's conversations (not an
 * empty self-inbox) and never another shop's.
 */
export default async function VendorMessagesPage() {
  const conversations = await getVendorConversations()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Messages
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Communicate with customers about their bookings.
        </p>
      </div>

      {conversations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <MessagesSquare
              className="mb-3 size-8 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-lg font-medium">No messages yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Messages from customers will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <SplitView
          selected={false}
          list={<ConversationList conversations={conversations} />}
          detail={
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <MessagesSquare
                className="size-8 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm font-medium">Select a conversation</p>
              <p className="text-xs text-muted-foreground">
                Choose a conversation from the list to read and reply.
              </p>
            </div>
          }
        />
      )}
    </div>
  )
}
