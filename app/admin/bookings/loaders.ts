import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type * as schema from '@/db/schema'
import {
  availabilitySlots,
  bookings,
  experiences,
  payments,
  refundRequests,
  users,
  vendorProfiles,
} from '@/db/schema'

type DBOrTx = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

// ── Filters ────────────────────────────────────────────────────────

export interface BookingListFilters {
  state?: string
  dateFrom?: string
  dateTo?: string
  vendorUserId?: string
  experienceId?: string
}

// ── List loader ────────────────────────────────────────────────────

export async function loadBookingsList(db: DBOrTx, filters: BookingListFilters = {}) {
  const conditions: SQL[] = []

  if (filters.state) {
    conditions.push(eq(bookings.state, filters.state as typeof bookings.state.enumValues[number]))
  }
  if (filters.dateFrom) {
    conditions.push(gte(bookings.confirmedAt, new Date(filters.dateFrom)))
  }
  if (filters.dateTo) {
    // Include the entire end-date day by pushing to end of day
    const endDate = new Date(filters.dateTo)
    endDate.setHours(23, 59, 59, 999)
    conditions.push(lte(bookings.confirmedAt, endDate))
  }
  if (filters.vendorUserId) {
    conditions.push(eq(experiences.vendorUserId, filters.vendorUserId))
  }
  if (filters.experienceId) {
    conditions.push(eq(bookings.experienceId, filters.experienceId))
  }

  const rows = await db
    .select({
      id: bookings.id,
      state: bookings.state,
      participantCount: bookings.participantCount,
      grossTotalSnapshot: bookings.grossTotalSnapshot,
      paymentMode: bookings.paymentMode,
      confirmedAt: bookings.confirmedAt,
      customerName: users.name,
      customerEmail: users.email,
      experienceTitle: experiences.title,
      vendorBusinessName: vendorProfiles.businessName,
      vendorUserId: experiences.vendorUserId,
      slotStart: availabilitySlots.startAt,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(users, eq(bookings.customerUserId, users.id))
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .leftJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(bookings.confirmedAt))

  return rows
}

// ── Detail loader ──────────────────────────────────────────────────

export async function loadBookingDetail(db: DBOrTx, bookingId: string) {
  const [booking] = await db
    .select({
      id: bookings.id,
      state: bookings.state,
      participantCount: bookings.participantCount,
      paymentMode: bookings.paymentMode,
      grossTotalSnapshot: bookings.grossTotalSnapshot,
      pricePerParticipantSnapshot: bookings.pricePerParticipantSnapshot,
      pricingBasisSnapshot: bookings.pricingBasisSnapshot,
      commissionRateSnapshot: bookings.commissionRateSnapshot,
      commissionBasisSnapshot: bookings.commissionBasisSnapshot,
      cancellationPresetSnapshot: bookings.cancellationPresetSnapshot,
      tdsAmountSnapshot: bookings.tdsAmountSnapshot,
      tcsAmountSnapshot: bookings.tcsAmountSnapshot,
      gstRateOnCommissionSnapshot: bookings.gstRateOnCommissionSnapshot,
      vendorPanSnapshot: bookings.vendorPanSnapshot,
      vendorIsResidentSnapshot: bookings.vendorIsResidentSnapshot,
      confirmedAt: bookings.confirmedAt,
      completedAt: bookings.completedAt,
      autoCompleted: bookings.autoCompleted,
      cancelledAt: bookings.cancelledAt,
      cancellationReason: bookings.cancellationReason,
      createdAt: bookings.createdAt,
      customerName: users.name,
      customerEmail: users.email,
      customerPhone: users.phoneNumber,
      experienceTitle: experiences.title,
      experienceSlug: experiences.slug,
      vendorBusinessName: vendorProfiles.businessName,
      vendorUserId: experiences.vendorUserId,
      slotStart: availabilitySlots.startAt,
      slotEnd: availabilitySlots.endAt,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(users, eq(bookings.customerUserId, users.id))
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .leftJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .where(eq(bookings.id, bookingId))
    .limit(1)

  if (!booking) return null

  const [paymentRows, refundRows] = await Promise.all([
    db
      .select({
        id: payments.id,
        amount: payments.amount,
        captureTrigger: payments.captureTrigger,
        capturedAt: payments.capturedAt,
        razorpayPaymentId: payments.razorpayPaymentId,
      })
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .orderBy(payments.capturedAt),
    db
      .select({
        id: refundRequests.id,
        reason: refundRequests.reason,
        state: refundRequests.state,
        amount: refundRequests.amount,
        destination: refundRequests.destination,
        cancellationPresetSnapshot: refundRequests.cancellationPresetSnapshot,
        policyWindowBasisSnapshot: refundRequests.policyWindowBasisSnapshot,
        notes: refundRequests.notes,
        resolvedAt: refundRequests.resolvedAt,
        createdAt: refundRequests.createdAt,
      })
      .from(refundRequests)
      .where(eq(refundRequests.bookingId, bookingId))
      .orderBy(refundRequests.createdAt),
  ])

  return { booking, payments: paymentRows, refunds: refundRows }
}

// ── Vendor + Experience lookups (for filter dropdowns) ─────────────

export async function loadVendorsForFilter(db: DBOrTx) {
  return db
    .select({
      userId: vendorProfiles.userId,
      businessName: vendorProfiles.businessName,
    })
    .from(vendorProfiles)
    .orderBy(vendorProfiles.businessName)
}

export async function loadExperiencesForFilter(db: DBOrTx) {
  return db
    .select({
      id: experiences.id,
      title: experiences.title,
    })
    .from(experiences)
    .orderBy(experiences.title)
}
