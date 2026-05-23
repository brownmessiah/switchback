import type { ReactElement } from 'react'

import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

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
  if (!session?.user) {
    notFound()
  }

  const data = await loadBookingConfirmation(db, {
    bookingId: id,
    actorUserId: session.user.id,
  })

  if (!data) {
    notFound()
  }

  return (
    <main>
      <header>
        <h1>Booking Confirmed</h1>
        <p>Your booking for {data.experienceTitle} is {data.state}.</p>
      </header>

      <section aria-label="Booking summary">
        <h2>Summary</h2>
        <dl>
          <dt>Booking ID</dt>
          <dd>{data.bookingId}</dd>
          <dt>Experience</dt>
          <dd>
            <a href={`/experience/${data.experienceSlug}`}>
              {data.experienceTitle}
            </a>
          </dd>
          <dt>Vendor</dt>
          <dd>{data.vendorBusinessName}</dd>
          <dt>Participants</dt>
          <dd>{data.participantCount}</dd>
          <dt>Total</dt>
          <dd>₹{data.grossTotalRupees}</dd>
          <dt>Payment</dt>
          <dd>{data.paymentMode === 'partial_pay' ? 'Partial pay (25% now)' : 'Full upfront'}</dd>
        </dl>
      </section>

      <section aria-label="Cancellation policy">
        <h2>Cancellation Policy</h2>
        <p>
          This booking follows the <strong>{data.cancellationPreset}</strong>{' '}
          cancellation policy. Inside-policy cancellations credit your Outvers
          wallet within 24 hours.
        </p>
        <a href={`/bookings/${data.bookingId}/cancel`}>Cancel this booking</a>
      </section>
    </main>
  )
}
