'use client'

import { useActionState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { toggleSuspendAction } from './actions'

interface SuspendToggleFormProps {
  vendorUserId: string
  suspended: boolean
}

export function SuspendToggleForm({ vendorUserId, suspended }: SuspendToggleFormProps) {
  const [state, action, pending] = useActionState(
    async (_prev: { ok: boolean; error?: string } | null, formData: FormData) => {
      const result = await toggleSuspendAction(formData)
      return result.ok ? { ok: true } : { ok: false, error: 'error' in result ? result.error : 'Failed' }
    },
    null,
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Account Status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Status:</span>
          {suspended ? (
            <Badge variant="destructive">Suspended</Badge>
          ) : (
            <Badge variant="default">Active</Badge>
          )}
        </div>

        <form action={action} className="space-y-3">
          <input type="hidden" name="vendorUserId" value={vendorUserId} />
          <div>
            <Label htmlFor="suspend-notes">
              {suspended ? 'Reactivation' : 'Suspension'} Notes (required)
            </Label>
            <Textarea
              id="suspend-notes"
              name="notes"
              placeholder={
                suspended
                  ? 'e.g. Issue resolved, reinstated.'
                  : 'e.g. Repeated policy violations.'
              }
              required
              minLength={1}
              rows={2}
            />
          </div>
          {state && !state.ok && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          {state?.ok && (
            <p className="text-sm text-green-600">
              {suspended ? 'Vendor reactivated.' : 'Vendor suspended.'}
            </p>
          )}
          <Button
            type="submit"
            disabled={pending}
            variant={suspended ? 'default' : 'destructive'}
            size="sm"
          >
            {pending
              ? suspended
                ? 'Reactivating...'
                : 'Suspending...'
              : suspended
                ? 'Reactivate Vendor'
                : 'Suspend Vendor'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
