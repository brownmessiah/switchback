'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'

import { submitExperienceForReviewAction } from './[id]/submit-actions'

interface SubmitForReviewButtonProps {
  experienceId: string
  status: string
  completenessPercent: number
}

/**
 * The Vendor's "ask an admin to look at this" control — the `draft →
 * pending_review` half of the listing lifecycle.
 *
 * A listing only reaches the admin moderation queue (and therefore the public
 * site) once it is submitted. The control is deliberately explicit about why
 * it is unavailable: an incomplete draft gets a DISABLED button plus the
 * completeness figure, never a missing one, so the Vendor is never left
 * guessing why they cannot proceed.
 */
export function SubmitForReviewButton({
  experienceId,
  status,
  completenessPercent,
}: SubmitForReviewButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  if (status === 'pending_review' || submitted) {
    return (
      <span className="text-sm text-muted-foreground" role="status">
        In review
      </span>
    )
  }

  // Only a draft can be submitted. Published / paused / archived listings are
  // moved by the admin moderation path, not from here.
  if (status !== 'draft') {
    return null
  }

  const isComplete = completenessPercent >= 100

  function handleSubmit() {
    setError(null)
    startTransition(async () => {
      const result = await submitExperienceForReviewAction(experienceId)
      if (result.ok) {
        setSubmitted(true)
        return
      }
      setError(result.error)
    })
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending || !isComplete}
        onClick={handleSubmit}
      >
        {isPending ? 'Submitting…' : 'Submit for review'}
      </Button>
      {!isComplete && (
        <p className="text-xs text-muted-foreground">
          {completenessPercent}% complete — fill in the rest to submit.
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
