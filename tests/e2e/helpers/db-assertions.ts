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

// ---------------------------------------------------------------------------
// Cancel → refund flow assertions (Issue #14)
// ---------------------------------------------------------------------------

/** Resolve the booking id for a confirmed booking on the given experience slug. */
export async function getConfirmedBookingForExperienceSlug(
  slug: string,
): Promise<{ bookingId: string; grossRupees: number } | null> {
  return withSql(async (sql) => {
    const rows = await sql<{ id: string; gross_total_snapshot: string }[]>`
      SELECT b.id, b.gross_total_snapshot
      FROM bookings b
      JOIN experiences e ON e.id = b.experience_id
      WHERE e.slug = ${slug}
        AND b.state = 'confirmed'
      ORDER BY b.created_at ASC
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return { bookingId: row.id, grossRupees: Math.floor(Number(row.gross_total_snapshot)) }
  })
}

/** Fetch a user's wallet balance for a given bucket (refund_balance / outvers_credit). */
export async function getWalletBalanceRupees(
  userId: string,
  balanceType: 'refund_balance' | 'outvers_credit',
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ amount: string }[]>`
      SELECT amount
      FROM wallet_balances
      WHERE user_id = ${userId}
        AND balance_type = ${balanceType}
      LIMIT 1
    `
    return rows[0] ? Math.floor(Number(rows[0].amount)) : 0
  })
}

/** Fetch a booking's current state, or null if it does not exist. */
export async function getBookingState(bookingId: string): Promise<string | null> {
  return withSql(async (sql) => {
    const rows = await sql<{ state: string }[]>`
      SELECT state FROM bookings WHERE id = ${bookingId} LIMIT 1
    `
    return rows[0]?.state ?? null
  })
}

export interface RefundRequestRow {
  state: string
  destination: string
  reason: string
  amount: number
  policyWindowBasisSnapshot: string
}

/** Fetch the refund_requests row for a booking id (the credited refund), or null. */
export async function getRefundRequestForBooking(
  bookingId: string,
): Promise<RefundRequestRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        state: string
        destination: string
        reason: string
        amount: string
        policy_window_basis_snapshot: string
      }[]
    >`
      SELECT state, destination, reason, amount, policy_window_basis_snapshot
      FROM refund_requests
      WHERE booking_id = ${bookingId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      state: row.state,
      destination: row.destination,
      reason: row.reason,
      amount: Math.floor(Number(row.amount)),
      policyWindowBasisSnapshot: row.policy_window_basis_snapshot,
    }
  })
}

/** Count refund_requests rows for a booking id. */
export async function countRefundRequestsForBooking(
  bookingId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM refund_requests WHERE booking_id = ${bookingId}
    `
    return Number(rows[0]?.n ?? '0')
  })
}

/** Fetch the `dispute.opened` audit payload for a booking id, or null. */
export async function getDisputeOpenedAuditPayload(
  bookingId: string,
): Promise<Record<string, unknown> | null> {
  return withSql(async (sql) => {
    const rows = await sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload
      FROM audit_logs
      WHERE action = 'dispute.opened'
        AND entity_type = 'booking'
        AND entity_id = ${bookingId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    return rows[0]?.payload ?? null
  })
}

/**
 * Fetch the `wallet.credit_refund_balance` audit payload for a booking id.
 * This row is written immutably at credit time, so it is the race-free
 * proof that the refund landed in the Refund balance bucket (the live
 * wallet_balances row is shared across the seed customer's bookings and can
 * be moved by concurrent checkouts in other parallel specs).
 */
export async function getRefundBalanceCreditAuditForBooking(
  bookingId: string,
): Promise<{ amountRupees: number; userId: string; refundRequestId: string } | null> {
  return withSql(async (sql) => {
    const rows = await sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload
      FROM audit_logs
      WHERE action = 'wallet.credit_refund_balance'
        AND payload->>'bookingId' = ${bookingId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    const payload = rows[0]?.payload
    if (!payload) return null
    return {
      amountRupees: Math.floor(Number(payload.amountRupees)),
      userId: String(payload.userId),
      refundRequestId: String(payload.refundRequestId),
    }
  })
}

/**
 * Count `wallet.credit_outvers_credit` audit rows for a booking id. The
 * inside-policy refund must NEVER credit the Outvers (promo) bucket — this
 * proves the refund went to the cashable Refund balance, not promo credit.
 */
export async function countOutversCreditAuditForBooking(
  bookingId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n
      FROM audit_logs
      WHERE action = 'wallet.credit_outvers_credit'
        AND payload->>'bookingId' = ${bookingId}
    `
    return Number(rows[0]?.n ?? '0')
  })
}

/** Count `booking.cancel` audit rows for a booking id (the inside-policy path). */
export async function countBookingCancelAuditRows(
  bookingId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n
      FROM audit_logs
      WHERE action = 'booking.cancel'
        AND entity_type = 'booking'
        AND entity_id = ${bookingId}
    `
    return Number(rows[0]?.n ?? '0')
  })
}

// ---------------------------------------------------------------------------
// Vendor listing create / edit / images assertions (Issue #17)
// ---------------------------------------------------------------------------

export interface ExperienceRow {
  id: string
  slug: string
  title: string
  status: string
  pricePerPerson_1_2: number
  vendorUserId: string
}

/** Fetch a vendor's most-recently-created Experience whose title matches. */
export async function getExperienceByTitle(
  vendorUserId: string,
  title: string,
): Promise<ExperienceRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        id: string
        slug: string
        title: string
        status: string
        price_per_person_1_2: string
        vendor_user_id: string
      }[]
    >`
      SELECT id, slug, title, status, price_per_person_1_2, vendor_user_id
      FROM experiences
      WHERE vendor_user_id = ${vendorUserId}
        AND title = ${title}
      ORDER BY created_at DESC
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      status: row.status,
      pricePerPerson_1_2: Math.floor(Number(row.price_per_person_1_2)),
      vendorUserId: row.vendor_user_id,
    }
  })
}

/** Fetch an Experience by id (for reload / price-survives assertions). */
export async function getExperienceById(
  experienceId: string,
): Promise<ExperienceRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        id: string
        slug: string
        title: string
        status: string
        price_per_person_1_2: string
        vendor_user_id: string
      }[]
    >`
      SELECT id, slug, title, status, price_per_person_1_2, vendor_user_id
      FROM experiences
      WHERE id = ${experienceId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      status: row.status,
      pricePerPerson_1_2: Math.floor(Number(row.price_per_person_1_2)),
      vendorUserId: row.vendor_user_id,
    }
  })
}

/** Resolve a published Experience id + slug for a given vendor (for edit). */
export async function getPublishedExperienceForVendor(
  vendorUserId: string,
  slug: string,
): Promise<{ id: string; slug: string; pricePerPerson_1_2: number } | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { id: string; slug: string; price_per_person_1_2: string }[]
    >`
      SELECT id, slug, price_per_person_1_2
      FROM experiences
      WHERE vendor_user_id = ${vendorUserId}
        AND slug = ${slug}
        AND status = 'published'
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      slug: row.slug,
      pricePerPerson_1_2: Math.floor(Number(row.price_per_person_1_2)),
    }
  })
}

export interface MediaAssetRow {
  id: string
  storageKey: string
  url: string
  uploadedBy: string
}

/** Fetch media_assets rows for an Experience id. */
export async function getMediaAssetsForExperience(
  experienceId: string,
): Promise<MediaAssetRow[]> {
  return withSql(async (sql) => {
    const rows = await sql<
      { id: string; storage_key: string; url: string; uploaded_by: string }[]
    >`
      SELECT id, storage_key, url, uploaded_by
      FROM media_assets
      WHERE entity_type = 'experience'
        AND entity_id = ${experienceId}
      ORDER BY created_at ASC
    `
    return rows.map((r) => ({
      id: r.id,
      storageKey: r.storage_key,
      url: r.url,
      uploadedBy: r.uploaded_by,
    }))
  })
}
