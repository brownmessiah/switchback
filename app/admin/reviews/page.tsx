import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { AdminStatusBadge } from '@/app/admin/_components/admin-status-badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'
import {
  loadReviewsList,
  type ReviewListFilters,
} from '@/lib/admin/review-moderation-actions'

import { ReviewActionsCell } from './review-actions-cell'
import { ReviewFilters } from './review-filters'

// ── Helpers ─────────────────────────────────────────────────────────

/** Human label for the moderation status cell (visible / withheld). */
const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  published: 'Visible',
  flagged: 'Hidden (flagged)',
  removed: 'Removed',
}

function formatDate(date: Date | string | null): string {
  if (!date) return '—'
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function renderStars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating)
}

// ── Page ────────────────────────────────────────────────────────────

interface ReviewsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function ReviewsPage({ searchParams }: ReviewsPageProps) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()
  await requirePermission(db, session.user.id, 'reviews')

  const params = await searchParams
  const filters: ReviewListFilters = {
    status: typeof params.status === 'string' ? params.status : undefined,
    rating:
      typeof params.rating === 'string' && !isNaN(Number(params.rating))
        ? Number(params.rating)
        : undefined,
  }

  const reviews = await loadReviewsList(db, filters)
  const isFiltered = Object.values(filters).some((v) => v !== undefined)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-h1 font-semibold tracking-tight">
          Review Moderation
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{reviews.length}</span> review
          {reviews.length === 1 ? '' : 's'}
          {isFiltered ? ' (filtered)' : ''}
        </p>
      </div>

      <ReviewFilters currentFilters={filters} />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <caption className="sr-only">
                Customer reviews with rating, status and moderation actions
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Rating</TableHead>
                  <TableHead scope="col">Review</TableHead>
                  <TableHead scope="col">Customer</TableHead>
                  <TableHead scope="col">Experience</TableHead>
                  <TableHead scope="col">Vendor</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Date</TableHead>
                  <TableHead scope="col" className="text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-muted-foreground"
                    >
                      {isFiltered
                        ? 'No reviews match these filters.'
                        : 'No reviews found.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  reviews.map((r) => (
                    <TableRow
                      key={r.id}
                      data-review-id={r.id}
                      className="hover:bg-muted/50"
                    >
                      <TableCell
                        className="text-sm font-medium tabular-nums text-warning"
                        aria-label={`${r.rating} out of 5`}
                      >
                        {renderStars(r.rating)}
                      </TableCell>
                      <TableCell className="max-w-[280px] text-sm">
                        <div className="truncate font-medium" title={r.title ?? undefined}>
                          {r.title ?? '—'}
                        </div>
                        {r.body && (
                          <div
                            className="mt-0.5 line-clamp-2 text-xs whitespace-normal text-muted-foreground"
                            title={r.body}
                          >
                            {r.body}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate text-sm">
                        {r.customerName ?? r.customerEmail ?? '—'}
                      </TableCell>
                      <TableCell
                        className="max-w-[150px] truncate text-sm"
                        title={r.experienceTitle}
                      >
                        {r.experienceTitle}
                      </TableCell>
                      <TableCell
                        className="max-w-[160px] truncate text-sm"
                        title={r.vendorBusinessName}
                      >
                        {r.vendorBusinessName}
                      </TableCell>
                      <TableCell>
                        <span data-testid="review-status-badge">
                          <AdminStatusBadge
                            status={r.status}
                            label={STATUS_LABELS[r.status] ?? r.status}
                          />
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">
                        {formatDate(r.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <ReviewActionsCell reviewId={r.id} status={r.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
