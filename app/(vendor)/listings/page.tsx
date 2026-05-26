import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { db } from '@/db/client'
import { experiences } from '@/db/schema'
import { auth } from '@/lib/auth'

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  published: 'default',
  draft: 'outline',
  pending_review: 'secondary',
  paused: 'secondary',
  archived: 'outline',
}

export default async function VendorListingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  const listings = await db
    .select({
      id: experiences.id,
      slug: experiences.slug,
      title: experiences.title,
      status: experiences.status,
      activitySlug: experiences.activitySlug,
      regionSlug: experiences.regionSlug,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      createdAt: experiences.createdAt,
    })
    .from(experiences)
    .where(eq(experiences.vendorUserId, userId))
    .orderBy(experiences.createdAt)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Listings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {listings.length} experience{listings.length === 1 ? '' : 's'}
          </p>
        </div>
        <Link
          href="/vendor/listings/new"
          className={buttonVariants()}
        >
          Create listing
        </Link>
      </div>

      {listings.length === 0 ? (
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
        <div className="space-y-3">
          {listings.map((listing) => (
            <Link
              key={listing.id}
              href={`/vendor/listings/${listing.id}/edit`}
              className="block"
            >
              <Card className="transition hover:border-foreground/20 hover:shadow-sm">
                <CardContent className="flex items-center justify-between py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-medium">{listing.title}</h3>
                      <Badge
                        variant={STATUS_VARIANTS[listing.status] ?? 'outline'}
                        className="shrink-0 capitalize text-xs"
                      >
                        {listing.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {listing.activitySlug} · {listing.regionSlug} · From ₹
                      {Math.floor(Number(listing.pricePerPerson_1_2)).toLocaleString('en-IN')}
                    </p>
                  </div>
                  <span className="ml-4 text-sm text-muted-foreground">→</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
