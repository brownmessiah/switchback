import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { AdminStatusBadge } from '@/app/admin/_components/admin-status-badge'
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from '@/components/ui/responsive-table'
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

  type ReviewRow = (typeof reviews)[number]

  const columns: ResponsiveTableColumn<ReviewRow>[] = [
    {
      key: 'review',
      header: 'Review',
      primary: true,
      cell: (r) => (
        <div>
          <div className="font-medium" title={r.title ?? undefined}>
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
        </div>
      ),
    },
    {
      key: 'rating',
      header: 'Rating',
      cell: (r) => (
        <span
          className="font-medium tabular-nums text-warning"
          aria-label={`${r.rating} out of 5`}
        >
          {renderStars(r.rating)}
        </span>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: (r) => r.customerName ?? r.customerEmail ?? '—',
    },
    {
      key: 'experience',
      header: 'Experience',
      cell: (r) => (
        <span className="block max-w-[200px] truncate" title={r.experienceTitle}>
          {r.experienceTitle}
        </span>
      ),
    },
    {
      key: 'vendor',
      header: 'Vendor',
      cell: (r) => (
        <span className="block max-w-[200px] truncate" title={r.vendorBusinessName}>
          {r.vendorBusinessName}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <span data-testid="review-status-badge">
          <AdminStatusBadge
            status={r.status}
            label={STATUS_LABELS[r.status] ?? r.status}
          />
        </span>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      cell: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(r.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (r) => <ReviewActionsCell reviewId={r.id} status={r.status} />,
    },
  ]

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

      <ResponsiveTable<ReviewRow>
        columns={columns}
        rows={reviews}
        getRowKey={(r) => r.id}
        rowProps={(r) => ({ 'data-review-id': r.id })}
        caption="Customer reviews with rating, status and moderation actions"
        empty={
          isFiltered ? 'No reviews match these filters.' : 'No reviews found.'
        }
      />
    </div>
  )
}
