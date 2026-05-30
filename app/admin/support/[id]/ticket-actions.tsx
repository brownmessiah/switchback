'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

// Forward-only transitions whose effect is consequential (the ticket is taken
// out of the active queue / made terminal). Per #103 / DESIGN.md A4 these are
// gated behind a confirm Dialog that restates the effect before commit. The
// benign open → in_progress ("Start Working") stays inline.
const CONFIRMED_TRANSITIONS = new Set(['resolved', 'closed'])

const STATUS_EFFECT: Record<string, string> = {
  resolved:
    'Mark this ticket resolved. It leaves the active queue; the Customer can still reply, which reopens the thread.',
  closed:
    'Close this ticket. This is terminal — no new messages can be added once closed.',
}

export function StatusTransitionButton({ ticketId, currentStatus }: StatusButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const nextStatus = NEXT_STATUS[currentStatus]
  if (!nextStatus) return null

  const label = STATUS_LABELS[nextStatus] ?? nextStatus
  const needsConfirm = CONFIRMED_TRANSITIONS.has(nextStatus)

  function runTransition() {
    setError(null)
    startTransition(async () => {
      const result = await changeTicketStatusAction(ticketId, nextStatus!)
      if (result.ok) {
        setConfirmOpen(false)
      } else {
        setError(result.error)
      }
    })
  }

  // Benign forward step (Start Working) fires inline — no money / no terminal
  // effect — so a confirm Dialog would be friction with no protective value.
  if (!needsConfirm) {
    return (
      <div>
        <Button onClick={runTransition} disabled={isPending} size="sm">
          {label}
        </Button>
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    )
  }

  return (
    <div>
      <Button onClick={() => setConfirmOpen(true)} disabled={isPending} size="sm">
        {label}
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              {STATUS_EFFECT[nextStatus] ?? `Change status to ${nextStatus}.`}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              data-testid="confirm-status-change"
              onClick={runTransition}
              disabled={isPending}
            >
              {label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
