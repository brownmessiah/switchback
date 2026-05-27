'use client'

import { useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
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
  approvePayoutAction,
  holdPayoutAction,
  rejectPayoutAction,
} from './actions'

interface PayoutActionsCellProps {
  bookingId: string
  payoutState: 'pending' | 'approved' | 'rejected' | 'held'
  manualPayoutsRemaining: number
}

export function PayoutActionsCell({
  bookingId,
  payoutState,
  manualPayoutsRemaining,
}: PayoutActionsCellProps) {
  const [isPending, startTransition] = useTransition()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [holdOpen, setHoldOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [holdReason, setHoldReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleApprove() {
    setError(null)
    startTransition(async () => {
      const result = await approvePayoutAction(bookingId)
      if (!result.ok) setError(result.error)
    })
  }

  function handleRejectSubmit() {
    if (!rejectReason.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await rejectPayoutAction(bookingId, rejectReason)
      if (result.ok) {
        setRejectOpen(false)
        setRejectReason('')
      } else {
        setError(result.error)
      }
    })
  }

  function handleHoldSubmit() {
    if (!holdReason.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await holdPayoutAction(bookingId, holdReason)
      if (result.ok) {
        setHoldOpen(false)
        setHoldReason('')
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      {manualPayoutsRemaining > 0 && (
        <Badge variant="secondary" className="text-xs">
          Manual: {manualPayoutsRemaining}
        </Badge>
      )}

      {(payoutState === 'pending' || payoutState === 'held') && (
        <>
          <Button
            variant="default"
            size="sm"
            disabled={isPending}
            onClick={handleApprove}
          >
            Approve
          </Button>
          {payoutState === 'pending' && (
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setHoldOpen(true)}
            >
              Hold
            </Button>
          )}
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

      {payoutState === 'approved' && (
        <Badge variant="default" className="bg-green-600 text-xs">
          Approved
        </Badge>
      )}

      {payoutState === 'rejected' && (
        <Badge variant="destructive" className="text-xs">
          Rejected
        </Badge>
      )}

      {payoutState === 'held' && (
        <Badge variant="secondary" className="border-yellow-500 text-yellow-700 text-xs">
          Held
        </Badge>
      )}

      {error && (
        <span className="text-xs text-destructive">{error}</span>
      )}

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={(open) => setRejectOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Payout</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting this payout. This will be
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

      {/* Hold dialog */}
      <Dialog open={holdOpen} onOpenChange={(open) => setHoldOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hold Payout</DialogTitle>
            <DialogDescription>
              Provide a reason for holding this payout (e.g. dispute
              investigation). This freezes the payout timer.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Hold reason..."
            value={holdReason}
            onChange={(e) => setHoldReason(e.target.value)}
            rows={4}
          />
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setHoldOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleHoldSubmit}
              disabled={isPending || !holdReason.trim()}
            >
              Hold Payout
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
