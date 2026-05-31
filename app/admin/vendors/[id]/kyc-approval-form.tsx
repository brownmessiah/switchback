'use client'

import { useActionState, useRef, useState, useTransition } from 'react'

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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { approveKycAction, rejectKycAction } from './actions'

const KYC_TIER_NEXT: Record<string, string> = {
  phone: 'identity',
  identity: 'business',
}

interface KycApprovalFormProps {
  vendorUserId: string
  currentTier: string
}

/**
 * #101 — KYC approve / reject in the Evidence Cockpit decision rail.
 *
 * APPROVE is a forward promotion (phone→identity→business, ADR-0007), not a
 * destructive action, so it keeps its inline submit — preserving the #22
 * KYC-approve E2E selectors (#approve-notes + the "Approve → {tier}" button +
 * the "KYC tier promoted successfully." inline confirmation).
 *
 * REJECT denies the promotion AND records the reason against the Vendor — a
 * destructive/trust action that previously fired inline UNGUARDED. It is now
 * gated behind a plain confirm Dialog (mirroring the sub-admin revoke pattern)
 * that RESTATES the consequence (promotion denied + the reason) before commit;
 * rejectKycAction fires ONLY from the explicit "Confirm Rejection" inside the
 * dialog. Both call the UNCHANGED actions with the same FormData inputs.
 */
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

  // Reject is gated: the textarea stays inline (so #reject-reason is preserved
  // for the E2E), the "Reject Promotion" button opens the confirm, and the real
  // write fires from the dialog's explicit Confirm.
  const [reason, setReason] = useState('')
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectError, setRejectError] = useState<string | null>(null)
  const [rejectSuccess, setRejectSuccess] = useState(false)
  const [isRejecting, startReject] = useTransition()
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  function handleConfirmReject() {
    setRejectError(null)
    const formData = new FormData()
    formData.set('vendorUserId', vendorUserId)
    formData.set('reason', reason)
    startReject(async () => {
      const result = await rejectKycAction(formData)
      if (result.ok) {
        setRejectOpen(false)
        setRejectSuccess(true)
        return
      }
      setRejectError('error' in result ? result.error : 'Failed')
    })
  }

  return (
    <div className="space-y-4">
      {canPromote ? (
        <>
          <p className="text-sm text-muted-foreground">
            Promote to <strong className="capitalize">{nextTier}</strong> or reject the
            current promotion request.
          </p>

          {/* Approve — inline (non-destructive forward promotion). */}
          <form action={approveAction} className="space-y-3">
            <input type="hidden" name="vendorUserId" value={vendorUserId} />
            <div className="space-y-[var(--space-field)]">
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
              <p className="text-sm text-destructive" role="alert">
                {approveState.error}
              </p>
            )}
            {approveState?.ok && (
              <p className="text-sm text-success" role="status">
                KYC tier promoted successfully.
              </p>
            )}
            <Button type="submit" disabled={approvePending} size="sm" className="w-full">
              {approvePending ? 'Promoting...' : `Approve → ${nextTier}`}
            </Button>
          </form>

          {/* Reject — gated behind a confirm Dialog (fixes the unguarded defect). */}
          <div className="space-y-3 border-t pt-4">
            <div className="space-y-[var(--space-field)]">
              <Label htmlFor="reject-reason">Rejection Reason (required)</Label>
              <Textarea
                id="reject-reason"
                name="reason"
                ref={reasonRef}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. PAN number does not match submitted name."
                minLength={1}
                rows={2}
              />
            </div>
            {rejectSuccess && (
              <p className="text-sm text-success" role="status">
                Rejection recorded.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-destructive hover:text-destructive"
              disabled={isRejecting || reason.trim().length === 0}
              onClick={() => {
                setRejectSuccess(false)
                setRejectError(null)
                setRejectOpen(true)
              }}
            >
              Reject Promotion
            </Button>
          </div>

          <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
            <DialogContent className="sm:max-w-md" data-testid="reject-kyc-confirm">
              <DialogHeader>
                <DialogTitle>Reject promotion</DialogTitle>
                <DialogDescription>
                  The promotion to{' '}
                  <span className="font-medium capitalize text-foreground">{nextTier}</span>{' '}
                  will be <span className="font-medium">denied</span>. The Vendor stays at{' '}
                  <span className="font-medium capitalize text-foreground">{currentTier}</span>,
                  and this reason is recorded against them in the audit log:
                </DialogDescription>
              </DialogHeader>

              <p className="rounded-[var(--radius-md)] border bg-muted/40 px-3 py-2 text-sm text-foreground">
                {reason}
              </p>

              {rejectError && (
                <p className="text-sm text-destructive" role="alert">
                  {rejectError}
                </p>
              )}

              <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" />}>
                  Cancel
                </DialogClose>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isRejecting}
                  onClick={handleConfirmReject}
                >
                  {isRejecting ? 'Rejecting…' : 'Confirm Rejection'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This vendor has reached the highest KYC tier. No further promotions available.
        </p>
      )}
    </div>
  )
}
