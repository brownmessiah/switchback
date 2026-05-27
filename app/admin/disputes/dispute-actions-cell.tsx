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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { resolveAsCompletedAction, resolveAsCancelledAction } from './actions'

interface DisputeActionsCellProps {
  bookingId: string
  grossTotal: number
  commissionRate: string
}

export function DisputeActionsCell({
  bookingId,
  grossTotal,
  commissionRate,
}: DisputeActionsCellProps) {
  const [isPending, startTransition] = useTransition()

  // Complete dialog state
  const [completeOpen, setCompleteOpen] = useState(false)
  const [completeNotes, setCompleteNotes] = useState('')
  const [refundAmount, setRefundAmount] = useState('')
  const [adjustedRate, setAdjustedRate] = useState('')

  // Cancel dialog state
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelNotes, setCancelNotes] = useState('')

  const [error, setError] = useState<string | null>(null)

  function handleCompleteSubmit() {
    if (!completeNotes.trim()) {
      setError('Admin notes are required.')
      return
    }
    const partialRefund = refundAmount ? parseInt(refundAmount, 10) : undefined
    if (refundAmount && (isNaN(partialRefund!) || partialRefund! < 0)) {
      setError('Refund amount must be a non-negative integer.')
      return
    }
    const commissionAdj = adjustedRate.trim() || undefined
    if (commissionAdj && !/^\d{1,3}\.\d{2}$/.test(commissionAdj)) {
      setError('Commission rate must be in format XX.XX (e.g. 10.00)')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await resolveAsCompletedAction(
        bookingId,
        completeNotes,
        partialRefund,
        commissionAdj,
      )
      if (result.ok) {
        setCompleteOpen(false)
        setCompleteNotes('')
        setRefundAmount('')
        setAdjustedRate('')
      } else {
        setError(result.error)
      }
    })
  }

  function handleCancelSubmit() {
    if (!cancelNotes.trim()) {
      setError('Admin notes are required.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await resolveAsCancelledAction(bookingId, cancelNotes)
      if (result.ok) {
        setCancelOpen(false)
        setCancelNotes('')
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="default"
        size="sm"
        disabled={isPending}
        onClick={() => {
          setError(null)
          setCompleteOpen(true)
        }}
      >
        Complete
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() => {
          setError(null)
          setCancelOpen(true)
        }}
        className="text-destructive hover:text-destructive"
      >
        Cancel &amp; Refund
      </Button>

      {error && (
        <span className="text-xs text-destructive">{error}</span>
      )}

      {/* Resolve as Completed dialog */}
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve as Completed</DialogTitle>
            <DialogDescription>
              Mark this disputed Booking as completed (Vendor&apos;s favour).
              Payout countdown will resume. Optionally issue a partial refund
              and adjust the commission rate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="complete-notes">Admin notes (required)</Label>
              <Textarea
                id="complete-notes"
                placeholder="Explain the resolution..."
                value={completeNotes}
                onChange={(e) => setCompleteNotes(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partial-refund">Partial refund amount (optional, ₹)</Label>
              <Input
                id="partial-refund"
                type="number"
                min={0}
                max={grossTotal}
                placeholder="0"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Gross total: ₹{grossTotal.toLocaleString('en-IN')}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjusted-rate">
                Adjusted commission rate (optional, e.g. 10.00)
              </Label>
              <Input
                id="adjusted-rate"
                placeholder={commissionRate}
                value={adjustedRate}
                onChange={(e) => setAdjustedRate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Current rate: {commissionRate}%. Adjustment is recorded in
                the audit log for payout reconciliation.
              </p>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setCompleteOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={handleCompleteSubmit}
                disabled={isPending || !completeNotes.trim()}
              >
                Resolve as Completed
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Resolve as Cancelled Post-Experience dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Post-Experience</DialogTitle>
            <DialogDescription>
              Cancel this Booking post-experience (Customer wins). A full refund
              of ₹{grossTotal.toLocaleString('en-IN')} will be credited to the
              Customer&apos;s Refund balance. No Vendor payout will be disbursed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cancel-notes">Admin notes (required)</Label>
              <Textarea
                id="cancel-notes"
                placeholder="Explain the resolution..."
                value={cancelNotes}
                onChange={(e) => setCancelNotes(e.target.value)}
                rows={3}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setCancelOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleCancelSubmit}
                disabled={isPending || !cancelNotes.trim()}
              >
                Cancel &amp; Full Refund
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
