import { and, count, eq, inArray } from 'drizzle-orm'
import {
  Archive,
  CircleCheck,
  CircleDashed,
  Clock,
  PauseCircle,
} from 'lucide-react'
import { headers } from 'next/headers'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from '@/components/ui/responsive-table'
import { db } from '@/db/client'
import { experiences, mediaAssets } from '@/db/schema'
import { auth } from '@/lib/auth'
import { computeListingCompleteness } from '@/lib/vendor/listing-completeness'

import { CompletenessRing } from './completeness-ring'
import { ListingsControls } from './listings-controls'
import {
  LISTING_SORTS,
  LISTING_STATUS_FILTERS,
  type ListingSort,
  type ListingStatusFilter,
} from './listings-options'

/**
 * Status → semantic Badge variant + lucide icon + label. Status is conveyed by
 * an icon paired with color (DESIGN.md §1.3 / WCAG 1.4.1), never color alone.
 */
const STATUS_META: Record<
  string,
  {
    variant: 'success' | 'warning' | 'info' | 'secondary' | 'outline'
    Icon: typeof CircleCheck
    label: string
  }
> = {
  published: { variant: 'success', Icon: CircleCheck, label: 'Published' },
  draft: { variant: 'outline', Icon: CircleDashed, label: 'Draft' },
  pending_review: { variant: 'info', Icon: Clock, label: 'Pending review' },
  paused: { variant: 'warning', Icon: PauseCircle, label: 'Paused' },
  archived: { variant: 'secondary', Icon: Archive, label: 'Archived' },
}

/** Rank used by the "Status" sort (most actionable first). */
const STATUS_SORT_RANK: Record<string, number> = {
  draft: 0,
  pending_review: 1,
  published: 2,
  paused: 3,
  archived: 4,
}

const VALID_STATUS = new Set(LISTING_STATUS_FILTERS.map((f) => f.value))
const VALID_SORT = new Set(LISTING_SORTS.map((s) => s.value))

function parseStatus(raw: string | string[] | undefined): ListingStatusFilter {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value && VALID_STATUS.has(value as ListingStatusFilter)
    ? (value as ListingStatusFilter)
    : 'all'
}

function parseSort(raw: string | string[] | undefined): ListingSort {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value && VALID_SORT.has(value as ListingSort)
    ? (value as ListingSort)
    : 'created_desc'
}

interface VendorListingsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function VendorListingsPage({
  searchParams,
}: VendorListingsPageProps) {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  const params = await searchParams
  const statusFilter = parseStatus(params.status)
  const sort = parseSort(params.sort)

  // Read this Vendor's Experiences with every field the completeness scorer
  // and the A3 table need (extends the page's own read; no write path touched).
  const rows = await db
    .select({
      id: experiences.id,
      title: experiences.title,
      shortDescription: experiences.shortDescription,
      longDescription: experiences.longDescription,
      status: experiences.status,
      activitySlug: experiences.activitySlug,
      regionSlug: experiences.regionSlug,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      pricePerPerson_3_5: experiences.pricePerPerson_3_5,
      pricePerPerson_6_plus: experiences.pricePerPerson_6_plus,
      createdAt: experiences.createdAt,
    })
    .from(experiences)
    .where(eq(experiences.vendorUserId, userId))

  // Count media assets per Experience in one grouped query, then join in
  // memory — a listing with ≥1 photo counts the `imageCount` field as filled.
  const experienceIds = rows.map((r) => r.id)
  const imageCounts = new Map<string, number>()
  if (experienceIds.length > 0) {
    const counts = await db
      .select({
        entityId: mediaAssets.entityId,
        n: count(),
      })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.entityType, 'experience'),
          inArray(mediaAssets.entityId, experienceIds),
        ),
      )
      .groupBy(mediaAssets.entityId)
    for (const c of counts) {
      imageCounts.set(c.entityId, Number(c.n))
    }
  }

  // Decorate each row with its real completeness score.
  const decorated = rows.map((row) => ({
    ...row,
    completeness: computeListingCompleteness({
      title: row.title,
      shortDescription: row.shortDescription,
      longDescription: row.longDescription,
      pricePerPerson_1_2: row.pricePerPerson_1_2,
      pricePerPerson_3_5: row.pricePerPerson_3_5,
      pricePerPerson_6_plus: row.pricePerPerson_6_plus,
      activitySlug: row.activitySlug,
      regionSlug: row.regionSlug,
      imageCount: imageCounts.get(row.id) ?? 0,
    }),
  }))

  // Filter by status (server-side from searchParams).
  const filtered =
    statusFilter === 'all'
      ? decorated
      : decorated.filter((r) => r.status === statusFilter)

  // Sort (server-side from searchParams). Spread first to avoid mutating.
  const listings = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'created_asc':
        return a.createdAt.getTime() - b.createdAt.getTime()
      case 'title':
        return a.title.localeCompare(b.title)
      case 'completeness':
        return b.completeness.percent - a.completeness.percent
      case 'status':
        return (
          (STATUS_SORT_RANK[a.status] ?? 99) - (STATUS_SORT_RANK[b.status] ?? 99)
        )
      case 'created_desc':
      default:
        return b.createdAt.getTime() - a.createdAt.getTime()
    }
  })

  const totalCount = decorated.length

  type ListingRow = (typeof listings)[number]

  const columns: ResponsiveTableColumn<ListingRow>[] = [
    {
      key: 'title',
      header: 'Experience',
      primary: true,
      cell: (listing) => listing.title,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (listing) => {
        const meta = STATUS_META[listing.status] ?? STATUS_META.draft
        const StatusIcon = meta.Icon
        return (
          <Badge
            variant={meta.variant}
            className="text-xs"
            data-testid="listing-status"
          >
            <StatusIcon aria-hidden="true" />
            {meta.label}
          </Badge>
        )
      },
    },
    {
      key: 'taxonomy',
      header: 'Activity / Region',
      cell: (listing) => (
        <span
          className="text-sm text-muted-foreground"
          data-testid="listing-taxonomy"
        >
          {listing.activitySlug} · {listing.regionSlug}
        </span>
      ),
    },
    {
      key: 'price',
      header: 'From',
      align: 'right',
      cell: (listing) => (
        <span data-testid="listing-price">
          ₹
          {Math.floor(Number(listing.pricePerPerson_1_2)).toLocaleString(
            'en-IN',
          )}
        </span>
      ),
    },
    {
      key: 'completeness',
      header: 'Completeness',
      cell: (listing) => (
        <CompletenessRing
          percent={listing.completeness.percent}
          filled={listing.completeness.filled}
          total={listing.completeness.total}
        />
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Listings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalCount} experience{totalCount === 1 ? '' : 's'}
          </p>
        </div>
        <Link href="/vendor/listings/new" className={buttonVariants()}>
          Create listing
        </Link>
      </div>

      {totalCount === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-lg font-medium">No listings yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first experience listing to start accepting bookings.
            </p>
            <Link
              href="/vendor/listings/new"
              className={buttonVariants({ className: 'mt-4' })}
            >
              Create your first listing
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <ListingsControls status={statusFilter} sort={sort} />

          {listings.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-lg font-medium">No matching listings</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  No listings match the current filter. Clear the filter to see
                  all {totalCount} experience{totalCount === 1 ? '' : 's'}.
                </p>
                <Link
                  href="/vendor/listings"
                  className={buttonVariants({
                    variant: 'outline',
                    className: 'mt-4',
                  })}
                >
                  Clear filter
                </Link>
              </CardContent>
            </Card>
          ) : (
            <ResponsiveTable<ListingRow>
              columns={columns}
              rows={listings}
              getRowKey={(listing) => listing.id}
              rowHref={(listing) => `/vendor/listings/${listing.id}/edit`}
              rowProps={(listing) => ({
                'data-testid': 'listing-row',
                'data-listing-id': listing.id,
                'data-listing-status': listing.status,
              })}
              caption="Your experience listings with status, activity, region, starting price, and completeness."
            />
          )}
        </div>
      )}
    </div>
  )
}
