'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { updateCommissionRateAction } from './actions'

interface CommissionRateFormProps {
  vendorUserId: string
  currentRate: string
}

export function CommissionRateForm({ vendorUserId, currentRate }: CommissionRateFormProps) {
  const [editing, setEditing] = useState(false)

  const [state, action, pending] = useActionState(
    async (_prev: { ok: boolean; error?: string } | null, formData: FormData) => {
      const result = await updateCommissionRateAction(formData)
      if (result.ok) {
        setEditing(false)
        return { ok: true }
      }
      return { ok: false, error: 'error' in result ? result.error : 'Failed' }
    },
    null,
  )

  if (!editing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Commission Rate</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <p className="text-2xl font-semibold">{currentRate}%</p>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
          {state?.ok && (
            <p className="mt-2 text-sm text-green-600">Rate updated successfully.</p>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Commission Rate</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <input type="hidden" name="vendorUserId" value={vendorUserId} />
          <div>
            <Label htmlFor="commissionRate">New Rate (%)</Label>
            <Input
              id="commissionRate"
              name="commissionRate"
              type="number"
              min={0}
              max={100}
              step={0.01}
              defaultValue={currentRate}
              required
            />
          </div>
          {state && !state.ok && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending} size="sm">
              {pending ? 'Saving...' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
