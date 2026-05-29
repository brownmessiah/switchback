/**
 * Read-only DB query helpers for E2E assertions.
 *
 * The customer-checkout spec verifies the revenue-spine invariants
 * directly against the `outvers_e2e` database after a UI-driven checkout:
 * booking row created atomically, capacity decremented, Commission
 * snapshot locked, and a `booking.create` audit row written.
 *
 * Connects with the same `postgres` driver + `e2eDbUrl()` resolution used
 * by `auth-setup.ts`. Every call opens and closes a single-connection
 * pool so the helper is safe to call from parallel test workers.
 */

import postgres from 'postgres'

import { e2eDbUrl } from './config'

export interface BookingRow {
  id: string
  customerUserId: string
  experienceId: string
  slotId: string
  participantCount: number
  paymentMode: string
  state: string
  grossTotalSnapshot: string
  pricePerParticipantSnapshot: string
  commissionRateSnapshot: string
  commissionBasisSnapshot: string
}

export interface SlotCapacity {
  capacity: number
  capacityTaken: number
  status: string
}

async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(e2eDbUrl(), { max: 1 })
  try {
    return await fn(sql)
  } finally {
    await sql.end()
  }
}

/** Fetch the booking row by id, or null if none. */
export async function getBooking(bookingId: string): Promise<BookingRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        id: string
        customer_user_id: string
        experience_id: string
        slot_id: string
        participant_count: number
        payment_mode: string
        state: string
        gross_total_snapshot: string
        price_per_participant_snapshot: string
        commission_rate_snapshot: string
        commission_basis_snapshot: string
      }[]
    >`
      SELECT id, customer_user_id, experience_id, slot_id, participant_count,
             payment_mode, state, gross_total_snapshot,
             price_per_participant_snapshot, commission_rate_snapshot,
             commission_basis_snapshot
      FROM bookings
      WHERE id = ${bookingId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      customerUserId: row.customer_user_id,
      experienceId: row.experience_id,
      slotId: row.slot_id,
      participantCount: row.participant_count,
      paymentMode: row.payment_mode,
      state: row.state,
      grossTotalSnapshot: row.gross_total_snapshot,
      pricePerParticipantSnapshot: row.price_per_participant_snapshot,
      commissionRateSnapshot: row.commission_rate_snapshot,
      commissionBasisSnapshot: row.commission_basis_snapshot,
    }
  })
}

/** Fetch a slot's capacity columns by id. */
export async function getSlotCapacity(slotId: string): Promise<SlotCapacity | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { capacity: number; capacity_taken: number; status: string }[]
    >`
      SELECT capacity, capacity_taken, status
      FROM availability_slots
      WHERE id = ${slotId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      capacity: row.capacity,
      capacityTaken: row.capacity_taken,
      status: row.status,
    }
  })
}

/** Resolve the next open availability slot id for an experience slug. */
export async function getOpenSlotForExperienceSlug(
  slug: string,
): Promise<{ slotId: string; experienceId: string } | null> {
  return withSql(async (sql) => {
    const rows = await sql<{ slot_id: string; experience_id: string }[]>`
      SELECT s.id AS slot_id, s.experience_id AS experience_id
      FROM availability_slots s
      JOIN experiences e ON e.id = s.experience_id
      WHERE e.slug = ${slug}
        AND s.status = 'open'
        AND s.capacity_taken < s.capacity
      ORDER BY s.start_at ASC
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return { slotId: row.slot_id, experienceId: row.experience_id }
  })
}

/** Count `booking.create` audit rows for a booking id. */
export async function countBookingCreateAuditRows(
  bookingId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n
      FROM audit_logs
      WHERE action = 'booking.create'
        AND entity_type = 'booking'
        AND entity_id = ${bookingId}
    `
    return Number(rows[0]?.n ?? '0')
  })
}

/** Fetch the `booking.create` audit payload for a booking id, or null. */
export async function getBookingCreateAuditPayload(
  bookingId: string,
): Promise<Record<string, unknown> | null> {
  return withSql(async (sql) => {
    const rows = await sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload
      FROM audit_logs
      WHERE action = 'booking.create'
        AND entity_type = 'booking'
        AND entity_id = ${bookingId}
      LIMIT 1
    `
    return rows[0]?.payload ?? null
  })
}
