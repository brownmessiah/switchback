'use client'

import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { createPromoCode, type PromoActionResult } from './actions'

export function PromoCreateForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<PromoActionResult | null>(null)

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await createPromoCode(formData)
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
          <Label htmlFor="code">Code</Label>
          <Input id="code" name="code" placeholder="WELCOME500" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="creditAmount">Credit Amount (INR)</Label>
          <Input
            id="creditAmount"
            name="creditAmount"
            type="number"
            min={1}
            placeholder="500"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="maxTotalUses">Max Total Uses</Label>
          <Input
            id="maxTotalUses"
            name="maxTotalUses"
            type="number"
            min={1}
            placeholder="Unlimited"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="perUserLimit">Per-User Limit</Label>
          <Input
            id="perUserLimit"
            name="perUserLimit"
            type="number"
            min={1}
            defaultValue={1}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="startsAt">Starts At</Label>
          <Input id="startsAt" name="startsAt" type="datetime-local" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="expiresAt">Expires At</Label>
          <Input id="expiresAt" name="expiresAt" type="datetime-local" />
        </div>
      </div>

      {result && !result.ok && (
        <p className="text-sm text-destructive" role="alert">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <p className="text-sm text-green-600" role="status">
          Promo code created.
        </p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? 'Creating...' : 'Create Promo Code'}
      </Button>
    </form>
  )
}
