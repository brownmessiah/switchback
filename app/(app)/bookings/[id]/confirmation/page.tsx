import type { ReactElement } from 'react'

import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { loadBookingConfirmation } from '@/lib/bookings/confirmation-loader'

export default async function BookingConfirmationPage({
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

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      {/* Success indicator */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <svg
            className="h-8 w-8 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Booking confirmed
        </h1>
        <p className="mt-2 text-muted-foreground">
          Your booking for{' '}
          <Link
            href={`/en/experience/${data.experienceSlug}`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {data.experienceTitle}
          </Link>{' '}
          is <Badge variant="secondary" className="ml-1 capitalize">{data.state}</Badge>
        </p>
      </div>

      {/* Booking summary card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Booking summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Booking ID</span>
            <span className="font-mono text-xs">{data.bookingId.slice(0, 8)}...</span>
          </div>
          <Separator />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Experience</span>
            <span className="font-medium">{data.experienceTitle}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Vendor</span>
            <span>{data.vendorBusinessName}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Participants</span>
            <span>{data.participantCount}</span>
          </div>
          <Separator />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="text-lg font-semibold">
              ₹{data.grossTotalRupees.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Payment</span>
            <span>
              {data.paymentMode === 'partial_pay'
                ? 'Partial pay (25% now)'
                : 'Full upfront'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Cancellation policy */}
      <Card className="mb-8">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h2 className="mb-1 text-sm font-semibold">Cancellation policy</h2>
              <p className="text-sm text-muted-foreground">
                This booking follows the{' '}
                <span className="font-medium capitalize">{data.cancellationPreset}</span>{' '}
                policy. Inside-policy cancellations credit your Outvers wallet within 24
                hours.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href={`/bookings/${data.bookingId}/cancel`}
          className={buttonVariants({ variant: 'outline', className: 'flex-1' })}
        >
          Cancel booking
        </Link>
        <Link
          href="/"
          className={buttonVariants({ className: 'flex-1' })}
        >
          Browse more experiences
        </Link>
      </div>
    </main>
  )
}
