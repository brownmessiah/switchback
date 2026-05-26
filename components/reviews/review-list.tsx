import { Separator } from '@/components/ui/separator'

import { ReviewStars } from './review-stars'

export interface ReviewData {
  id: string
  rating: number
  title: string | null
  body: string | null
  customerName: string
  createdAt: Date
}

interface ReviewListProps {
  reviews: ReviewData[]
}

export function ReviewList({ reviews }: ReviewListProps) {
  if (reviews.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        No reviews yet. Be the first to share your experience.
      </p>
    )
  }

  const avgRating =
    reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-3">
        <ReviewStars rating={Math.round(avgRating)} />
        <span className="text-sm text-muted-foreground">
          {avgRating.toFixed(1)} out of 5 ({reviews.length} review
          {reviews.length === 1 ? '' : 's'})
        </span>
      </div>

      <Separator />

      {/* Individual reviews */}
      <div className="space-y-4">
        {reviews.map((review) => (
          <div key={review.id} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <ReviewStars rating={review.rating} />
              <span className="text-sm font-medium">{review.customerName}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(review.createdAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>
            {review.title && (
              <p className="text-sm font-medium">{review.title}</p>
            )}
            {review.body && (
              <p className="text-sm text-muted-foreground">{review.body}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
