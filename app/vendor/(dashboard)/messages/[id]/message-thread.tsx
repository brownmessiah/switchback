'use client'

import { useRef, useState } from 'react'

import { sendMessageAction } from '@/lib/notifications/messaging-actions'

interface MessageRow {
  id: string
  senderUserId: string
  senderName: string | null
  body: string
  readAt: Date | null
  createdAt: Date
}

interface MessageThreadProps {
  readonly conversationId: string
  readonly currentUserId: string
  readonly initialMessages: MessageRow[]
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function MessageThread({
  conversationId,
  currentUserId,
  initialMessages,
}: MessageThreadProps) {
  const [localMessages, setLocalMessages] = useState(initialMessages)
  const [newBody, setNewBody] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleSend() {
    const body = newBody.trim()
    if (!body || sending) return

    setSending(true)
    try {
      const result = await sendMessageAction(
        conversationId,
        currentUserId,
        body,
      )

      // Optimistically add the message
      setLocalMessages((prev) => [
        ...prev,
        {
          id: result.messageId,
          senderUserId: currentUserId,
          senderName: 'You',
          body,
          readAt: null,
          createdAt: result.createdAt,
        },
      ])
      setNewBody('')
      textareaRef.current?.focus()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Message list */}
      <div className="space-y-3 max-h-[60vh] overflow-y-auto">
        {localMessages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No messages in this conversation yet.
          </p>
        ) : (
          localMessages.map((msg) => {
            const isMe = msg.senderUserId === currentUserId
            return (
              <div
                key={msg.id}
                className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] rounded-lg px-4 py-2 ${
                    isMe
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  <p className="text-xs font-medium opacity-70">
                    {isMe ? 'You' : (msg.senderName ?? 'Customer')}
                  </p>
                  <p className="mt-0.5 text-sm whitespace-pre-wrap">{msg.body}</p>
                  <p className="mt-1 text-right text-[10px] opacity-50">
                    {formatTime(msg.createdAt)}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Compose */}
      <div className="flex gap-2 border-t pt-4">
        <textarea
          ref={textareaRef}
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="Type a message..."
          rows={2}
          className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Message body"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!newBody.trim() || sending}
          className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
