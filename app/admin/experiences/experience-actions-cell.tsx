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

/** Which consequential moderation confirm is open (null = none). */
type ConfirmKind = 'approve' | 'pause' | 'archive' | null

export function ExperienceActionsCell({
  experienceId,
  status,
}: ExperienceActionsCellProps) {
  const [isPending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState<ConfirmKind>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleApprove() {
    setError(null)
    startTransition(async () => {
      const result = await approveExperienceAction(experienceId)
      if (result.ok) {
        setConfirm(null)
      } else {
        setError(result.error)
        setConfirm(null)
      }
    })
  }

  function handlePause() {
    setError(null)
    startTransition(async () => {
      const result = await pauseExperienceAction(experienceId)
      if (result.ok) {
        setConfirm(null)
      } else {
        setError(result.error)
        setConfirm(null)
      }
    })
  }

  function handleArchive() {
    setError(null)
    startTransition(async () => {
      const result = await archiveExperienceAction(experienceId)
      if (result.ok) {
        setConfirm(null)
      } else {
        setError(result.error)
        setConfirm(null)
      }
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
            onClick={() => {
              setError(null)
              setConfirm('approve')
            }}
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
            onClick={() => {
              setError(null)
              setConfirm('pause')
            }}
          >
            Pause
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => {
              setError(null)
              setConfirm('archive')
            }}
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
          onClick={() => {
            setError(null)
            setConfirm('archive')
          }}
          className="text-destructive hover:text-destructive"
        >
          Archive
        </Button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}

      {/* Approve = PUBLISH + index for search (ADR-0013). Consequential, so
          confirm before it goes live (DESIGN.md §4 A4). */}
      <Dialog
        open={confirm === 'approve'}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <DialogContent data-testid="approve-confirm">
          <DialogHeader>
            <DialogTitle>Approve &amp; publish</DialogTitle>
            <DialogDescription>
              This Experience will be published and indexed for search — it
              becomes discoverable in the live catalog (ADR-0013). KYC tier caps
              are re-checked before it goes live (ADR-0007).
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirm(null)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleApprove}
              disabled={isPending}
            >
              Approve &amp; publish
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pause = DE-INDEX from search (ADR-0013). */}
      <Dialog
        open={confirm === 'pause'}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <DialogContent data-testid="pause-confirm">
          <DialogHeader>
            <DialogTitle>Pause Experience</DialogTitle>
            <DialogDescription>
              This Experience will be de-indexed and removed from search results
              until it is re-published (ADR-0013). Existing Bookings are
              unaffected.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirm(null)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handlePause}
              disabled={isPending}
            >
              Pause
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Archive = remove from catalog + DE-INDEX (ADR-0013). Terminal. */}
      <Dialog
        open={confirm === 'archive'}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <DialogContent data-testid="archive-confirm">
          <DialogHeader>
            <DialogTitle>Archive Experience</DialogTitle>
            <DialogDescription>
              This removes the Experience from the catalog and de-indexes it from
              search (ADR-0013). This is terminal — archived Experiences cannot
              be re-published.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirm(null)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleArchive}
              disabled={isPending}
            >
              Archive
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
          {error && <p className="text-sm text-destructive">{error}</p>}
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
