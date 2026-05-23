import { and, eq } from 'drizzle-orm'

import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

export interface BookingConfirmationData {
  bookingId: string
  state: string
  experienceTitle: string
  experienceSlug: string
  grossTotalRupees: number
  participantCount: number
  cancellationPreset: string
  paymentMode: string
  vendorBusinessName: string
  vendorSlug: string
  slotStartAt: Date
}

export interface LoadBookingConfirmationArgs {
  bookingId: string
  actorUserId: string
}

export async function loadBookingConfirmation(
  db: DBOrTx,
  args: LoadBookingConfirmationArgs,
): Promise<BookingConfirmationData | null> {
  const [row] = await db
    .select({
      bookingId: bookings.id,
      state: bookings.state,
      grossTotalSnapshot: bookings.grossTotalSnapshot,
      participantCount: bookings.participantCount,
      cancellationPresetSnapshot: bookings.cancellationPresetSnapshot,
      paymentMode: bookings.paymentMode,
      customerUserId: bookings.customerUserId,
      experienceTitle: experiences.title,
      experienceSlug: experiences.slug,
      vendorBusinessName: vendorProfiles.businessName,
      vendorSlug: vendorProfiles.slug,
    })
    .from(bookings)
    .innerJoin(experiences, eq(experiences.id, bookings.experienceId))
    .innerJoin(vendorProfiles, eq(vendorProfiles.userId, experiences.vendorUserId))
    .where(
      and(
        eq(bookings.id, args.bookingId),
        eq(bookings.customerUserId, args.actorUserId),
      ),
    )
    .limit(1)

  if (!row) return null

  return {
    bookingId: row.bookingId,
    state: row.state,
    experienceTitle: row.experienceTitle,
    experienceSlug: row.experienceSlug,
    grossTotalRupees: Math.floor(Number(row.grossTotalSnapshot)),
    participantCount: row.participantCount,
    cancellationPreset: row.cancellationPresetSnapshot,
    paymentMode: row.paymentMode,
    vendorBusinessName: row.vendorBusinessName,
    vendorSlug: row.vendorSlug,
    slotStartAt: new Date(),
  }
}
