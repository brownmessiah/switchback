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
 * Fire-and-forget wrapper for lifecycle notifications.
 *
 * The booking/cancel/refund/payout actions are the MONEY PATH. A
 * notification write must NEVER turn a successful booking/refund/payout
 * into a failure, so callers run their notify() call through this
 * wrapper AFTER the money transaction has committed. A thrown error is
 * caught + logged and swallowed — it never propagates into the action's
 * result.
 */
export async function safeNotify(
  label: string,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run()
  } catch (err) {
    // Swallow: a notification failure must not roll back or fail the
    // money-path action that already committed.
    console.error(`[notifications] ${label} failed`, err)
  }
}

/**
 * Notify the customer that their booking is confirmed.
 *
 * Reuses the `booking_created` notification type (no migration) — the
 * recipient (customer) and link (the confirmation page) distinguish it
 * from the vendor-facing `notifyBookingCreated`. A distinct eventId
 * (`booking_confirmed:<bookingId>`) keeps it idempotent and separate
 * from the vendor notification so both can coexist for one booking.
 */
export async function notifyBookingConfirmed(
  db: DBOrTx,
  args: BookingNotifyArgs & { readonly customerUserId: string },
) {
  return notify(db, {
    userId: args.customerUserId,
    type: 'booking_created',
    title: 'Booking confirmed',
    body: `Your booking for "${args.experienceTitle}" is confirmed.`,
    link: `/bookings/${args.bookingId}/confirmation`,
    eventId: `booking_confirmed:${args.bookingId}`,
  })
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

/**
 * Notify the customer that a refund was credited to their wallet.
 *
 * Reuses the `booking_cancelled` notification type (no migration) — a
 * refund credit is part of the cancellation lifecycle. The eventId is
 * keyed on the refund request so re-running the admin approval is
 * idempotent. Links to /wallet where the credited refund balance shows.
 */
export async function notifyRefundCredited(
  db: DBOrTx,
  args: {
    readonly refundRequestId: string
    readonly customerUserId: string
    readonly amountRupees: number
  },
) {
  return notify(db, {
    userId: args.customerUserId,
    type: 'booking_cancelled',
    title: 'Refund credited to your wallet',
    body: `₹${args.amountRupees} has been credited to your Outvers wallet.`,
    link: `/wallet`,
    eventId: `refund_credited:${args.refundRequestId}`,
  })
}

/**
 * Payout state transitions that produce a vendor notification.
 *
 * `approved` / `held` / `rejected` are the admin approval-flow transitions;
 * `paid` is the Razorpay X send confirmation (slice 06, ADR-0016 D4 — the
 * payout reached the Vendor's account). Slice 07 will add `failed` / `reversed`.
 */
export type PayoutNotifyState = 'approved' | 'held' | 'rejected' | 'paid'

const PAYOUT_STATE_COPY: Record<
  PayoutNotifyState,
  { readonly title: string; readonly body: string }
> = {
  approved: {
    title: 'Payout approved',
    body: 'A payout for one of your bookings has been approved.',
  },
  held: {
    title: 'Payout held',
    body: 'A payout for one of your bookings is on hold pending review.',
  },
  rejected: {
    title: 'Payout rejected',
    body: 'A payout for one of your bookings was rejected.',
  },
  paid: {
    title: 'Payout sent',
    body: 'A payout for your completed bookings has been sent to your account.',
  },
}

/**
 * Notify the vendor that a payout changed state (approved / held /
 * rejected). Reuses the `payout_processed` notification type (no
 * migration). A distinct eventId per (booking, state) ensures re-running
 * an admin action does not duplicate and that different transitions on
 * the same booking each notify once.
 */
export async function notifyPayoutStateChange(
  db: DBOrTx,
  args: {
    readonly bookingId: string
    readonly vendorUserId: string
    readonly state: PayoutNotifyState
  },
) {
  const copy = PAYOUT_STATE_COPY[args.state]
  return notify(db, {
    userId: args.vendorUserId,
    type: 'payout_processed',
    title: copy.title,
    body: copy.body,
    link: `/vendor/payouts`,
    eventId: `payout_${args.state}:${args.bookingId}`,
  })
}
