'use server'

import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'

import { db } from '@/db/client'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { auth } from '@/lib/auth'
import { env } from '@/lib/env'
import {
  notifyBookingConfirmed,
  notifyBookingCreated,
  safeNotify,
} from '@/lib/notifications/booking-events'
import {
  BookingCreateError,
  createBooking,
  type BookingCreateInput,
} from '@/lib/payments/booking-create'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import {
  createOrder,
  RazorpayClientError,
} from '@/lib/payments/razorpay-client'
import {
  applyWalletToCheckout,
  type ApplyWalletToCheckoutResult,
} from '@/lib/payments/wallet'
import { assertCanBookForGroup } from '@/lib/trip-groups/booking-linkage'
import { TripGroupError } from '@/lib/trip-groups/errors'

export type StartCheckoutInput = BookingCreateInput

export type StartCheckoutResult =
  | {
      ok: true
      bookingId: string
      orderId: string | null
      amountRupees: number
      keyId: string
      walletApplied: ApplyWalletToCheckoutResult
    }
  | {
      ok: false
      error:
        | 'unauthenticated'
        | 'rnpl_deferred'
        | 'payment_mode_not_allowed'
        | 'permits_not_acknowledged'
        | 'slot_unavailable'
        | 'experience_not_found'
        | 'tier_cap_exceeded'
        | 'trip_group_ineligible'
        | 'payment_failed'
        | 'unknown'
      message: string
    }

/** RFC 4122 UUID — matches the slotId shape booking-create requires. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function executeStartCheckout(
  database: DBOrTx,
  input: StartCheckoutInput,
): Promise<StartCheckoutResult> {
  // Validate the required slot at the boundary so a missing/invalid slot
  // surfaces as a specific field error rather than a raw ZodError that
  // collapses into the generic "unexpected error" path (Issue #13).
  if (typeof input.slotId !== 'string' || !UUID_RE.test(input.slotId)) {
    return {
      ok: false,
      error: 'slot_unavailable',
      message: 'Please select an available date and slot before paying.',
    }
  }

  // Trip-group seat (ADR-0009): if this Booking is being tagged to a group,
  // the member must be an active member of a group that is open for booking and
  // the Experience must be in the group's locked itinerary. The group never
  // books on the member's behalf — createBooking still makes a normal,
  // per-member Booking; we only validate + carry the tag.
  if (input.tripGroupId) {
    try {
      await assertCanBookForGroup(database, {
        groupId: input.tripGroupId,
        userId: input.customerUserId,
        experienceId: input.experienceId,
      })
    } catch (err) {
      if (err instanceof TripGroupError) {
        return {
          ok: false,
          error: 'trip_group_ineligible',
          message: 'You cannot book this seat for that trip group.',
        }
      }
      throw err
    }
  }

  try {
    const bookingResult = await createBooking(database, input)

    const [bookingRow] = await database
      .select({ gross: bookings.grossTotalSnapshot })
      .from(bookings)
      .where(eq(bookings.id, bookingResult.bookingId))
      .limit(1)

    const grossRupees = Math.floor(Number(bookingRow?.gross ?? '0'))

    const walletResult = await applyWalletToCheckout(database, {
      userId: input.customerUserId,
      grossRupees,
      bookingId: bookingResult.bookingId,
    })

    const razorpayRemainder = walletResult.razorpayRemainderRupees

    let orderId: string | null = null
    if (razorpayRemainder > 0) {
      const order = await createOrder({
        amountRupees: razorpayRemainder,
        notes: {
          booking_id: bookingResult.bookingId,
          customer_user_id: input.customerUserId,
        },
      })
      orderId = order.orderId
    }

    // ── Fire-and-forget lifecycle notifications (post-create) ────────
    // These run AFTER the booking + wallet/order work above. They are
    // wrapped in safeNotify so a notification failure can NEVER turn a
    // successful booking into an error. The money path (createBooking /
    // applyWalletToCheckout / createOrder) is untouched.
    const [expRow] = await database
      .select({
        title: experiences.title,
        vendorUserId: experiences.vendorUserId,
      })
      .from(experiences)
      .where(eq(experiences.id, input.experienceId))
      .limit(1)

    if (expRow) {
      await safeNotify('booking_confirmed', () =>
        notifyBookingConfirmed(database, {
          bookingId: bookingResult.bookingId,
          experienceTitle: expRow.title,
          customerUserId: input.customerUserId,
        }),
      )
      await safeNotify('booking_created', () =>
        notifyBookingCreated(database, {
          bookingId: bookingResult.bookingId,
          experienceTitle: expRow.title,
          vendorUserId: expRow.vendorUserId,
        }),
      )
    }

    return {
      ok: true,
      bookingId: bookingResult.bookingId,
      orderId,
      amountRupees: razorpayRemainder,
      keyId: env.RAZORPAY_KEY_ID ?? '',
      walletApplied: walletResult,
    }
  } catch (err) {
    if (err instanceof BookingCreateError) {
      return mapBookingError(err)
    }
    if (err instanceof RazorpayClientError) {
      return {
        ok: false,
        error: 'payment_failed',
        message: 'Payment processing failed. Please try again.',
      }
    }
    return {
      ok: false,
      error: 'unknown',
      message: 'An unexpected error occurred.',
    }
  }
}

function mapBookingError(err: BookingCreateError): StartCheckoutResult & { ok: false } {
  const map: Record<string, StartCheckoutResult & { ok: false }> = {
    RNPL_DEFERRED_TO_V2: {
      ok: false,
      error: 'rnpl_deferred',
      message: 'Reserve-now-pay-later is not available yet.',
    },
    PAYMENT_MODE_NOT_ALLOWED: {
      ok: false,
      error: 'payment_mode_not_allowed',
      message: 'This payment mode is not available for this Experience.',
    },
    PERMITS_NOT_ACKNOWLEDGED: {
      ok: false,
      error: 'permits_not_acknowledged',
      message: 'You must acknowledge the required permits before booking.',
    },
    SLOT_CLOSED: {
      ok: false,
      error: 'slot_unavailable',
      message: 'This slot is no longer available.',
    },
    SLOT_SOLD_OUT: {
      ok: false,
      error: 'slot_unavailable',
      message: 'This slot is fully booked.',
    },
    INSUFFICIENT_CAPACITY: {
      ok: false,
      error: 'slot_unavailable',
      message: 'Not enough seats available for your group size.',
    },
    EXPERIENCE_NOT_FOUND: {
      ok: false,
      error: 'experience_not_found',
      message: 'Experience not found.',
    },
    VENDOR_NOT_FOUND: {
      ok: false,
      error: 'experience_not_found',
      message: 'Experience not found.',
    },
    TIER_CAP_EXCEEDED: {
      ok: false,
      error: 'tier_cap_exceeded',
      // err.message carries the ADR-0007 reason, which is already
      // user-facing — surface it instead of the generic fallback.
      message: err.message,
    },
  }
  return (
    map[err.code] ?? {
      ok: false,
      error: 'unknown',
      message: 'An unexpected error occurred.',
    }
  )
}

export async function startCheckoutAction(
  input: StartCheckoutInput,
): Promise<StartCheckoutResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return {
      ok: false,
      error: 'unauthenticated',
      message: 'Sign in to continue checkout.',
    }
  }

  return executeStartCheckout(db, {
    ...input,
    customerUserId: session.user.id,
  })
}
