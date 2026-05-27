import { desc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'

import { ReviewStars } from '@/components/reviews/review-stars'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { db } from '@/db/client'
import { experiences, reviews, users } from '@/db/schema'
import { auth } from '@/lib/auth'

import { computeAverageRating } from './utils'
import { VendorResponseForm } from './vendor-response-form'

export default async function VendorReviewsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  const rows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      customerName: users.name,
      experienceTitle: experiences.title,
      createdAt: reviews.createdAt,
      vendorResponse: reviews.vendorResponse,
      vendorRespondedAt: reviews.vendorRespondedAt,
    })
    .from(reviews)
    .innerJoin(users, eq(reviews.customerUserId, users.id))
    .innerJoin(experiences, eq(reviews.experienceId, experiences.id))
    .where(eq(reviews.vendorUserId, userId))
    .orderBy(desc(reviews.createdAt))

  const avgRating = await computeAverageRating(rows.map((r) => r.rating))
  const totalReviews = rows.length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          View and respond to customer reviews.
        </p>
      </div>

      {totalReviews === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border py-16 text-center">
          <p className="text-lg font-medium">No reviews yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Reviews will appear here once customers leave feedback on your
            experiences.
          </p>
        </div>
      ) : (
        <>
          {/* Average rating summary */}
          <Card>
            <CardContent className="flex items-center gap-4 py-4">
              <div className="flex flex-col items-center">
                <span className="text-3xl font-bold">{avgRating.toFixed(1)}</span>
                <ReviewStars rating={Math.round(avgRating)} />
              </div>
              <Separator orientation="vertical" className="h-12" />
              <div>
                <p className="text-sm font-medium">
                  {totalReviews} review{totalReviews === 1 ? '' : 's'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Across all your experiences
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Individual reviews */}
          <div className="space-y-4">
            {rows.map((review) => (
              <Card key={review.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ReviewStars rating={review.rating} />
                      <span className="text-sm font-medium">
                        {review.customerName ?? 'Customer'}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(review.createdAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  {review.experienceTitle && (
                    <p className="text-xs text-muted-foreground">
                      {review.experienceTitle}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  {review.title && (
                    <p className="text-sm font-medium">{review.title}</p>
                  )}
                  {review.body && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {review.body}
                    </p>
                  )}

                  {/* Vendor response display or form */}
                  {review.vendorResponse ? (
                    <div className="mt-3 rounded-md border border-border bg-muted/50 px-4 py-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Your response
                        {review.vendorRespondedAt && (
                          <> &middot; {new Date(review.vendorRespondedAt).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}</>
                        )}
                      </p>
                      <p className="mt-1 text-sm">{review.vendorResponse}</p>
                    </div>
                  ) : (
                    <VendorResponseForm reviewId={review.id} />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
