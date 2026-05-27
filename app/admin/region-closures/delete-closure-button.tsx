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

import { deleteClosureAction } from './actions'

interface DeleteClosureButtonProps {
  closureId: string
  regionSlug: string
}

export function DeleteClosureButton({
  closureId,
  regionSlug,
}: DeleteClosureButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleDelete() {
    setError(null)
    startTransition(async () => {
      const result = await deleteClosureAction(closureId)
      if (result.ok) {
        setOpen(false)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => { setError(null); setOpen(true) }}
        disabled={isPending}
      >
        Delete
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Region Closure</DialogTitle>
            <DialogDescription>
              Remove the closure for <strong>{regionSlug}</strong>? This will
              re-enable bookings in this region for the affected dates.
            </DialogDescription>
          </DialogHeader>
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
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
