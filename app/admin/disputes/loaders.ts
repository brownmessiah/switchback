import { desc, eq } from 'drizzle-orm'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type * as schema from '@/db/schema'
import {
  availabilitySlots,
  bookings,
  experiences,
  users,
  vendorProfiles,
} from '@/db/schema'

type DBOrTx = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

/**
 * Read-only loader for the admin Dispute queue (#93). Returns every disputed
 * Booking joined with its Customer / Vendor / Experience / slot, ordered by
 * confirmation date — the rows the split-view ledger renders. No mutation.
 */
export async function loadDisputedBookings(db: DBOrTx) {
  return db
    .select({
      id: bookings.id,
      state: bookings.state,
      participantCount: bookings.participantCount,
      grossTotalSnapshot: bookings.grossTotalSnapshot,
      commissionRateSnapshot: bookings.commissionRateSnapshot,
      paymentMode: bookings.paymentMode,
      payoutState: bookings.payoutState,
      confirmedAt: bookings.confirmedAt,
      customerName: users.name,
      customerEmail: users.email,
      experienceTitle: experiences.title,
      vendorBusinessName: vendorProfiles.businessName,
      slotStart: availabilitySlots.startAt,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(users, eq(bookings.customerUserId, users.id))
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .leftJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .where(eq(bookings.state, 'disputed'))
    .orderBy(desc(bookings.confirmedAt))
}
