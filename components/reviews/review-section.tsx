'use client'

import { useMemo, useState } from 'react'

import { BadgeCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  REVIEW_SORTS,
  sortReviews,
  type EnrichedReview,
  type ReviewGroupType,
  type ReviewSort,
} from '@/lib/reviews/enrichment'

import { ReviewStars } from './review-stars'

export interface ReviewSectionProps {
  reviews: EnrichedReview[]
  locale: string
  /** 12 localized month names, January … December. */
  monthNames: string[]
  /** ICU-free template carrying a single `{month}` placeholder. */
  travelledInLabel: string
  verifiedLabel: string
  groupTypeLabels: Record<ReviewGroupType, string>
  sortLabel: string
  sortLabels: Record<ReviewSort, string>
  emptyLabel: string
  /** Template carrying `{avg}` and `{count}` placeholders. */
  summaryLabel: string
}

export function ReviewSection({
  reviews,
  locale,
  monthNames,
  travelledInLabel,
  verifiedLabel,
  groupTypeLabels,
  sortLabel,
  sortLabels,
  emptyLabel,
  summaryLabel,
}: ReviewSectionProps) {
  const [sort, setSort] = useState<ReviewSort>('recent')

  const sorted = useMemo(() => sortReviews(reviews, sort), [reviews, sort])

  if (reviews.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">{emptyLabel}</p>
  }

  const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
  const summary = summaryLabel
    .replace('{avg}', avgRating.toFixed(1))
    .replace('{count}', String(reviews.length))

  return (
    <div className="space-y-4">
      {/* Summary + sort controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ReviewStars rating={Math.round(avgRating)} />
          <span className="text-sm text-muted-foreground">{summary}</span>
        </div>
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={sortLabel}
        >
          {REVIEW_SORTS.map((mode) => (
            <button
              key={mode}
              type="button"
              data-testid={`review-sort-${mode}`}
              aria-pressed={sort === mode}
              onClick={() => setSort(mode)}
              className={cn(
                'min-tap rounded-[var(--radius-pill)] border px-3 py-1 text-xs font-medium transition-colors',
                sort === mode
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              {sortLabels[mode]}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Individual reviews */}
      <div className="space-y-4">
        {sorted.map((rev) => {
          const monthName =
            rev.travelMonth != null ? monthNames[rev.travelMonth - 1] : null
          const groupLabel = rev.groupType ? groupTypeLabels[rev.groupType] : null
          return (
            <div key={rev.id} data-testid="review-item" className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <ReviewStars rating={rev.rating} />
                <span className="text-sm font-medium">{rev.customerName}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(rev.createdAt).toLocaleDateString(locale, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
                {/* Verified-booking badge — every Review is booking-backed. */}
                <Badge variant="success" data-icon="inline-start">
                  <BadgeCheck aria-hidden="true" />
                  {verifiedLabel}
                </Badge>
              </div>
              {(monthName || groupLabel) && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {monthName && (
                    <span>{travelledInLabel.replace('{month}', monthName)}</span>
                  )}
                  {monthName && groupLabel && <span aria-hidden="true">·</span>}
                  {groupLabel && <span>{groupLabel}</span>}
                </div>
              )}
              {rev.title && (
                <p data-testid="review-title" className="text-sm font-medium">
                  {rev.title}
                </p>
              )}
              {rev.body && (
                <p className="text-sm text-muted-foreground">{rev.body}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
