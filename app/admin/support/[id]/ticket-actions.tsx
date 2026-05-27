'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import {
  addMessageAction,
  assignTicketAction,
  changeTicketStatusAction,
} from '../actions'

// ── Status transition button ───────────────────────────────────────

interface StatusButtonProps {
  ticketId: string
  currentStatus: string
}

const NEXT_STATUS: Record<string, string> = {
  open: 'in_progress',
  in_progress: 'resolved',
  resolved: 'closed',
}

const STATUS_LABELS: Record<string, string> = {
  in_progress: 'Start Working',
  resolved: 'Mark Resolved',
  closed: 'Close Ticket',
}

export function StatusTransitionButton({ ticketId, currentStatus }: StatusButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const nextStatus = NEXT_STATUS[currentStatus]
  if (!nextStatus) return null

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const result = await changeTicketStatusAction(ticketId, nextStatus!)
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <div>
      <Button onClick={handleClick} disabled={isPending} size="sm">
        {STATUS_LABELS[nextStatus] ?? nextStatus}
      </Button>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  )
}

// ── Assign button ──────────────────────────────────────────────────

interface AssignButtonProps {
  ticketId: string
  adminUserId: string
}

export function AssignToMeButton({ ticketId, adminUserId }: AssignButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const result = await assignTicketAction(ticketId, adminUserId)
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <div>
      <Button onClick={handleClick} disabled={isPending} variant="outline" size="sm">
        Assign to Me
      </Button>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  )
}

// ── Add message form ───────────────────────────────────────────────

interface AddMessageFormProps {
  ticketId: string
  isClosed: boolean
}

export function AddMessageForm({ ticketId, isClosed }: AddMessageFormProps) {
  const [isPending, startTransition] = useTransition()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit() {
    if (!body.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await addMessageAction(ticketId, body)
      if (result.ok) {
        setBody('')
      } else {
        setError(result.error)
      }
    })
  }

  if (isClosed) {
    return (
      <p className="text-sm text-muted-foreground">
        This ticket is closed. No new messages can be added.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <Textarea
        placeholder="Type a reply..."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button
          onClick={handleSubmit}
          disabled={isPending || !body.trim()}
        >
          Send Reply
        </Button>
      </div>
    </div>
  )
}
