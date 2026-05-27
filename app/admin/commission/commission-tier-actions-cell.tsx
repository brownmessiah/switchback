'use client'

import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import {
  deleteCommissionTier,
  updateCommissionTier,
  type CommissionTierActionResult,
} from './actions'

interface CommissionTierActionsCellProps {
  id: string
  name: string
  rateOverride: string
  reason: string
  startAt: Date
  endAt: Date
}

export function CommissionTierActionsCell({
  id,
  name,
  rateOverride,
  reason,
  startAt,
  endAt,
}: CommissionTierActionsCellProps) {
  const [isPending, startTransition] = useTransition()
  const [editOpen, setEditOpen] = useState(false)
  const [editResult, setEditResult] = useState<CommissionTierActionResult | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function handleEdit(formData: FormData) {
    formData.set('id', id)
    startTransition(async () => {
      const res = await updateCommissionTier(formData)
      setEditResult(res)
      if (res.ok) {
        setEditOpen(false)
      }
    })
  }

  function handleDelete() {
    if (!confirm(`Delete commission tier "${name}"?`)) return
    startTransition(async () => {
      await deleteCommissionTier(id)
    })
  }

  // Format dates for datetime-local input
  function toLocalDatetime(d: Date): string {
    const date = new Date(d)
    const offset = date.getTimezoneOffset()
    const local = new Date(date.getTime() - offset * 60_000)
    return local.toISOString().slice(0, 16)
  }

  return (
    <div className="flex items-center gap-2">
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger
          render={<Button variant="outline" size="sm" disabled={isPending} />}
        >
          Edit
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Commission Tier</DialogTitle>
            <DialogDescription>
              Update the tier details. Name must be a lowercase slug.
            </DialogDescription>
          </DialogHeader>
          <form ref={formRef} action={handleEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`edit-name-${id}`}>Name</Label>
              <Input
                id={`edit-name-${id}`}
                name="name"
                defaultValue={name}
                pattern="^[a-z0-9_-]+$"
                title="Lowercase letters, numbers, hyphens, underscores only"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-rate-${id}`}>Rate (%)</Label>
              <Input
                id={`edit-rate-${id}`}
                name="rateOverride"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={Number(rateOverride)}
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`edit-start-${id}`}>Start Date</Label>
                <Input
                  id={`edit-start-${id}`}
                  name="startAt"
                  type="datetime-local"
                  defaultValue={toLocalDatetime(startAt)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`edit-end-${id}`}>End Date</Label>
                <Input
                  id={`edit-end-${id}`}
                  name="endAt"
                  type="datetime-local"
                  defaultValue={toLocalDatetime(endAt)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-reason-${id}`}>Reason</Label>
              <Textarea
                id={`edit-reason-${id}`}
                name="reason"
                defaultValue={reason}
                required
              />
            </div>

            {editResult && !editResult.ok && (
              <p className="text-sm text-destructive" role="alert">
                {editResult.error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={handleDelete}
        className="text-destructive hover:text-destructive"
      >
        Delete
      </Button>
    </div>
  )
}
