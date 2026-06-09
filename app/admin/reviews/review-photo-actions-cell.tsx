'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'

import { approveReviewPhotoAction, rejectReviewPhotoAction } from './actions'

interface ReviewPhotoActionsCellProps {
  photoId: string
}

/**
 * Approve / reject controls for one pending Customer Review photo (issue 19),
 * wired to the admin-permission-gated server actions. Per DECISION D0/D5 a
 * photo is public only once approved; reject withholds it for good.
 * English-only (admin surface).
 */
export function ReviewPhotoActionsCell({ photoId }: ReviewPhotoActionsCellProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(action: (id: string) => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await action(photoId)
      if (!result.ok && 'error' in result) {
        setError(result.error ?? 'Action failed.')
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="default"
          disabled={isPending}
          data-testid="review-photo-approve"
          onClick={() => run(approveReviewPhotoAction)}
        >
          {isPending ? 'Working…' : 'Approve'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          disabled={isPending}
          data-testid="review-photo-reject"
          onClick={() => run(rejectReviewPhotoAction)}
        >
          Reject
        </Button>
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
