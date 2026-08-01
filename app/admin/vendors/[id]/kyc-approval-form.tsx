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

/**
 * One sentence telling the admin what their approval actually did to the
 * Vendor's queued listings — the consequence they came to the page for.
 */
function cascadeSummary(publishedCount: number, skippedCount: number): string {
  if (publishedCount > 0) {
    const plural = publishedCount === 1 ? 'listing is' : 'listings are'
    return `${publishedCount} ${plural} now live.`
  }
  if (skippedCount > 0) {
    return 'No listings went live.'
  }
  return 'No listings were waiting for review.'
}

interface KycApprovalFormProps {
  vendorUserId: string
  currentTier: string
}

/** An Experience the approval cascade held back, and why (ADR-0007 caps). */
interface CascadeSkip {
  experienceId: string
  code: string
  reason: string
}

type ApproveFormState =
  | { ok: true; publishedCount: number; skipped: CascadeSkip[] }
  | { ok: false; error: string }

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
 *
 * BUG A (product-owner report: "the accept/reject controls sometimes appear and
 * sometimes don't") — the whole rail used to be wrapped in `{canPromote ? … }`,
 * and KYC_TIER_NEXT has no 'business' key, so at the top tier every control was
 * ABSENT from the DOM. Since most Vendors sit at 'business', an admin moving
 * between Vendors watched the rail come and go and read it as a race.
 *
 * The invariant now: a decision control is NEVER absent. Approve is rendered
 * disabled-with-a-reason once there is nothing left to promote; Reject stays
 * live at every tier, because recording a rejection is a decision an admin can
 * legitimately take against an already-verified Vendor.
 */
export function KycApprovalForm({ vendorUserId, currentTier }: KycApprovalFormProps) {
  const nextTier = KYC_TIER_NEXT[currentTier]
  const canPromote = Boolean(nextTier)

  const [approveState, approveAction, approvePending] = useActionState(
    async (
      _prev: ApproveFormState | null,
      formData: FormData,
    ): Promise<ApproveFormState> => {
      const result = await approveKycAction(formData)
      return result.ok
        ? { ok: true, publishedCount: result.publishedCount, skipped: result.skipped }
        : { ok: false, error: 'error' in result ? result.error : 'Failed' }
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

  // Reject is never disabled-on-load — a control that is dead before the admin
  // types reads as "the buttons don't work", which is half of the BUG A report.
  // The empty-reason guard lives here instead, so the admin is TOLD what is
  // missing rather than being stonewalled by a greyed-out button.
  function handleRejectClick() {
    setRejectSuccess(false)
    setRejectError(null)
    if (reason.trim().length === 0) {
      setRejectError('Enter a rejection reason before rejecting.')
      reasonRef.current?.focus()
      return
    }
    setRejectOpen(true)
  }

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
      <p className="text-sm text-muted-foreground">
        {canPromote ? (
          <>
            Promote to <strong className="capitalize">{nextTier}</strong> or reject the
            current promotion request.
          </>
        ) : (
          <>
            This vendor has reached the highest KYC tier. No further promotions
            available — you can still record a rejection.
          </>
        )}
      </p>

      {/* Approve — inline (non-destructive forward promotion). Disabled, never
          absent, once there is no next tier to promote into. */}
      <form action={approveAction} className="space-y-3">
        <input type="hidden" name="vendorUserId" value={vendorUserId} />
        <div className="space-y-[var(--space-field)]">
          <Label htmlFor="approve-notes">Approval Notes (required)</Label>
          <Textarea
            id="approve-notes"
            name="notes"
            placeholder="e.g. Aadhaar + PAN verified offline."
            required={canPromote}
            disabled={!canPromote}
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
          <>
            <p className="text-sm text-success" role="status">
              KYC tier promoted successfully.{' '}
              {cascadeSummary(approveState.publishedCount, approveState.skipped.length)}
            </p>
            {approveState.skipped.length > 0 && (
              <div
                data-testid="cascade-skipped"
                className="space-y-1 rounded-[var(--radius-md)] border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
              >
                <p className="font-medium">Held back by the KYC tier caps:</p>
                <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                  {approveState.skipped.map((skip) => (
                    <li key={skip.experienceId}>{skip.reason}</li>
                  ))}
                </ul>
                <p className="text-muted-foreground">
                  These stay in review. Promote the Vendor further, or ask them to bring the
                  listing within the cap.
                </p>
              </div>
            )}
          </>
        )}
        <Button
          type="submit"
          disabled={approvePending || !canPromote}
          size="sm"
          className="w-full"
        >
          {approvePending ? 'Promoting...' : canPromote ? `Approve → ${nextTier}` : 'Approve'}
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
        {!rejectOpen && rejectError && (
          <p className="text-sm text-destructive" role="alert">
            {rejectError}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full text-destructive hover:text-destructive"
          disabled={isRejecting}
          onClick={handleRejectClick}
        >
          Reject Promotion
        </Button>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md" data-testid="reject-kyc-confirm">
          <DialogHeader>
            <DialogTitle>Reject promotion</DialogTitle>
            <DialogDescription>
              {canPromote ? (
                <>
                  The promotion to{' '}
                  <span className="font-medium capitalize text-foreground">{nextTier}</span>{' '}
                  will be <span className="font-medium">denied</span>. The Vendor stays at{' '}
                  <span className="font-medium capitalize text-foreground">{currentTier}</span>
                  , and this reason is recorded against them in the audit log:
                </>
              ) : (
                <>
                  This Vendor is already{' '}
                  <span className="font-medium capitalize text-foreground">{currentTier}</span>
                  -verified, so no promotion is <span className="font-medium">denied</span>.
                  The rejection and this reason are recorded against them in the audit log:
                </>
              )}
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
    </div>
  )
}
