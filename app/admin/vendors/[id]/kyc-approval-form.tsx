'use client'

import { useActionState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { approveKycAction, rejectKycAction } from './actions'

const KYC_TIER_LABELS: Record<string, string> = {
  phone: 'Tier 1 — Phone',
  identity: 'Tier 2 — Identity',
  business: 'Tier 3 — Business',
}

const KYC_TIER_NEXT: Record<string, string> = {
  phone: 'identity',
  identity: 'business',
}

interface KycApprovalFormProps {
  vendorUserId: string
  currentTier: string
}

export function KycApprovalForm({ vendorUserId, currentTier }: KycApprovalFormProps) {
  const nextTier = KYC_TIER_NEXT[currentTier]
  const canPromote = Boolean(nextTier)

  const [approveState, approveAction, approvePending] = useActionState(
    async (_prev: { ok: boolean; error?: string } | null, formData: FormData) => {
      const result = await approveKycAction(formData)
      return result.ok ? { ok: true } : { ok: false, error: 'error' in result ? result.error : 'Failed' }
    },
    null,
  )

  const [rejectState, rejectAction, rejectPending] = useActionState(
    async (_prev: { ok: boolean; error?: string } | null, formData: FormData) => {
      const result = await rejectKycAction(formData)
      return result.ok ? { ok: true } : { ok: false, error: 'error' in result ? result.error : 'Failed' }
    },
    null,
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">KYC Tier Management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Current Tier:</span>
          <Badge variant={currentTier === 'business' ? 'default' : 'secondary'} className="capitalize">
            {KYC_TIER_LABELS[currentTier] ?? currentTier}
          </Badge>
        </div>

        {canPromote ? (
          <>
            <p className="text-sm text-muted-foreground">
              Promote to <strong className="capitalize">{KYC_TIER_LABELS[nextTier!]}</strong> or
              reject the current promotion request.
            </p>

            {/* Approve form */}
            <form action={approveAction} className="space-y-3">
              <input type="hidden" name="vendorUserId" value={vendorUserId} />
              <div>
                <Label htmlFor="approve-notes">Approval Notes (required)</Label>
                <Textarea
                  id="approve-notes"
                  name="notes"
                  placeholder="e.g. Aadhaar + PAN verified offline."
                  required
                  minLength={1}
                  rows={2}
                />
              </div>
              {approveState && !approveState.ok && (
                <p className="text-sm text-destructive">{approveState.error}</p>
              )}
              {approveState?.ok && (
                <p className="text-sm text-green-600">KYC tier promoted successfully.</p>
              )}
              <Button type="submit" disabled={approvePending} size="sm">
                {approvePending ? 'Promoting...' : `Approve → ${nextTier}`}
              </Button>
            </form>

            {/* Reject form */}
            <form action={rejectAction} className="space-y-3 border-t pt-4">
              <input type="hidden" name="vendorUserId" value={vendorUserId} />
              <div>
                <Label htmlFor="reject-reason">Rejection Reason (required)</Label>
                <Textarea
                  id="reject-reason"
                  name="reason"
                  placeholder="e.g. PAN number does not match submitted name."
                  required
                  minLength={1}
                  rows={2}
                />
              </div>
              {rejectState && !rejectState.ok && (
                <p className="text-sm text-destructive">{rejectState.error}</p>
              )}
              {rejectState?.ok && (
                <p className="text-sm text-green-600">Rejection recorded.</p>
              )}
              <Button type="submit" disabled={rejectPending} variant="destructive" size="sm">
                {rejectPending ? 'Rejecting...' : 'Reject Promotion'}
              </Button>
            </form>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            This vendor has reached the highest KYC tier. No further promotions available.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
