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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { approveRefundAction, rejectRefundAction } from './actions'

interface RefundActionsCellProps {
  refundRequestId: string
  state: string
  amount: number
  notes: string | null
}

export function RefundActionsCell({
  refundRequestId,
  state,
  amount,
  notes,
}: RefundActionsCellProps) {
  const [isPending, startTransition] = useTransition()
  const [approveOpen, setApproveOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [approveAmount, setApproveAmount] = useState(amount.toString())
  const [rejectReason, setRejectReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleApproveSubmit() {
    const numAmount = parseInt(approveAmount, 10)
    if (isNaN(numAmount) || numAmount <= 0) {
      setError('Amount must be a positive integer.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await approveRefundAction(refundRequestId, numAmount)
      if (result.ok) {
        setApproveOpen(false)
      } else {
        setError(result.error)
      }
    })
  }

  function handleRejectSubmit() {
    if (!rejectReason.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await rejectRefundAction(refundRequestId, rejectReason)
      if (result.ok) {
        setRejectOpen(false)
        setRejectReason('')
      } else {
        setError(result.error)
      }
    })
  }

  if (state === 'pending') {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setApproveAmount(amount.toString())
            setError(null)
            setApproveOpen(true)
          }}
        >
          Approve
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setError(null)
            setRejectOpen(true)
          }}
          className="text-destructive hover:text-destructive"
        >
          Reject
        </Button>

        {error && (
          <span className="text-xs text-destructive">{error}</span>
        )}

        {/* Approve dialog */}
        <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Approve Refund</DialogTitle>
              <DialogDescription>
                Confirm the refund amount. The Customer&apos;s Refund balance will
                be credited immediately. You may approve a partial amount.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="approve-amount">Refund amount (₹)</Label>
                <Input
                  id="approve-amount"
                  type="number"
                  min={1}
                  max={amount}
                  value={approveAmount}
                  onChange={(e) => setApproveAmount(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Requested amount: ₹{amount.toLocaleString('en-IN')}
                </p>
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setApproveOpen(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  onClick={handleApproveSubmit}
                  disabled={isPending}
                >
                  Approve Refund
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Reject dialog */}
        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Refund</DialogTitle>
              <DialogDescription>
                Provide a reason for rejecting this refund request. This will be
                recorded in the audit log and shown to the Customer.
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
                Reject Refund
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // Non-pending states: show badge + notes
  return (
    <div className="flex items-center gap-2">
      {state === 'credited' && (
        <Badge variant="default" className="bg-green-600 text-xs">
          Credited
        </Badge>
      )}
      {state === 'approved' && (
        <Badge variant="secondary" className="text-xs">
          Approved
        </Badge>
      )}
      {state === 'rejected' && (
        <Badge variant="destructive" className="text-xs">
          Rejected
        </Badge>
      )}
      {state === 'failed' && (
        <Badge variant="destructive" className="text-xs">
          Failed
        </Badge>
      )}
      {notes && (
        <span className="text-xs text-muted-foreground max-w-[200px] truncate" title={notes}>
          {notes}
        </span>
      )}
    </div>
  )
}
