import { desc, eq } from 'drizzle-orm'
import { Star } from 'lucide-react'
import Link from 'next/link'
import { headers } from 'next/headers'

import { ReviewStars } from '@/components/reviews/review-stars'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { db } from '@/db/client'
import { experiences, reviews, users } from '@/db/schema'
import { auth } from '@/lib/auth'

import { VendorTableTabs } from '../vendor-table-tabs'

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

      <VendorTableTabs active="reviews" />

      {totalReviews === 0 ? (
        // A5 empty state — a launchpad, not a dead end (DESIGN.md §4 A5; fixes
        // the as-is "dead empty state" defect). Keeps the "No reviews yet" copy
        // the E2E asserts when there are none.
        <div className="flex flex-col items-center justify-center rounded-lg border py-16 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
            <Star className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <p className="text-lg font-medium">No reviews yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Reviews will appear here once customers leave feedback on your
            experiences. Keep your listings sharp and your availability open to
            earn your first one.
          </p>
          <Link href="/vendor/listings" className="mt-4">
            <Button variant="outline" size="sm">
              Manage your listings
            </Button>
          </Link>
        </div>
      ) : (
        <>
          {/* Average rating summary */}
          <Card>
            <CardContent className="flex items-center gap-4 py-4">
              <div className="flex flex-col items-center">
                <span className="text-3xl font-bold tabular-nums">
                  {avgRating.toFixed(1)}
                </span>
                <ReviewStars rating={Math.round(avgRating)} />
              </div>
              <Separator orientation="vertical" className="h-12" />
              <div>
                <p className="text-sm font-medium tabular-nums">
                  {totalReviews} review{totalReviews === 1 ? '' : 's'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Across all your experiences
                </p>
              </div>
            </CardContent>
          </Card>

          {/* A3 reviews table — one addressable row per Review (DESIGN.md §4 A3). */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rating</TableHead>
                    <TableHead>Review</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Response</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((review) => (
                    <TableRow
                      key={review.id}
                      data-testid="review-row"
                      data-review-id={review.id}
                    >
                      <TableCell className="align-top">
                        <span data-testid="review-rating">
                          <ReviewStars rating={review.rating} />
                        </span>
                      </TableCell>
                      <TableCell className="max-w-md align-top">
                        {review.title && (
                          <p className="text-sm font-medium">{review.title}</p>
                        )}
                        {review.body && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {review.body}
                          </p>
                        )}
                        {review.experienceTitle && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {review.experienceTitle}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        {review.customerName ?? 'Customer'}
                      </TableCell>
                      <TableCell className="align-top text-xs text-muted-foreground">
                        {new Date(review.createdAt).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </TableCell>
                      <TableCell className="min-w-[16rem] align-top">
                        {/* Vendor response display or the (preserved #20) respond
                            flow — exactly one public response per Review. */}
                        {review.vendorResponse ? (
                          <div className="rounded-md border border-border bg-muted/50 px-3 py-2">
                            <p className="text-xs font-medium text-muted-foreground">
                              Your response
                              {review.vendorRespondedAt && (
                                <>
                                  {' '}
                                  &middot;{' '}
                                  {new Date(
                                    review.vendorRespondedAt,
                                  ).toLocaleDateString('en-IN', {
                                    day: 'numeric',
                                    month: 'short',
                                    year: 'numeric',
                                  })}
                                </>
                              )}
                            </p>
                            <p className="mt-1 text-sm">{review.vendorResponse}</p>
                          </div>
                        ) : (
                          <VendorResponseForm reviewId={review.id} />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
