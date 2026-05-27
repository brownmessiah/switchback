import type { DBOrTx } from '@/lib/payments/commission-resolver'

import { notify } from './notify'

/**
 * Booking event notification helpers.
 *
 * These functions are called from booking lifecycle Server Actions
 * (booking-create, cancel, mark-complete) to create notifications
 * for the relevant users. Each uses an eventId keyed on the booking ID
 * and event type so retries are idempotent.
 */

export interface BookingNotifyArgs {
  readonly bookingId: string
  readonly experienceTitle: string
}

/**
 * Notify the vendor that a new booking was created.
 */
export async function notifyBookingCreated(
  db: DBOrTx,
  args: BookingNotifyArgs & { readonly vendorUserId: string },
) {
  return notify(db, {
    userId: args.vendorUserId,
    type: 'booking_created',
    title: 'New booking received',
    body: `A customer booked "${args.experienceTitle}".`,
    link: `/vendor/bookings`,
    eventId: `booking_created:${args.bookingId}`,
  })
}

/**
 * Notify the customer that their booking was cancelled.
 */
export async function notifyBookingCancelled(
  db: DBOrTx,
  args: BookingNotifyArgs & { readonly customerUserId: string },
) {
  return notify(db, {
    userId: args.customerUserId,
    type: 'booking_cancelled',
    title: 'Booking cancelled',
    body: `Your booking for "${args.experienceTitle}" has been cancelled.`,
    link: `/bookings/${args.bookingId}`,
    eventId: `booking_cancelled:${args.bookingId}`,
  })
}

/**
 * Notify the customer that their booking was completed.
 */
export async function notifyBookingCompleted(
  db: DBOrTx,
  args: BookingNotifyArgs & { readonly customerUserId: string },
) {
  return notify(db, {
    userId: args.customerUserId,
    type: 'booking_completed',
    title: 'Trip completed!',
    body: `Your "${args.experienceTitle}" experience is now complete. Leave a review!`,
    link: `/bookings/${args.bookingId}`,
    eventId: `booking_completed:${args.bookingId}`,
  })
}
