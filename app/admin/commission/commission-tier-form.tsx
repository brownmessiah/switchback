'use client'

import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { createCommissionTier, type CommissionTierActionResult } from './actions'

export function CommissionTierCreateForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<CommissionTierActionResult | null>(null)

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await createCommissionTier(formData)
      setResult(res)
      if (res.ok) {
        formRef.current?.reset()
      }
    })
  }

  return (
    <form ref={formRef} action={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name (slug)</Label>
          <Input
            id="name"
            name="name"
            placeholder="diwali-2026"
            pattern="^[a-z0-9_-]+$"
            title="Lowercase letters, numbers, hyphens, underscores only"
            required
          />
          <p className="text-xs text-muted-foreground">
            Lowercase slug: a-z, 0-9, hyphens, underscores
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rateOverride">Commission Rate (%)</Label>
          <Input
            id="rateOverride"
            name="rateOverride"
            type="number"
            min={0}
            max={100}
            step="0.01"
            placeholder="15"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="startAt">Start Date</Label>
          <Input id="startAt" name="startAt" type="datetime-local" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="endAt">End Date</Label>
          <Input id="endAt" name="endAt" type="datetime-local" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="appliesToCategories">Categories (comma-separated)</Label>
          <Input
            id="appliesToCategories"
            name="appliesToCategories"
            placeholder="rafting, kayaking"
          />
          <p className="text-xs text-muted-foreground">
            Leave empty for all categories
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="appliesToVendorIds">Vendor IDs (comma-separated)</Label>
          <Input
            id="appliesToVendorIds"
            name="appliesToVendorIds"
            placeholder="vendor_id_1, vendor_id_2"
          />
          <p className="text-xs text-muted-foreground">
            Leave empty for all vendors
          </p>
        </div>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
          <Label htmlFor="reason">Reason</Label>
          <Textarea
            id="reason"
            name="reason"
            placeholder="Festival season commission adjustment"
            required
          />
        </div>
      </div>

      {result && !result.ok && (
        <p className="text-sm text-destructive" role="alert">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <p className="text-sm text-green-600" role="status">
          Commission tier created.
        </p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? 'Creating...' : 'Create Commission Tier'}
      </Button>
    </form>
  )
}
