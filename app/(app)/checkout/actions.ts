'use server'

import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'

import { db } from '@/db/client'
import { bookings } from '@/db/schema/bookings'
import { auth } from '@/lib/auth'
import { env } from '@/lib/env'
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
        | 'payment_failed'
        | 'unknown'
      message: string
    }

export async function executeStartCheckout(
  database: DBOrTx,
  input: StartCheckoutInput,
): Promise<StartCheckoutResult> {
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
