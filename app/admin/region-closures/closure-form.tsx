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

import { createClosureAction } from './actions'

export function CreateClosureButton() {
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [regionSlug, setRegionSlug] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit() {
    setError(null)
    startTransition(async () => {
      const result = await createClosureAction(regionSlug, startAt, endAt, reason)
      if (result.ok) {
        setOpen(false)
        setRegionSlug('')
        setStartAt('')
        setEndAt('')
        setReason('')
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <>
      <Button onClick={() => { setError(null); setOpen(true) }}>
        Add Closure
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Region Closure</DialogTitle>
            <DialogDescription>
              Block all bookings in a region for a date range. This is destructive:
              creating the closure immediately pauses every affected Booking in the
              region and disables Book-now on its Experiences (ADR-0011). Confirm
              before you create.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="region-slug">Region Slug</Label>
              <Input
                id="region-slug"
                placeholder="e.g. rishikesh"
                value={regionSlug}
                onChange={(e) => setRegionSlug(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start-date">Start Date</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-date">End Date</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason">Reason</Label>
              <Textarea
                id="reason"
                placeholder="e.g. Monsoon season — rafting unsafe"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isPending || !regionSlug || !startAt || !endAt || !reason}
              >
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
