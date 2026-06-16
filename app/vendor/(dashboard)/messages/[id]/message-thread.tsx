'use client'

import { Clock, Package, Timer } from 'lucide-react'
import { useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { sendMessageAction } from '@/lib/notifications/messaging-actions'

interface MessageRow {
  id: string
  senderUserId: string
  senderName: string | null
  body: string
  readAt: Date | null
  createdAt: Date
}

/** Read-only Booking facts for the pinned thread header (fold C). */
export interface BookingContext {
  readonly experienceTitle: string
  readonly experienceSlug: string
  readonly participantCount: number
  readonly paymentMode: string
  readonly cancellationPreset: string
  readonly grossTotalRupees: number
  readonly slotStart: string | null
  readonly slotEnd: string | null
}

interface MessageThreadProps {
  readonly conversationId: string
  readonly currentUserId: string
  readonly subject: string
  readonly conversationCreatedAt: Date | string
  /** First-response SLA in ms (createdAt → vendor's first reply); null if none. */
  readonly firstResponseMs: number | null
  /** Pinned Booking context; null when the Conversation is not Booking-tied. */
  readonly bookingContext: BookingContext | null
  readonly initialMessages: readonly MessageRow[]
}

function formatTime(date: Date | string): string {
  return new Date(date).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatSlot(start: string, end: string | null): string {
  const s = new Date(start)
  const day = s.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  })
  const startTime = s.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  })
  if (!end) return `${day} · ${startTime}`
  const endTime = new Date(end).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${day} · ${startTime}–${endTime}`
}

/** Humanise an SLA duration in ms to a compact "Xh"/"Xm"/"Xd" string. */
function formatSla(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

export function MessageThread({
  conversationId,
  currentUserId,
  subject,
  conversationCreatedAt,
  firstResponseMs,
  bookingContext,
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
      // The sender is derived server-side from the session (issue #11) — the
      // client no longer passes a sender id. The action returns a typed
      // envelope; only append optimistically on success.
      const result = await sendMessageAction(conversationId, body)
      if (!result.ok) {
        return
      }

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
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── Subject + SLA signal ──────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="truncate text-sm font-semibold tracking-tight">
          {subject}
        </h2>
        {firstResponseMs == null ? (
          <Badge variant="warning" className="shrink-0 text-2xs">
            <Clock aria-hidden="true" />
            Awaiting reply
          </Badge>
        ) : (
          <Badge variant="success" className="shrink-0 text-2xs">
            <Timer aria-hidden="true" />
            Replied in {formatSla(firstResponseMs)}
          </Badge>
        )}
      </div>

      {/* ── Pinned Booking-context header (fold C) — omitted if not tied ── */}
      {bookingContext && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Package
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="truncate">{bookingContext.experienceTitle}</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {bookingContext.slotStart
                ? `${formatSlot(bookingContext.slotStart, bookingContext.slotEnd)} · `
                : ''}
              {bookingContext.participantCount}{' '}
              {bookingContext.participantCount === 1
                ? 'participant'
                : 'participants'}{' '}
              · <span className="tabular-nums">
                ₹{bookingContext.grossTotalRupees.toLocaleString('en-IN')}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {bookingContext.paymentMode === 'partial_pay' && (
              <Badge variant="info" className="text-2xs">
                Partial pay
              </Badge>
            )}
            <Badge variant="outline" className="text-2xs capitalize">
              {bookingContext.cancellationPreset} cancellation
            </Badge>
          </div>
        </div>
      )}

      {/* ── Message list ──────────────────────────────────────────────── */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
                  className={`max-w-[75%] rounded-[var(--radius-lg)] px-4 py-2 ${
                    isMe
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  <p className="text-2xs font-medium opacity-70">
                    {isMe ? 'You' : (msg.senderName ?? 'Customer')}
                  </p>
                  <p className="mt-0.5 text-sm whitespace-pre-wrap">{msg.body}</p>
                  <p className="mt-1 text-right text-2xs opacity-50 tabular-nums">
                    {formatTime(msg.createdAt)}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* ── Compose ───────────────────────────────────────────────────── */}
      <div className="flex gap-2 border-t border-border px-4 py-3">
        <Textarea
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
          className="min-h-0 flex-1 resize-none"
          aria-label="Message body"
        />
        <Button
          type="button"
          onClick={handleSend}
          disabled={!newBody.trim() || sending}
          className="shrink-0 self-end"
        >
          {sending ? 'Sending...' : 'Send'}
        </Button>
      </div>
    </div>
  )
}
