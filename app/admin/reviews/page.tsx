import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
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

// ── Variant maps ───────────────────────────────────────────────────

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  published: 'default',
  pending: 'secondary',
  flagged: 'destructive',
  removed: 'outline',
}

// ── Helpers ─────────────────────────────────────────────────────────

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Review Moderation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {reviews.length} review{reviews.length === 1 ? '' : 's'}
          {Object.values(filters).some((v) => v !== undefined) ? ' (filtered)' : ''}
        </p>
      </div>

      <ReviewFilters currentFilters={filters} />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rating</TableHead>
                <TableHead>Review</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Experience</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Vendor Response</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    No reviews found.
                  </TableCell>
                </TableRow>
              ) : (
                reviews.map((r) => (
                  <TableRow key={r.id} data-review-id={r.id}>
                    <TableCell className="text-sm font-medium text-amber-500">
                      {renderStars(r.rating)}
                    </TableCell>
                    <TableCell className="text-sm max-w-[200px]">
                      <div className="truncate font-medium">{r.title ?? '—'}</div>
                      {r.body && (
                        <div className="truncate text-muted-foreground text-xs mt-0.5">
                          {r.body}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.customerName ?? r.customerEmail ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm max-w-[150px] truncate">
                      {r.experienceTitle}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.vendorBusinessName}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={STATUS_VARIANTS[r.status] ?? 'outline'}
                        className="capitalize text-xs"
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm max-w-[150px] truncate text-muted-foreground">
                      {r.vendorResponse ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(r.createdAt)}
                    </TableCell>
                    <TableCell>
                      <ReviewActionsCell
                        reviewId={r.id}
                        status={r.status}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
