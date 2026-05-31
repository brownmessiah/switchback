'use client'

import type { ReactNode } from 'react'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

import { flagReviewAction, publishReviewAction, removeReviewAction } from './actions'

type ModerationAction = (id: string) => Promise<{ ok: boolean; error?: string }>

interface ModerationConfirmProps {
  /** Visible trigger label on the row (e.g. "Flag"). */
  triggerLabel: string
  triggerVariant: 'default' | 'outline'
  triggerClassName?: string
  /** Stable test id on the confirm Dialog content. */
  dialogTestId: string
  title: string
  /** Restates the moderation action + its public-catalog effect. */
  description: ReactNode
  /** Label on the explicit confirm button. */
  confirmLabel: string
  confirmVariant: 'default' | 'destructive'
  pendingLabel: string
  reviewId: string
  action: ModerationAction
}

/**
 * One moderation action gated behind an A4 confirm Dialog (DESIGN.md §4 A4):
 * the consequential hide/unhide moderation never fires inline — it fires only
 * from the explicit Confirm control inside the Dialog, which restates the
 * action and its effect on the public catalog before commit. Cancel is the
 * non-default focus. English-only (admin).
 */
function ModerationConfirm({
  triggerLabel,
  triggerVariant,
  triggerClassName,
  dialogTestId,
  title,
  description,
  confirmLabel,
  confirmVariant,
  pendingLabel,
  reviewId,
  action,
}: ModerationConfirmProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await action(reviewId)
      if (!result.ok && 'error' in result) {
        setError(result.error ?? 'Action failed.')
        return
      }
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant={triggerVariant}
            size="sm"
            disabled={isPending}
            className={triggerClassName}
          />
        }
      >
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" data-testid={dialogTestId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant={confirmVariant}
            disabled={isPending}
            onClick={handleConfirm}
          >
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ReviewActionsCellProps {
  reviewId: string
  status: string
}

export function ReviewActionsCell({ reviewId, status }: ReviewActionsCellProps) {
  const canFlag = status === 'pending' || status === 'published'
  const canRemove =
    status === 'pending' || status === 'published' || status === 'flagged'
  const canPublish = status === 'pending' || status === 'flagged'

  return (
    <div className="flex items-center justify-end gap-1">
      {canPublish && (
        <ModerationConfirm
          triggerLabel="Publish"
          triggerVariant="default"
          dialogTestId="review-publish-confirm"
          title="Publish review"
          description="This makes the review visible on the public Experience page (it re-enters the catalog). Continue?"
          confirmLabel="Publish review"
          confirmVariant="default"
          pendingLabel="Publishing…"
          reviewId={reviewId}
          action={publishReviewAction}
        />
      )}
      {canFlag && (
        <ModerationConfirm
          triggerLabel="Flag"
          triggerVariant="outline"
          dialogTestId="review-flag-confirm"
          title="Hide review (flag)"
          description="Flagging withholds this review from the public Experience page pending re-review. It stays in the moderation queue and can be published again. Continue?"
          confirmLabel="Hide from catalog"
          confirmVariant="default"
          pendingLabel="Hiding…"
          reviewId={reviewId}
          action={flagReviewAction}
        />
      )}
      {canRemove && (
        <ModerationConfirm
          triggerLabel="Remove"
          triggerVariant="outline"
          triggerClassName="text-destructive hover:text-destructive"
          dialogTestId="review-remove-confirm"
          title="Remove review"
          description="Removing hides this review from the public Experience page for good. This is the strongest moderation action. Continue?"
          confirmLabel="Remove review"
          confirmVariant="destructive"
          pendingLabel="Removing…"
          reviewId={reviewId}
          action={removeReviewAction}
        />
      )}
    </div>
  )
}
