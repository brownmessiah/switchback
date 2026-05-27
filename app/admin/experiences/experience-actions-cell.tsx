'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

import {
  approveExperienceAction,
  archiveExperienceAction,
  pauseExperienceAction,
  rejectExperienceAction,
} from './actions'

interface ExperienceActionsCellProps {
  experienceId: string
  status: 'draft' | 'pending_review' | 'published' | 'paused' | 'archived'
}

export function ExperienceActionsCell({
  experienceId,
  status,
}: ExperienceActionsCellProps) {
  const [isPending, startTransition] = useTransition()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleApprove() {
    setError(null)
    startTransition(async () => {
      const result = await approveExperienceAction(experienceId)
      if (!result.ok) setError(result.error)
    })
  }

  function handlePause() {
    setError(null)
    startTransition(async () => {
      const result = await pauseExperienceAction(experienceId)
      if (!result.ok) setError(result.error)
    })
  }

  function handleArchive() {
    setError(null)
    startTransition(async () => {
      const result = await archiveExperienceAction(experienceId)
      if (!result.ok) setError(result.error)
    })
  }

  function handleRejectSubmit() {
    if (!rejectReason.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await rejectExperienceAction(experienceId, rejectReason)
      if (result.ok) {
        setRejectOpen(false)
        setRejectReason('')
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      {status === 'pending_review' && (
        <>
          <Button
            variant="default"
            size="sm"
            disabled={isPending}
            onClick={handleApprove}
          >
            Approve
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => setRejectOpen(true)}
            className="text-destructive hover:text-destructive"
          >
            Reject
          </Button>
        </>
      )}
      {status === 'published' && (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={handlePause}
          >
            Pause
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={handleArchive}
            className="text-destructive hover:text-destructive"
          >
            Archive
          </Button>
        </>
      )}
      {status === 'paused' && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={handleArchive}
          className="text-destructive hover:text-destructive"
        >
          Archive
        </Button>
      )}
      {error && (
        <span className="text-xs text-destructive">{error}</span>
      )}

      <Dialog open={rejectOpen} onOpenChange={(open) => setRejectOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Experience</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting this experience. This will be
              recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Rejection reason..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={4}
          />
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectSubmit}
              disabled={isPending || !rejectReason.trim()}
            >
              Reject
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
