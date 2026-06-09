'use client'

import { TriangleAlert } from 'lucide-react'
import type { ReactElement } from 'react'

import { Button } from '@/components/ui/button'

interface SegmentErrorProps {
  /** Next.js error-boundary reset — re-renders the segment (the retry). */
  reset: () => void
  /** Optional override heading. */
  title?: string
  /** Optional override description. */
  description?: string
  /** Optional override retry label. */
  retryLabel?: string
}

/**
 * Shared segment error-boundary UI (issue 25 / DECISION D11). A consistent,
 * EmptyState-style "graceful degradation" panel with a clear retry, reused by
 * the (app) and vendor dashboard `error.tsx` boundaries so a network/load
 * failure degrades to a helpful, recoverable state instead of a blank crash.
 *
 * Error boundaries are client components and cannot await getTranslations, so —
 * like the root `app/error.tsx` — the copy defaults to plain English and is
 * overridable via props if a caller has localised strings on hand.
 */
export function SegmentError({
  reset,
  title = 'Something went wrong',
  description = "We couldn't load this page. This is usually a temporary network issue — please try again.",
  retryLabel = 'Try again',
}: SegmentErrorProps): ReactElement {
  return (
    <div
      data-testid="segment-error"
      className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-border px-6 py-16 text-center"
    >
      <span
        aria-hidden="true"
        className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <TriangleAlert className="size-7" />
      </span>
      <p className="text-lg font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      <Button onClick={reset} className="mt-5 min-tap">
        {retryLabel}
      </Button>
    </div>
  )
}
