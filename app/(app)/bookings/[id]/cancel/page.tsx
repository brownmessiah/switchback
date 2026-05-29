import type { ReactElement } from 'react'

import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { loadBookingConfirmation } from '@/lib/bookings/confirmation-loader'

import { CancelForm } from './cancel-form'

/**
 * Customer cancel page (Task 14). Reachable from the "Cancel booking" link
 * on the confirmation page. The server component authenticates, loads the
 * Booking with the same ownership-scoped loader the confirmation page uses
 * (a Booking the caller does not own resolves to `notFound()`), and renders
 * the cancel-confirmation form. Only `confirmed` Bookings are cancellable;
 * any other state renders an informational notice instead of the form so
 * the customer is never shown a dead-end 404 for their own booking.
 */
export default async function CancelBookingPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<ReactElement> {
  const { id } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()

  const data = await loadBookingConfirmation(db, {
    bookingId: id,
    actorUserId: session.user.id,
  })
  if (!data) notFound()

  const isCancellable = data.state === 'confirmed'

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Cancel booking
        </h1>
        <p className="mt-2 text-muted-foreground">
          {data.experienceTitle}
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Booking summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Experience</span>
            <span className="font-medium">{data.experienceTitle}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Participants</span>
            <span>{data.participantCount}</span>
          </div>
          <Separator />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total paid</span>
            <span className="text-lg font-semibold">
              ₹{data.grossTotalRupees.toLocaleString('en-IN')}
            </span>
          </div>
        </CardContent>
      </Card>

      {isCancellable ? (
        <CancelForm bookingId={data.bookingId} cancellationPreset={data.cancellationPreset} />
      ) : (
        <div className="rounded-lg border bg-muted/30 p-6" data-testid="not-cancellable">
          <h2 className="text-lg font-semibold">This booking can&apos;t be cancelled</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Its current status is{' '}
            <span className="font-medium capitalize text-foreground">
              {data.state.replace(/_/g, ' ')}
            </span>
            . Only confirmed bookings can be cancelled from here.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Back to my bookings
          </Link>
        </div>
      )}
    </main>
  )
}
