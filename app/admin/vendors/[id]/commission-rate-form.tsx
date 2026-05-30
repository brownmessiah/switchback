'use client'

import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { updateCommissionRateAction } from './actions'

interface CommissionRateFormProps {
  vendorUserId: string
  currentRate: string
}

/**
 * #101 — Commission-rate change in the Evidence Cockpit decision rail. A
 * commission change moves money on every FUTURE Booking (existing Booking
 * snapshots stay immutable, ADR-0008 — enforced server-side), so it is gated
 * behind an A4-style confirm Dialog that RESTATES the NEW rate (in
 * `.tabular-nums` per DESIGN.md §1.3) before commit. updateCommissionRateAction
 * fires ONLY from the explicit "Update Rate" inside the dialog, with the same
 * FormData inputs the unchanged action expects.
 *
 * The read-only display + "Edit" → #commissionRate field + "Save" + "Rate
 * updated successfully." confirmation are preserved for the #22 commission E2E
 * (which clicks through the added confirm).
 */
export function CommissionRateForm({ vendorUserId, currentRate }: CommissionRateFormProps) {
  const [editing, setEditing] = useState(false)
  const [newRate, setNewRate] = useState(currentRate)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  // Clicking Save opens the confirm — it does NOT update the rate inline.
  function handleOpenConfirm() {
    const value = inputRef.current?.value ?? newRate
    setNewRate(value)
    setError(null)
    setConfirmOpen(true)
  }

  // The money write — fires ONLY from the dialog's explicit confirm.
  function handleConfirm() {
    setError(null)
    const formData = new FormData()
    formData.set('vendorUserId', vendorUserId)
    formData.set('commissionRate', newRate)
    startTransition(async () => {
      const result = await updateCommissionRateAction(formData)
      if (result.ok) {
        setConfirmOpen(false)
        setEditing(false)
        setSuccess(true)
        return
      }
      setError('error' in result ? result.error : 'Failed')
    })
  }

  return (
    <div>
      {!editing ? (
        <div className="flex items-center justify-between">
          <p className="text-2xl font-semibold tabular-nums">{currentRate}%</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSuccess(false)
              setNewRate(currentRate)
              setEditing(true)
            }}
          >
            Edit
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-[var(--space-field)]">
            <Label htmlFor="commissionRate">New Rate (%)</Label>
            <Input
              id="commissionRate"
              name="commissionRate"
              ref={inputRef}
              type="number"
              min={0}
              max={100}
              step={0.01}
              defaultValue={currentRate}
              onChange={(e) => setNewRate(e.target.value)}
              required
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" disabled={isPending} size="sm" onClick={handleOpenConfirm}>
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false)
                setNewRate(currentRate)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {success && (
        <p className="mt-2 text-sm text-success" role="status">
          Rate updated successfully.
        </p>
      )}

      {/* A4 confirm — restates the NEW rate (tabular-nums) before the money write. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md" data-testid="commission-rate-confirm">
          <DialogHeader>
            <DialogTitle>Change commission rate</DialogTitle>
            <DialogDescription>
              This sets the Vendor&apos;s base Commission rate for all FUTURE Bookings.
              Existing Bookings keep their locked snapshot (ADR-0008). Recorded in the
              audit log.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-[var(--radius-md)] border bg-muted/40 px-4 py-3 text-center">
            <p
              data-testid="commission-rate-confirm-figure"
              className="text-2xl font-semibold tabular-nums tracking-tight"
            >
              {newRate}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              New base commission rate (was {currentRate}%)
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="button" disabled={isPending} onClick={handleConfirm}>
              {isPending ? 'Updating…' : 'Update Rate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
