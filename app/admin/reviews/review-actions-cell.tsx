'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'

import { flagReviewAction, publishReviewAction, removeReviewAction } from './actions'

interface ReviewActionsCellProps {
  reviewId: string
  status: string
}

export function ReviewActionsCell({ reviewId, status }: ReviewActionsCellProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleAction(action: (id: string) => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await action(reviewId)
      if (!result.ok && 'error' in result) {
        setError(result.error ?? 'Action failed.')
      }
    })
  }

  const canFlag = status === 'pending' || status === 'published'
  const canRemove = status === 'pending' || status === 'published' || status === 'flagged'
  const canPublish = status === 'pending' || status === 'flagged'

  return (
    <div className="flex items-center gap-1">
      {canPublish && (
        <Button
          variant="default"
          size="sm"
          disabled={isPending}
          onClick={() => handleAction(publishReviewAction)}
        >
          Publish
        </Button>
      )}
      {canFlag && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => handleAction(flagReviewAction)}
        >
          Flag
        </Button>
      )}
      {canRemove && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          className="text-destructive hover:text-destructive"
          onClick={() => handleAction(removeReviewAction)}
        >
          Remove
        </Button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
