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
  /** Populated by getExperienceById (used for full-bracket restore). */
  pricePerPerson_3_5?: number
  pricePerPerson_6_plus?: number
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
        price_per_person_3_5: string
        price_per_person_6_plus: string
        vendor_user_id: string
      }[]
    >`
      SELECT id, slug, title, status,
             price_per_person_1_2, price_per_person_3_5, price_per_person_6_plus,
             vendor_user_id
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
      pricePerPerson_3_5: Math.floor(Number(row.price_per_person_3_5)),
      pricePerPerson_6_plus: Math.floor(Number(row.price_per_person_6_plus)),
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

// ---------------------------------------------------------------------------
// Availability — patterns, materialised slots, region closures (#18)
// ---------------------------------------------------------------------------

export interface AvailabilityPatternRow {
  id: string
  experienceId: string
  dayOfWeek: number
  startTime: string
  endTime: string
  capacity: number
  effectiveFrom: string | null
  effectiveUntil: string | null
}

/** Fetch all availability_patterns rows for an Experience (oldest first). */
export async function getAvailabilityPatterns(
  experienceId: string,
): Promise<AvailabilityPatternRow[]> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        id: string
        experience_id: string
        day_of_week: number
        start_time: string
        end_time: string
        capacity: number
        effective_from: string | null
        effective_until: string | null
      }[]
    >`
      SELECT id, experience_id, day_of_week, start_time, end_time,
             capacity, effective_from, effective_until
      FROM availability_patterns
      WHERE experience_id = ${experienceId}
      ORDER BY created_at ASC
    `
    return rows.map((r) => ({
      id: r.id,
      experienceId: r.experience_id,
      dayOfWeek: r.day_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      capacity: r.capacity,
      effectiveFrom: r.effective_from,
      effectiveUntil: r.effective_until,
    }))
  })
}

export interface AvailabilitySlotRow {
  id: string
  startAt: Date
  endAt: Date
  capacity: number
  capacityTaken: number
  status: string
}

/**
 * Fetch availability_slots for an Experience whose start_at lands on the
 * given UTC calendar date ("YYYY-MM-DD"). Used to assert per-day slot shape.
 */
export async function getSlotsForExperienceOnDate(
  experienceId: string,
  date: string,
): Promise<AvailabilitySlotRow[]> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        id: string
        start_at: Date
        end_at: Date
        capacity: number
        capacity_taken: number
        status: string
      }[]
    >`
      SELECT id, start_at, end_at, capacity, capacity_taken, status
      FROM availability_slots
      WHERE experience_id = ${experienceId}
        AND start_at >= ${`${date}T00:00:00.000Z`}::timestamptz
        AND start_at <  (${`${date}T00:00:00.000Z`}::timestamptz + interval '1 day')
      ORDER BY start_at ASC
    `
    return rows.map((r) => ({
      id: r.id,
      startAt: new Date(r.start_at),
      endAt: new Date(r.end_at),
      capacity: r.capacity,
      capacityTaken: r.capacity_taken,
      status: r.status,
    }))
  })
}

/** Count availability_slots for an Experience in a closed-open UTC date range. */
export async function countSlotsForExperienceInRange(
  experienceId: string,
  startDate: string,
  endDateExclusive: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n
      FROM availability_slots
      WHERE experience_id = ${experienceId}
        AND start_at >= ${`${startDate}T00:00:00.000Z`}::timestamptz
        AND start_at <  ${`${endDateExclusive}T00:00:00.000Z`}::timestamptz
    `
    return Number(rows[0]?.n ?? 0)
  })
}

/** Insert a region_closure row; returns its id. */
export async function insertRegionClosure(input: {
  regionSlug: string
  startAt: string
  endAt: string
  reason: string
  source: 'admin' | 'vendor'
}): Promise<string> {
  return withSql(async (sql) => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO region_closures (region_slug, start_at, end_at, reason, source)
      VALUES (${input.regionSlug}, ${input.startAt}::timestamptz,
              ${input.endAt}::timestamptz, ${input.reason}, ${input.source})
      RETURNING id
    `
    return rows[0].id
  })
}

/** Delete a region_closure row by id (test cleanup). */
export async function deleteRegionClosure(id: string): Promise<void> {
  await withSql(async (sql) => {
    await sql`DELETE FROM region_closures WHERE id = ${id}`
  })
}

/**
 * Reset an Experience's availability to a clean slate for a test:
 *  - delete all availability_patterns
 *  - delete availability_slots that are NOT referenced by a Booking
 *
 * Seed Bookings reference a slot (FK onDelete:'restrict'), so those slots
 * are deliberately preserved — deleting them would violate the FK and would
 * also corrupt the seeded booking dashboards used by other specs. The
 * availability tests anchor their assertions on the future 2026-07-xx window,
 * which is disjoint from the seeded T±7d booking slots, so the preserved rows
 * never interfere.
 */
export async function clearAvailabilityForExperience(
  experienceId: string,
): Promise<void> {
  await withSql(async (sql) => {
    await sql`DELETE FROM availability_patterns WHERE experience_id = ${experienceId}`
    await sql`
      DELETE FROM availability_slots
      WHERE experience_id = ${experienceId}
        AND id NOT IN (SELECT slot_id FROM bookings WHERE slot_id IS NOT NULL)
    `
  })
}

/** Fetch the region_slug of an Experience. */
export async function getExperienceRegionSlug(
  experienceId: string,
): Promise<string | null> {
  return withSql(async (sql) => {
    const rows = await sql<{ region_slug: string }[]>`
      SELECT region_slug FROM experiences WHERE id = ${experienceId} LIMIT 1
    `
    return rows[0]?.region_slug ?? null
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

// ---------------------------------------------------------------------------
// Vendor booking management assertions (Issue #19)
// ---------------------------------------------------------------------------

export interface VendorBookingRow {
  id: string
  state: string
  paymentMode: string
  grossRupees: number
  customerUserId: string
}

/**
 * Fetch the (single) Booking owned by `vendorUserId` on the Experience with
 * `slug` whose state matches `state`. The business-Vendor manageable
 * Bookings (#19) are seeded one-per-(state, slug), so this resolves them
 * deterministically without depending on table position.
 */
export async function getVendorBookingByStateAndSlug(
  vendorUserId: string,
  slug: string,
  state: string,
): Promise<VendorBookingRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        id: string
        state: string
        payment_mode: string
        gross_total_snapshot: string
        customer_user_id: string
      }[]
    >`
      SELECT b.id, b.state, b.payment_mode, b.gross_total_snapshot, b.customer_user_id
      FROM bookings b
      JOIN experiences e ON b.experience_id = e.id
      WHERE e.vendor_user_id = ${vendorUserId}
        AND e.slug = ${slug}
        AND b.state = ${state}
      ORDER BY b.created_at DESC
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      state: row.state,
      paymentMode: row.payment_mode,
      grossRupees: Math.floor(Number(row.gross_total_snapshot)),
      customerUserId: row.customer_user_id,
    }
  })
}

export interface BookingLifecycleRow {
  state: string
  completedAt: Date | null
  autoCompleted: boolean
  payoutState: string
  cancelledAt: Date | null
  cancellationReason: string | null
}

/** Fetch a booking's lifecycle columns (state machine + payout state). */
export async function getBookingLifecycle(
  bookingId: string,
): Promise<BookingLifecycleRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        state: string
        completed_at: Date | null
        auto_completed: boolean
        payout_state: string
        cancelled_at: Date | null
        cancellation_reason: string | null
      }[]
    >`
      SELECT state, completed_at, auto_completed, payout_state,
             cancelled_at, cancellation_reason
      FROM bookings
      WHERE id = ${bookingId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      state: row.state,
      completedAt: row.completed_at,
      autoCompleted: row.auto_completed,
      payoutState: row.payout_state,
      cancelledAt: row.cancelled_at,
      cancellationReason: row.cancellation_reason,
    }
  })
}

/** Fetch the Vendor's current Response-time SLA score as a number. */
export async function getVendorSlaScore(vendorUserId: string): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ response_time_sla_score: string }[]>`
      SELECT response_time_sla_score
      FROM vendor_profiles
      WHERE user_id = ${vendorUserId}
      LIMIT 1
    `
    return rows[0] ? Number(rows[0].response_time_sla_score) : NaN
  })
}

export interface PaymentTimelineRow {
  captureTrigger: string
  amountRupees: number
}

/** Fetch a booking's payment rows ordered by capture time (the timeline). */
export async function getPaymentsForBooking(
  bookingId: string,
): Promise<PaymentTimelineRow[]> {
  return withSql(async (sql) => {
    const rows = await sql<{ capture_trigger: string; amount: string }[]>`
      SELECT capture_trigger, amount
      FROM payments
      WHERE booking_id = ${bookingId}
      ORDER BY captured_at ASC
    `
    return rows.map((r) => ({
      captureTrigger: r.capture_trigger,
      amountRupees: Math.floor(Number(r.amount)),
    }))
  })
}

// ---------------------------------------------------------------------------
// #20 — vendor reviews / payouts / settings / messages helpers
// ---------------------------------------------------------------------------

export interface VendorReviewRow {
  id: string
  vendorResponse: string | null
  rating: number
}

/**
 * Fetch the (single) published Review owned by a Vendor that has NOT yet
 * received a vendor response. Used by the "respond once" E2E.
 */
export async function getVendorReviewAwaitingResponse(
  vendorUserId: string,
): Promise<VendorReviewRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { id: string; vendor_response: string | null; rating: number }[]
    >`
      SELECT id, vendor_response, rating
      FROM reviews
      WHERE vendor_user_id = ${vendorUserId}
        AND vendor_response IS NULL
        AND status = 'published'
      ORDER BY created_at ASC
      LIMIT 1
    `
    if (!rows[0]) return null
    return {
      id: rows[0].id,
      vendorResponse: rows[0].vendor_response,
      rating: rows[0].rating,
    }
  })
}

/** Fetch a Review's vendor_response + vendor_responded_at by review id. */
export async function getReviewResponse(
  reviewId: string,
): Promise<{ vendorResponse: string | null; respondedAt: Date | null } | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { vendor_response: string | null; vendor_responded_at: Date | null }[]
    >`
      SELECT vendor_response, vendor_responded_at
      FROM reviews
      WHERE id = ${reviewId}
      LIMIT 1
    `
    if (!rows[0]) return null
    return {
      vendorResponse: rows[0].vendor_response,
      respondedAt: rows[0].vendor_responded_at,
    }
  })
}

export interface VendorEarningBookingRow {
  grossRupees: number
  commissionRatePercent: string
  gstRateOnCommissionPercent: string
  tdsRupees: number
  tcsRupees: number
}

/**
 * Fetch every Payout-earning Booking for a Vendor (state in completed /
 * awaiting_completion) with the snapshot columns the payout breakdown reads.
 * The payouts E2E sums computeVendorNetPayout over these rows and asserts the
 * page's displayed totals match — robust to whatever Bookings the seed and
 * the #19 serial mutations leave in those states.
 */
export async function getVendorEarningBookings(
  vendorUserId: string,
): Promise<VendorEarningBookingRow[]> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        gross_total_snapshot: string
        commission_rate_snapshot: string
        gst_rate_on_commission_snapshot: string
        tds_amount_snapshot: string
        tcs_amount_snapshot: string
      }[]
    >`
      SELECT b.gross_total_snapshot,
             b.commission_rate_snapshot,
             b.gst_rate_on_commission_snapshot,
             b.tds_amount_snapshot,
             b.tcs_amount_snapshot
      FROM bookings b
      JOIN experiences e ON b.experience_id = e.id
      WHERE e.vendor_user_id = ${vendorUserId}
        AND b.state IN ('completed', 'awaiting_completion')
    `
    return rows.map((r) => ({
      grossRupees: Math.floor(Number(r.gross_total_snapshot)),
      commissionRatePercent: r.commission_rate_snapshot,
      gstRateOnCommissionPercent: r.gst_rate_on_commission_snapshot,
      tdsRupees: Math.floor(Number(r.tds_amount_snapshot)),
      tcsRupees: Math.floor(Number(r.tcs_amount_snapshot)),
    }))
  })
}

export interface VendorConversationRow {
  id: string
  subject: string
  messageCount: number
}

/** Fetch a Vendor's Conversation by subject + its message count. */
export async function getVendorConversationBySubject(
  vendorUserId: string,
  subject: string,
): Promise<VendorConversationRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { id: string; subject: string; message_count: string }[]
    >`
      SELECT c.id,
             c.subject,
             (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id)::text
               AS message_count
      FROM conversations c
      WHERE c.vendor_user_id = ${vendorUserId}
        AND c.subject = ${subject}
      LIMIT 1
    `
    if (!rows[0]) return null
    return {
      id: rows[0].id,
      subject: rows[0].subject,
      messageCount: Number(rows[0].message_count),
    }
  })
}

export interface VendorProfileSettingsRow {
  businessName: string
  slug: string
  about: string | null
  payoutMethod: string | null
  payoutDestination: Record<string, unknown> | null
  payoutDestinationChangedAt: Date | null
}

/** Fetch the editable business + payout settings for a Vendor. */
export async function getVendorProfileSettings(
  vendorUserId: string,
): Promise<VendorProfileSettingsRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        business_name: string
        slug: string
        about: string | null
        payout_method: string | null
        payout_destination: Record<string, unknown> | null
        payout_destination_changed_at: Date | null
      }[]
    >`
      SELECT business_name, slug, about, payout_method,
             payout_destination, payout_destination_changed_at
      FROM vendor_profiles
      WHERE user_id = ${vendorUserId}
      LIMIT 1
    `
    if (!rows[0]) return null
    return {
      businessName: rows[0].business_name,
      slug: rows[0].slug,
      about: rows[0].about,
      payoutMethod: rows[0].payout_method,
      payoutDestination: rows[0].payout_destination,
      payoutDestinationChangedAt: rows[0].payout_destination_changed_at,
    }
  })
}

// ---------------------------------------------------------------------------
// KYC tier-cap matrix (ADR-0007 / EPIC-K) E2E helpers (#21)
//
// These drive the full Tier-2 cap matrix FROM THE UI:
//  - publish path: insert an over-cap (capacity-9 / multi-day) slot so the
//    edit-publish guard (executeUpdateExperience) reads it and rejects.
//  - booking-create downgrade: flip a Vendor's tier to identity so the
//    booking-create re-check fires on a previously-published Experience,
//    then restore it.
// All writes are reverted by the test (delete the inserted slot; restore the
// original tier) so seed determinism for parallel specs is preserved.
// ---------------------------------------------------------------------------

/** Read a Vendor's current KYC tier (to restore it after a downgrade test). */
export async function getVendorKycTier(
  vendorUserId: string,
): Promise<string | null> {
  return withSql(async (sql) => {
    const rows = await sql<{ kyc_tier: string }[]>`
      SELECT kyc_tier FROM vendor_profiles WHERE user_id = ${vendorUserId} LIMIT 1
    `
    return rows[0]?.kyc_tier ?? null
  })
}

/**
 * Set a Vendor's KYC tier. Used to simulate the ADR-0007 downgrade so the
 * booking-create re-check can be exercised against a previously-published
 * Experience. The caller MUST restore the original tier (try/finally).
 */
export async function setVendorKycTier(
  vendorUserId: string,
  kycTier: 'phone' | 'identity' | 'business',
): Promise<void> {
  await withSql(async (sql) => {
    await sql`
      UPDATE vendor_profiles SET kyc_tier = ${kycTier}, updated_at = NOW()
      WHERE user_id = ${vendorUserId}
    `
  })
}

/** Read an Experience's is_combo flag (to assert it was NOT flipped). */
export async function getExperienceIsCombo(
  experienceId: string,
): Promise<boolean | null> {
  return withSql(async (sql) => {
    const rows = await sql<{ is_combo: boolean }[]>`
      SELECT is_combo FROM experiences WHERE id = ${experienceId} LIMIT 1
    `
    return rows[0]?.is_combo ?? null
  })
}

/**
 * Insert a one-off availability_slot for a tier-cap test and return its id.
 * `startAt`/`endAt` are ISO strings; `capacity` lets a test stage an over-cap
 * (capacity-9) or multi-day slot that the edit-publish guard then reads.
 */
export async function insertAvailabilitySlot(input: {
  experienceId: string
  startAt: string
  endAt: string
  capacity: number
}): Promise<string> {
  return withSql(async (sql) => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO availability_slots (experience_id, start_at, end_at, capacity)
      VALUES (
        ${input.experienceId},
        ${input.startAt}::timestamptz,
        ${input.endAt}::timestamptz,
        ${input.capacity}
      )
      RETURNING id
    `
    return rows[0].id
  })
}

/** Delete a test-inserted availability_slot by id (cleanup). */
export async function deleteAvailabilitySlot(slotId: string): Promise<void> {
  await withSql(async (sql) => {
    await sql`DELETE FROM availability_slots WHERE id = ${slotId}`
  })
}

/** Count bookings for a (slot, customer) pair — 0 proves a rejection persisted nothing. */
export async function countBookingsForSlotAndCustomer(
  slotId: string,
  customerUserId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n
      FROM bookings
      WHERE slot_id = ${slotId} AND customer_user_id = ${customerUserId}
    `
    return Number(rows[0]?.n ?? 0)
  })
}

/** Count booking.tier_cap_rejected audit rows for an Experience (ADR-0007 rejection trail). */
export async function countBookingTierCapRejectedAuditRows(
  experienceId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n
      FROM audit_logs
      WHERE action = 'booking.tier_cap_rejected'
        AND entity_type = 'experience'
        AND entity_id = ${experienceId}
    `
    return Number(rows[0]?.n ?? 0)
  })
}

// ---------------------------------------------------------------------------
// Admin vendor KYC + commission + suspend assertions (Issue #22)
//
// These drive the four privileged admin Server Actions FROM THE UI
// (executeKycApproval / executeKycRejection / executeCommissionRateUpdate /
// executeSuspendToggle) and assert the persisted vendor_profiles state plus
// the append-only audit_logs trail. The KYC approve test mutates a seed
// Vendor's tier (phone → identity); the commission + suspend tests revert
// their writes so seed determinism for parallel specs is preserved.
// ---------------------------------------------------------------------------

export interface AdminVendorStateRow {
  kycTier: string
  commissionRate: string
  suspended: boolean
}

/** Read a Vendor's admin-controlled state (tier, commission rate, suspension). */
export async function getAdminVendorState(
  vendorUserId: string,
): Promise<AdminVendorStateRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { kyc_tier: string; commission_rate: string; suspended: boolean }[]
    >`
      SELECT kyc_tier, commission_rate, suspended
      FROM vendor_profiles
      WHERE user_id = ${vendorUserId}
      LIMIT 1
    `
    if (!rows[0]) return null
    return {
      kycTier: rows[0].kyc_tier,
      commissionRate: rows[0].commission_rate,
      suspended: rows[0].suspended,
    }
  })
}

/** Set a Vendor's commission base rate directly (test setup / restore). */
export async function setVendorCommissionRate(
  vendorUserId: string,
  commissionRate: string,
): Promise<void> {
  await withSql(async (sql) => {
    await sql`
      UPDATE vendor_profiles SET commission_rate = ${commissionRate}, updated_at = NOW()
      WHERE user_id = ${vendorUserId}
    `
  })
}

/** Set a Vendor's suspended flag directly (test setup / restore). */
export async function setVendorSuspended(
  vendorUserId: string,
  suspended: boolean,
): Promise<void> {
  await withSql(async (sql) => {
    await sql`
      UPDATE vendor_profiles SET suspended = ${suspended}, updated_at = NOW()
      WHERE user_id = ${vendorUserId}
    `
  })
}

/**
 * Count audit_logs rows for a privileged admin action on a vendor_profile.
 * Used to assert each KYC / commission / suspend action wrote exactly one row.
 */
export async function countAdminVendorAuditRows(
  action: string,
  vendorUserId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'vendor_profile'
        AND entity_id = ${vendorUserId}
    `
    return Number(rows[0]?.n ?? 0)
  })
}

/**
 * Fetch the most-recent admin-action audit payload + actor for a vendor.
 * Lets the test assert the privileged action recorded its actor (the admin)
 * and the decision context (notes / reason / rate change) per ADR-0007.
 */
export async function getLatestAdminVendorAudit(
  action: string,
  vendorUserId: string,
): Promise<{ actorUserId: string | null; payload: Record<string, unknown> } | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { actor_user_id: string | null; payload: Record<string, unknown> }[]
    >`
      SELECT actor_user_id, payload
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'vendor_profile'
        AND entity_id = ${vendorUserId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!rows[0]) return null
    return { actorUserId: rows[0].actor_user_id, payload: rows[0].payload }
  })
}

// ---------------------------------------------------------------------------
// Admin Experience moderation assertions (Issue #23)
//
// These drive the four admin Experience-moderation Server Actions FROM THE UI
// (approve / reject / pause / archive) and assert the persisted experiences
// status, the Meilisearch index/deindex side-effect (via meili-assertions),
// and the append-only audit_logs trail. The mutating tests operate on
// dedicated pending_review / published seed Experiences that no other spec
// books or reviews, so seed determinism for parallel specs is preserved.
// ---------------------------------------------------------------------------

/** Read an Experience's current status, or null if it does not exist. */
export async function getExperienceStatus(
  experienceId: string,
): Promise<string | null> {
  return withSql(async (sql) => {
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM experiences WHERE id = ${experienceId} LIMIT 1
    `
    return rows[0]?.status ?? null
  })
}

/** Resolve a seeded Experience id by its slug, or null. */
export async function getExperienceIdBySlug(
  slug: string,
): Promise<string | null> {
  return withSql(async (sql) => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM experiences WHERE slug = ${slug} LIMIT 1
    `
    return rows[0]?.id ?? null
  })
}

/** Count audit_logs rows for an admin Experience-moderation action on an Experience. */
export async function countExperienceAuditRows(
  action: string,
  experienceId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'experience'
        AND entity_id = ${experienceId}
    `
    return Number(rows[0]?.n ?? 0)
  })
}

/**
 * Fetch the most-recent admin Experience-moderation audit payload + actor for
 * an Experience. Lets the test assert the action recorded its actor (the admin)
 * and the decision context (status transition / rejection reason).
 */
export async function getLatestExperienceAudit(
  action: string,
  experienceId: string,
): Promise<{ actorUserId: string | null; payload: Record<string, unknown> } | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { actor_user_id: string | null; payload: Record<string, unknown> }[]
    >`
      SELECT actor_user_id, payload
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'experience'
        AND entity_id = ${experienceId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!rows[0]) return null
    return { actorUserId: rows[0].actor_user_id, payload: rows[0].payload }
  })
}

/** Set an Experience's status directly (test setup / restore). */
export async function setExperienceStatus(
  experienceId: string,
  status: 'draft' | 'pending_review' | 'published' | 'paused' | 'archived',
): Promise<void> {
  await withSql(async (sql) => {
    await sql`
      UPDATE experiences SET status = ${status}, updated_at = NOW()
      WHERE id = ${experienceId}
    `
  })
}

// ---------------------------------------------------------------------------
// Admin refund-queue + payout-queue assertions (Issue #24)
//
// These drive the admin refund (executeApproveRefund / executeRejectRefund)
// and payout (executeApprovePayout / Hold / Reject) Server Actions FROM THE UI
// and assert the persisted refund_requests / bookings.payout_state /
// vendor_profiles.manual_payouts_remaining state plus the append-only
// audit_logs trail. The refund fixtures credit a DEDICATED customer's Refund
// balance; the payout fixtures exercise the ADR-0016 first-3-manual gate on a
// DEDICATED Identity-verified Vendor — both isolated from every other spec.
// ---------------------------------------------------------------------------

export interface PendingRefundFixtureRow {
  refundRequestId: string
  bookingId: string
  amountRupees: number
  customerUserId: string
}

/**
 * Fetch a Customer's PENDING refund_requests (oldest first). The #24 fixtures
 * seed two — one for the approve E2E, one for the reject E2E. Returning all of
 * them lets the test deterministically pick distinct targets.
 */
export async function getPendingRefundRequestsForCustomer(
  customerUserId: string,
): Promise<PendingRefundFixtureRow[]> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        id: string
        booking_id: string
        amount: string
        requested_by_user_id: string
      }[]
    >`
      SELECT id, booking_id, amount, requested_by_user_id
      FROM refund_requests
      WHERE requested_by_user_id = ${customerUserId}
        AND state = 'pending'
      ORDER BY created_at ASC
    `
    return rows.map((r) => ({
      refundRequestId: r.id,
      bookingId: r.booking_id,
      amountRupees: Math.floor(Number(r.amount)),
      customerUserId: r.requested_by_user_id,
    }))
  })
}

export interface RefundRequestStateRow {
  state: string
  notes: string | null
  amountRupees: number
  resolvedAt: Date | null
}

/** Read a refund_request's state / notes / resolved_at by id, or null. */
export async function getRefundRequestStateById(
  refundRequestId: string,
): Promise<RefundRequestStateRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { state: string; notes: string | null; amount: string; resolved_at: Date | null }[]
    >`
      SELECT state, notes, amount, resolved_at
      FROM refund_requests
      WHERE id = ${refundRequestId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      state: row.state,
      notes: row.notes,
      amountRupees: Math.floor(Number(row.amount)),
      resolvedAt: row.resolved_at,
    }
  })
}

/** Count audit_logs rows for an admin refund action on a refund_request. */
export async function countRefundAuditRows(
  action: string,
  refundRequestId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'refund_request'
        AND entity_id = ${refundRequestId}
    `
    return Number(rows[0]?.n ?? 0)
  })
}

/** Fetch the most-recent admin refund-action audit payload + actor, or null. */
export async function getLatestRefundAudit(
  action: string,
  refundRequestId: string,
): Promise<{ actorUserId: string | null; payload: Record<string, unknown> } | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { actor_user_id: string | null; payload: Record<string, unknown> }[]
    >`
      SELECT actor_user_id, payload
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'refund_request'
        AND entity_id = ${refundRequestId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!rows[0]) return null
    return { actorUserId: rows[0].actor_user_id, payload: rows[0].payload }
  })
}

export interface PendingPayoutBookingRow {
  bookingId: string
  payoutState: string
  startAt: Date
}

/**
 * Fetch a Vendor's completed Bookings that are in the admin payout queue
 * (payout_state pending/held), ordered by slot start_at so the #24 E2E picks
 * deterministic targets (slot[0] for approve, slot[1] for hold, etc.).
 */
export async function getPendingPayoutBookingsForVendor(
  vendorUserId: string,
): Promise<PendingPayoutBookingRow[]> {
  return withSql(async (sql) => {
    const rows = await sql<
      { id: string; payout_state: string; start_at: Date }[]
    >`
      SELECT b.id, b.payout_state, s.start_at
      FROM bookings b
      JOIN experiences e ON e.id = b.experience_id
      JOIN availability_slots s ON s.id = b.slot_id
      WHERE e.vendor_user_id = ${vendorUserId}
        AND b.state = 'completed'
        AND b.payout_state IN ('pending', 'held')
      ORDER BY s.start_at ASC
    `
    return rows.map((r) => ({
      bookingId: r.id,
      payoutState: r.payout_state,
      startAt: new Date(r.start_at),
    }))
  })
}

/** Read a Booking's current payout_state + rejection reason, or null. */
export async function getBookingPayoutState(
  bookingId: string,
): Promise<{ payoutState: string; payoutRejectionReason: string | null } | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { payout_state: string; payout_rejection_reason: string | null }[]
    >`
      SELECT payout_state, payout_rejection_reason
      FROM bookings
      WHERE id = ${bookingId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      payoutState: row.payout_state,
      payoutRejectionReason: row.payout_rejection_reason,
    }
  })
}

/** Read a Vendor's current manual_payouts_remaining count (the first-3 gate). */
export async function getVendorManualPayoutsRemaining(
  vendorUserId: string,
): Promise<number | null> {
  return withSql(async (sql) => {
    const rows = await sql<{ manual_payouts_remaining: number }[]>`
      SELECT manual_payouts_remaining
      FROM vendor_profiles
      WHERE user_id = ${vendorUserId}
      LIMIT 1
    `
    return rows[0]?.manual_payouts_remaining ?? null
  })
}

/** Count audit_logs rows for an admin payout action on a Booking. */
export async function countPayoutAuditRows(
  action: string,
  bookingId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'booking'
        AND entity_id = ${bookingId}
    `
    return Number(rows[0]?.n ?? 0)
  })
}

/** Fetch the most-recent admin payout-action audit payload + actor, or null. */
export async function getLatestPayoutAudit(
  action: string,
  bookingId: string,
): Promise<{ actorUserId: string | null; payload: Record<string, unknown> } | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { actor_user_id: string | null; payload: Record<string, unknown> }[]
    >`
      SELECT actor_user_id, payload
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'booking'
        AND entity_id = ${bookingId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!rows[0]) return null
    return { actorUserId: rows[0].actor_user_id, payload: rows[0].payload }
  })
}

// ---------------------------------------------------------------------------
// Admin dispute-resolution assertions (Issue #25)
//
// These drive the two admin dispute Server Actions FROM THE UI
// (resolveAsCompletedAction / resolveAsCancelledAction) and assert the
// persisted bookings.state + payout_state transitions per ADR-0003, the
// optional partial refund / full refund credited to the Customer's Refund
// balance, and the append-only audit_logs trail.
//
// Each resolution consumes its target disputed Booking (one-way state
// transition), so the spec stages TWO dedicated disputed-Booking fixtures
// in-test (insertDisputedBookingFixture) on a DEDICATED past slot owned by
// an existing seed customer, then removes the staged rows in a finally so
// seed determinism for parallel specs is preserved. The seed's own single
// disputed Booking (#19) is left untouched.
// ---------------------------------------------------------------------------

export interface DisputedBookingFixture {
  bookingId: string
  slotId: string
  customerUserId: string
  grossRupees: number
}

/**
 * Stage a `disputed` Booking on a fresh, dedicated availability_slot for the
 * given Experience, owned by `customerUserId`, with payout_state `held`
 * (mirroring how a real Dispute freezes the Payout timer per ADR-0003). The
 * slot start_at is pinned to a fixed UTC hour offset by `slotHourOffset` so
 * two staged fixtures never collide on the (experience_id, start_at) unique
 * pair. Returns the ids + gross so the test can target the row and assert the
 * refund amount. Caller MUST remove it with deleteDisputedBookingFixture in a
 * finally.
 */
export async function insertDisputedBookingFixture(input: {
  experienceId: string
  customerUserId: string
  grossRupees: number
  participantCount: number
  /** Unique UTC hour (e.g. 11, 13) so staged slots never collide. */
  slotHourUtc: number
}): Promise<DisputedBookingFixture> {
  return withSql(async (sql) => {
    // A deterministic PAST slot (5 days ago) at the caller's unique UTC hour —
    // disjoint from the 02:00/04:00/06:00-UTC seed slots and the July-2026
    // availability window, so it never clobbers another spec's fixtures.
    const start = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    start.setUTCHours(input.slotHourUtc, 0, 0, 0)
    const startIso = start.toISOString()
    const endIso = new Date(start.getTime() + 4 * 60 * 60 * 1000).toISOString()

    const [slot] = await sql<{ id: string }[]>`
      INSERT INTO availability_slots
        (experience_id, start_at, end_at, capacity, capacity_taken)
      VALUES (${input.experienceId}, ${startIso}::timestamptz,
              ${endIso}::timestamptz, 8, ${input.participantCount})
      RETURNING id
    `

    const pricePerParticipant = Math.floor(input.grossRupees / input.participantCount)

    const [booking] = await sql<{ id: string }[]>`
      INSERT INTO bookings (
        customer_user_id, experience_id, slot_id, participant_count,
        state, payment_mode, gross_total_snapshot,
        price_per_participant_snapshot, pricing_basis_snapshot,
        commission_rate_snapshot, commission_basis_snapshot,
        cancellation_preset_snapshot, vendor_pan_snapshot,
        vendor_is_resident_snapshot, payout_method_snapshot,
        payout_destination_snapshot, payout_state, confirmed_at
      )
      VALUES (
        ${input.customerUserId}, ${input.experienceId}, ${slot.id},
        ${input.participantCount}, 'disputed', 'full_upfront',
        ${String(input.grossRupees)}, ${String(pricePerParticipant)},
        'base_price', '20.00', 'platform_default', 'flexible',
        'GHIJK5678L', true, 'bank_account',
        ${sql.json({ accountHolder: 'E2E Dispute Vendor', ifsc: 'HDFC0000123', accountNumber: '1234567890' })},
        'held', NOW() - interval '6 days'
      )
      RETURNING id
    `

    return {
      bookingId: booking.id,
      slotId: slot.id,
      customerUserId: input.customerUserId,
      grossRupees: input.grossRupees,
    }
  })
}

/**
 * Remove a staged disputed-Booking fixture (its refund_requests, then the
 * booking, then the slot) so the in-test fixture leaves no residue. Order
 * respects the ON DELETE RESTRICT FKs (refund_requests → booking → slot).
 */
export async function deleteDisputedBookingFixture(
  fixture: DisputedBookingFixture,
): Promise<void> {
  await withSql(async (sql) => {
    await sql`DELETE FROM payments WHERE booking_id = ${fixture.bookingId}`
    await sql`DELETE FROM refund_requests WHERE booking_id = ${fixture.bookingId}`
    await sql`DELETE FROM bookings WHERE id = ${fixture.bookingId}`
    await sql`DELETE FROM availability_slots WHERE id = ${fixture.slotId}`
  })
}

/**
 * Fetch the most-recent dispute-resolution audit payload + actor for a
 * Booking. `action` is `booking.dispute_resolved_complete` or
 * `booking.dispute_resolved_cancel` (admin-dispute-actions.ts).
 */
export async function getLatestDisputeAudit(
  action: string,
  bookingId: string,
): Promise<{ actorUserId: string | null; payload: Record<string, unknown> } | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { actor_user_id: string | null; payload: Record<string, unknown> }[]
    >`
      SELECT actor_user_id, payload
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'booking'
        AND entity_id = ${bookingId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!rows[0]) return null
    return { actorUserId: rows[0].actor_user_id, payload: rows[0].payload }
  })
}

/** Count dispute-resolution audit rows for a Booking (proves exactly one). */
export async function countDisputeAuditRows(
  action: string,
  bookingId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'booking'
        AND entity_id = ${bookingId}
    `
    return Number(rows[0]?.n ?? 0)
  })
}

// ---------------------------------------------------------------------------
// Admin region-closure assertions (Issue #25, ADR-0011)
//
// These drive the two admin region-closure Server Actions FROM THE UI
// (createClosureAction / deleteClosureAction) and assert the persisted
// region_closures row + the inline customer-facing block (the slot
// materialiser skips closed dates; the Experience detail page surfaces the
// closure and disables Book-now per ADR-0011) + the audit_logs trail. The
// closure targets a region whose closure no OTHER admin test asserts, and is
// deleted via the UI so it leaves no residue.
// ---------------------------------------------------------------------------

export interface RegionClosureRow {
  id: string
  regionSlug: string
  reason: string
  source: string
}

/**
 * Fetch the most-recently-created region_closure for a region whose reason
 * matches `reason` (the test stamps a unique reason so it resolves its own
 * UI-created row deterministically), or null.
 */
export async function getRegionClosureByReason(
  regionSlug: string,
  reason: string,
): Promise<RegionClosureRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { id: string; region_slug: string; reason: string; source: string }[]
    >`
      SELECT id, region_slug, reason, source
      FROM region_closures
      WHERE region_slug = ${regionSlug}
        AND reason = ${reason}
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!rows[0]) return null
    return {
      id: rows[0].id,
      regionSlug: rows[0].region_slug,
      reason: rows[0].reason,
      source: rows[0].source,
    }
  })
}

/** Read a region_closure by id, or null if it does not exist (proves delete). */
export async function getRegionClosureById(
  id: string,
): Promise<RegionClosureRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { id: string; region_slug: string; reason: string; source: string }[]
    >`
      SELECT id, region_slug, reason, source
      FROM region_closures
      WHERE id = ${id}
      LIMIT 1
    `
    if (!rows[0]) return null
    return {
      id: rows[0].id,
      regionSlug: rows[0].region_slug,
      reason: rows[0].reason,
      source: rows[0].source,
    }
  })
}

/** Fetch the most-recent admin region-closure audit payload + actor, or null. */
export async function getLatestClosureAudit(
  action: string,
  closureId: string,
): Promise<{ actorUserId: string | null; payload: Record<string, unknown> } | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { actor_user_id: string | null; payload: Record<string, unknown> }[]
    >`
      SELECT actor_user_id, payload
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'region_closure'
        AND entity_id = ${closureId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!rows[0]) return null
    return { actorUserId: rows[0].actor_user_id, payload: rows[0].payload }
  })
}

/** Resolve a published Experience's slug + region by slug (for the closure test). */
export async function getExperienceSlugRegion(
  slug: string,
): Promise<{ id: string; regionSlug: string } | null> {
  return withSql(async (sql) => {
    const rows = await sql<{ id: string; region_slug: string }[]>`
      SELECT id, region_slug FROM experiences WHERE slug = ${slug} LIMIT 1
    `
    if (!rows[0]) return null
    return { id: rows[0].id, regionSlug: rows[0].region_slug }
  })
}

/**
 * Read the commission_rate_snapshot of the earliest existing Booking owned by
 * a Vendor (joined through experiences). Used to prove ADR-0008 snapshot
 * immutability: changing the Vendor's base rate must NOT alter an existing
 * Booking's locked commission snapshot.
 */
export async function getEarliestBookingCommissionSnapshotForVendor(
  vendorUserId: string,
): Promise<{ bookingId: string; commissionRateSnapshot: string } | null> {
  return withSql(async (sql) => {
    const rows = await sql<{ id: string; commission_rate_snapshot: string }[]>`
      SELECT b.id, b.commission_rate_snapshot
      FROM bookings b
      JOIN experiences e ON e.id = b.experience_id
      WHERE e.vendor_user_id = ${vendorUserId}
      ORDER BY b.created_at ASC
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return { bookingId: row.id, commissionRateSnapshot: row.commission_rate_snapshot }
  })
}

// ---------------------------------------------------------------------------
// Admin commission-tier CRUD + promo CRUD + loyalty-grant assertions (#26)
//
// These drive the commission-tier CRUD (executeCreate/Update/Delete +
// getAffectedBookingCount), promo CRUD (create/toggle/delete), and the manual
// loyalty grant (adminGrantCredit) FROM THE UI and assert the persisted
// commission_tiers / promo_codes / wallet rows plus the append-only audit
// trail. Per ADR-0008 a Festival tier is time-windowed + scoped; per ADR-0004
// an Outvers-credit grant lands in the closed-loop bucket WITH an expiry,
// distinct from the cashable Refund balance.
// ---------------------------------------------------------------------------

export interface CommissionTierRow {
  id: string
  name: string
  startAt: Date
  endAt: Date
  rateOverride: string
  reason: string
  appliesToCategories: string[]
  appliesToVendorIds: string[]
  appliesToExperienceIds: string[]
}

/** Fetch the most-recently-created commission_tier whose name matches, or null. */
export async function getCommissionTierByName(
  name: string,
): Promise<CommissionTierRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        id: string
        name: string
        start_at: Date
        end_at: Date
        rate_override: string
        reason: string
        applies_to_categories: string[]
        applies_to_vendor_ids: string[]
        applies_to_experience_ids: string[]
      }[]
    >`
      SELECT id, name, start_at, end_at, rate_override, reason,
             applies_to_categories, applies_to_vendor_ids, applies_to_experience_ids
      FROM commission_tiers
      WHERE name = ${name}
      ORDER BY created_at DESC
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      name: row.name,
      startAt: new Date(row.start_at),
      endAt: new Date(row.end_at),
      rateOverride: row.rate_override,
      reason: row.reason,
      appliesToCategories: row.applies_to_categories,
      appliesToVendorIds: row.applies_to_vendor_ids,
      appliesToExperienceIds: row.applies_to_experience_ids,
    }
  })
}

/** Read a commission_tier by id, or null (proves a delete persisted). */
export async function getCommissionTierById(
  id: string,
): Promise<CommissionTierRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        id: string
        name: string
        start_at: Date
        end_at: Date
        rate_override: string
        reason: string
        applies_to_categories: string[]
        applies_to_vendor_ids: string[]
        applies_to_experience_ids: string[]
      }[]
    >`
      SELECT id, name, start_at, end_at, rate_override, reason,
             applies_to_categories, applies_to_vendor_ids, applies_to_experience_ids
      FROM commission_tiers
      WHERE id = ${id}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      name: row.name,
      startAt: new Date(row.start_at),
      endAt: new Date(row.end_at),
      rateOverride: row.rate_override,
      reason: row.reason,
      appliesToCategories: row.applies_to_categories,
      appliesToVendorIds: row.applies_to_vendor_ids,
      appliesToExperienceIds: row.applies_to_experience_ids,
    }
  })
}

/** Delete a commission_tier by id (test cleanup / restore). */
export async function deleteCommissionTierById(id: string): Promise<void> {
  await withSql(async (sql) => {
    await sql`DELETE FROM commission_tiers WHERE id = ${id}`
  })
}

/**
 * Count Bookings whose created_at falls inside [startAt, endAt] AND whose
 * Experience matches the given scope (here: a single Experience id). Mirrors
 * the scope-filtered getAffectedBookingCount predicate (ADR-0008, #34 fix) so
 * the E2E can assert the UI-surfaced count against the live DB independently.
 */
export async function countBookingsInWindowForExperience(
  experienceId: string,
  startAt: Date,
  endAt: Date,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n
      FROM bookings
      WHERE experience_id = ${experienceId}
        AND created_at >= ${startAt.toISOString()}::timestamptz
        AND created_at <= ${endAt.toISOString()}::timestamptz
    `
    return Number(rows[0]?.n ?? 0)
  })
}

/** Count audit_logs rows for a commission-tier action on a tier id. */
export async function countCommissionTierAuditRows(
  action: string,
  tierId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'commission_tier'
        AND entity_id = ${tierId}
    `
    return Number(rows[0]?.n ?? 0)
  })
}

/** Fetch the most-recent commission-tier audit payload + actor for a tier, or null. */
export async function getLatestCommissionTierAudit(
  action: string,
  tierId: string,
): Promise<{ actorUserId: string | null; payload: Record<string, unknown> } | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { actor_user_id: string | null; payload: Record<string, unknown> }[]
    >`
      SELECT actor_user_id, payload
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'commission_tier'
        AND entity_id = ${tierId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!rows[0]) return null
    return { actorUserId: rows[0].actor_user_id, payload: rows[0].payload }
  })
}

export interface PromoCodeRow {
  id: string
  code: string
  creditAmountRupees: number
  active: boolean
  expiresAt: Date | null
  maxTotalUses: number | null
  currentUses: number
}

/** Fetch a promo_code row by code (uppercased to mirror the action), or null. */
export async function getPromoCodeByCode(
  code: string,
): Promise<PromoCodeRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        id: string
        code: string
        credit_amount: string
        active: boolean
        expires_at: Date | null
        max_total_uses: number | null
        current_uses: number
      }[]
    >`
      SELECT id, code, credit_amount, active, expires_at, max_total_uses, current_uses
      FROM promo_codes
      WHERE code = ${code.toUpperCase()}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      code: row.code,
      creditAmountRupees: Math.floor(Number(row.credit_amount)),
      active: row.active,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      maxTotalUses: row.max_total_uses,
      currentUses: row.current_uses,
    }
  })
}

/** Read a promo_code by id, or null (proves a delete persisted). */
export async function getPromoCodeById(id: string): Promise<PromoCodeRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        id: string
        code: string
        credit_amount: string
        active: boolean
        expires_at: Date | null
        max_total_uses: number | null
        current_uses: number
      }[]
    >`
      SELECT id, code, credit_amount, active, expires_at, max_total_uses, current_uses
      FROM promo_codes
      WHERE id = ${id}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      code: row.code,
      creditAmountRupees: Math.floor(Number(row.credit_amount)),
      active: row.active,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      maxTotalUses: row.max_total_uses,
      currentUses: row.current_uses,
    }
  })
}

/** Delete a promo_code by id (test cleanup). */
export async function deletePromoCodeById(id: string): Promise<void> {
  await withSql(async (sql) => {
    await sql`DELETE FROM promo_codes WHERE id = ${id}`
  })
}

/** Count audit_logs rows for a promo-code action on a code (entity_id = code). */
export async function countPromoAuditRows(
  action: string,
  entityId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'promo_code'
        AND entity_id = ${entityId}
    `
    return Number(rows[0]?.n ?? 0)
  })
}

export interface WalletTransactionRow {
  id: string
  balanceType: string
  amountRupees: number
  source: string
  referenceId: string | null
  expiresAt: Date | null
  createdAt: Date
}

/**
 * Fetch a user's wallet_transactions of a given balance_type + source (newest
 * first). The #26 loyalty-grant E2E reads the admin-source outvers_credit /
 * refund_balance ledger rows to assert the grant landed in the RIGHT bucket
 * with the RIGHT expiry (ADR-0004).
 */
export async function getWalletTransactions(
  userId: string,
  balanceType: 'outvers_credit' | 'refund_balance',
  source?: string,
): Promise<WalletTransactionRow[]> {
  return withSql(async (sql) => {
    const rows = source
      ? await sql<
          {
            id: string
            balance_type: string
            amount: string
            source: string
            reference_id: string | null
            expires_at: Date | null
            created_at: Date
          }[]
        >`
          SELECT id, balance_type, amount, source, reference_id, expires_at, created_at
          FROM wallet_transactions
          WHERE user_id = ${userId}
            AND balance_type = ${balanceType}
            AND source = ${source}
          ORDER BY created_at DESC
        `
      : await sql<
          {
            id: string
            balance_type: string
            amount: string
            source: string
            reference_id: string | null
            expires_at: Date | null
            created_at: Date
          }[]
        >`
          SELECT id, balance_type, amount, source, reference_id, expires_at, created_at
          FROM wallet_transactions
          WHERE user_id = ${userId}
            AND balance_type = ${balanceType}
          ORDER BY created_at DESC
        `
    return rows.map((r) => ({
      id: r.id,
      balanceType: r.balance_type,
      amountRupees: Math.floor(Number(r.amount)),
      source: r.source,
      referenceId: r.reference_id,
      expiresAt: r.expires_at ? new Date(r.expires_at) : null,
      createdAt: new Date(r.created_at),
    }))
  })
}

/** Fetch the most-recent wallet.grant_credit audit payload + actor for a wallet_transaction id. */
export async function getWalletGrantAudit(
  walletTransactionId: string,
): Promise<{ actorUserId: string | null; payload: Record<string, unknown> } | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { actor_user_id: string | null; payload: Record<string, unknown> }[]
    >`
      SELECT actor_user_id, payload
      FROM audit_logs
      WHERE action = 'wallet.grant_credit'
        AND entity_type = 'wallet_transaction'
        AND entity_id = ${walletTransactionId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!rows[0]) return null
    return { actorUserId: rows[0].actor_user_id, payload: rows[0].payload }
  })
}

/** Delete a user's wallet rows (transactions + balances) — test cleanup/restore. */
export async function clearWalletForUser(userId: string): Promise<void> {
  await withSql(async (sql) => {
    await sql`DELETE FROM wallet_transactions WHERE user_id = ${userId}`
    await sql`DELETE FROM wallet_balances WHERE user_id = ${userId}`
  })
}

// ---------------------------------------------------------------------------
// Admin content management assertions (Issue #27)
//
// Review moderation (flag / remove / publish), Blog CRUD (+ cover image), and
// site-builder save/load. The review-moderation test drives a DEDICATED
// published Review on a dedicated Experience (no other spec asserts it) so the
// one-way flag→remove→publish transitions never disturb the seeded reviews the
// public Experience page renders for other specs.
// ---------------------------------------------------------------------------

/** Read a Review's current status by id, or null if it does not exist. */
export async function getReviewStatus(reviewId: string): Promise<string | null> {
  return withSql(async (sql) => {
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM reviews WHERE id = ${reviewId} LIMIT 1
    `
    return rows[0]?.status ?? null
  })
}

/**
 * Resolve the DEDICATED #27 review-moderation Review id + its Experience slug.
 * The Review sits on a dedicated Experience owned by the identity Vendor that
 * no other spec books or asserts. Returns null if the fixture is missing.
 */
export async function getModerationReviewFixture(): Promise<
  { reviewId: string; experienceId: string; experienceSlug: string } | null
> {
  return withSql(async (sql) => {
    const rows = await sql<
      { id: string; experience_id: string; slug: string }[]
    >`
      SELECT r.id, r.experience_id, e.slug
      FROM reviews r
      JOIN experiences e ON e.id = r.experience_id
      WHERE e.slug = 'review-moderation-fixture-rishikesh'
      ORDER BY r.created_at ASC
      LIMIT 1
    `
    if (!rows[0]) return null
    return {
      reviewId: rows[0].id,
      experienceId: rows[0].experience_id,
      experienceSlug: rows[0].slug,
    }
  })
}

/** Count published Reviews on an Experience (the public-catalog surface). */
export async function countPublishedReviewsForExperience(
  experienceId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n
      FROM reviews
      WHERE experience_id = ${experienceId}
        AND status = 'published'
    `
    return Number(rows[0]?.n ?? 0)
  })
}

/** Set a Review's status directly (test restore). */
export async function setReviewStatus(
  reviewId: string,
  status: 'pending' | 'published' | 'flagged' | 'removed',
): Promise<void> {
  await withSql(async (sql) => {
    await sql`UPDATE reviews SET status = ${status} WHERE id = ${reviewId}`
  })
}

/** Count audit_logs rows for an admin review-moderation action on a Review. */
export async function countReviewAuditRows(
  action: string,
  reviewId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'review'
        AND entity_id = ${reviewId}
    `
    return Number(rows[0]?.n ?? 0)
  })
}

/** Fetch the most-recent review-moderation audit payload + actor for a Review. */
export async function getLatestReviewAudit(
  action: string,
  reviewId: string,
): Promise<{ actorUserId: string | null; payload: Record<string, unknown> } | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { actor_user_id: string | null; payload: Record<string, unknown> }[]
    >`
      SELECT actor_user_id, payload
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'review'
        AND entity_id = ${reviewId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!rows[0]) return null
    return { actorUserId: rows[0].actor_user_id, payload: rows[0].payload }
  })
}

// ── Blog CRUD assertions (#27) ──────────────────────────────────────

export interface BlogPostRow {
  id: string
  title: string
  slug: string
  content: string
  excerpt: string | null
  category: string
  coverImageUrl: string | null
  status: string
  publishedAt: Date | null
}

/** Fetch a blog post by its (unique) title, or null. */
export async function getBlogPostByTitle(
  title: string,
): Promise<BlogPostRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        id: string
        title: string
        slug: string
        content: string
        excerpt: string | null
        category: string
        cover_image_url: string | null
        status: string
        published_at: Date | null
      }[]
    >`
      SELECT id, title, slug, content, excerpt, category, cover_image_url,
             status, published_at
      FROM blog_posts
      WHERE title = ${title}
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!rows[0]) return null
    return {
      id: rows[0].id,
      title: rows[0].title,
      slug: rows[0].slug,
      content: rows[0].content,
      excerpt: rows[0].excerpt,
      category: rows[0].category,
      coverImageUrl: rows[0].cover_image_url,
      status: rows[0].status,
      publishedAt: rows[0].published_at ? new Date(rows[0].published_at) : null,
    }
  })
}

/** Fetch a blog post by id, or null. */
export async function getBlogPostById(id: string): Promise<BlogPostRow | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        id: string
        title: string
        slug: string
        content: string
        excerpt: string | null
        category: string
        cover_image_url: string | null
        status: string
        published_at: Date | null
      }[]
    >`
      SELECT id, title, slug, content, excerpt, category, cover_image_url,
             status, published_at
      FROM blog_posts
      WHERE id = ${id}
      LIMIT 1
    `
    if (!rows[0]) return null
    return {
      id: rows[0].id,
      title: rows[0].title,
      slug: rows[0].slug,
      content: rows[0].content,
      excerpt: rows[0].excerpt,
      category: rows[0].category,
      coverImageUrl: rows[0].cover_image_url,
      status: rows[0].status,
      publishedAt: rows[0].published_at ? new Date(rows[0].published_at) : null,
    }
  })
}

/** Delete a blog post by id — test cleanup/restore. */
export async function deleteBlogPostById(id: string): Promise<void> {
  await withSql(async (sql) => {
    await sql`DELETE FROM blog_posts WHERE id = ${id}`
  })
}

/** Count audit_logs rows for an admin blog action on a blog_post id. */
export async function countBlogAuditRows(
  action: string,
  blogPostId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'blog_post'
        AND entity_id = ${blogPostId}
    `
    return Number(rows[0]?.n ?? 0)
  })
}

/** Fetch the media_assets row(s) for a cover-image storage key. */
export async function getMediaAssetByStorageKey(
  storageKey: string,
): Promise<
  { id: string; url: string; storageKey: string; entityType: string } | null
> {
  return withSql(async (sql) => {
    const rows = await sql<
      { id: string; url: string; storage_key: string; entity_type: string }[]
    >`
      SELECT id, url, storage_key, entity_type
      FROM media_assets
      WHERE storage_key = ${storageKey}
      LIMIT 1
    `
    if (!rows[0]) return null
    return {
      id: rows[0].id,
      url: rows[0].url,
      storageKey: rows[0].storage_key,
      entityType: rows[0].entity_type,
    }
  })
}

/** Count blog-entity media_assets rows whose URL matches a cover image URL. */
export async function getMediaAssetByUrl(
  url: string,
): Promise<{ id: string; storageKey: string; entityType: string } | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { id: string; storage_key: string; entity_type: string }[]
    >`
      SELECT id, storage_key, entity_type
      FROM media_assets
      WHERE url = ${url}
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!rows[0]) return null
    return {
      id: rows[0].id,
      storageKey: rows[0].storage_key,
      entityType: rows[0].entity_type,
    }
  })
}

// ── Site-builder save/load assertions (#27) ─────────────────────────

export interface SiteContentRowAssertion {
  id: string
  section: string
  key: string
  value: Record<string, unknown>
  locale: string
  version: number
  updatedByAdminId: string | null
}

/** Fetch a site_content row for (section, key, locale), or null. */
export async function getSiteContentRow(
  section: string,
  key: string,
  locale = 'en',
): Promise<SiteContentRowAssertion | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      {
        id: string
        section: string
        key: string
        value: Record<string, unknown>
        locale: string
        version: number
        updated_by_admin_id: string | null
      }[]
    >`
      SELECT id, section, key, value, locale, version, updated_by_admin_id
      FROM site_content
      WHERE section = ${section} AND key = ${key} AND locale = ${locale}
      LIMIT 1
    `
    if (!rows[0]) return null
    return {
      id: rows[0].id,
      section: rows[0].section,
      key: rows[0].key,
      value: rows[0].value,
      locale: rows[0].locale,
      version: rows[0].version,
      updatedByAdminId: rows[0].updated_by_admin_id,
    }
  })
}

/** Count audit_logs rows for a site_content action on a (section/key/locale) id. */
export async function countSiteContentAuditRows(
  action: string,
  entityId: string,
): Promise<number> {
  return withSql(async (sql) => {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n
      FROM audit_logs
      WHERE action = ${action}
        AND entity_type = 'site_content'
        AND entity_id = ${entityId}
    `
    return Number(rows[0]?.n ?? 0)
  })
}

/** Fetch the most-recent site_content audit payload + actor for an entity id. */
export async function getLatestSiteContentAudit(
  entityId: string,
): Promise<{ action: string; actorUserId: string | null; payload: Record<string, unknown> } | null> {
  return withSql(async (sql) => {
    const rows = await sql<
      { action: string; actor_user_id: string | null; payload: Record<string, unknown> }[]
    >`
      SELECT action, actor_user_id, payload
      FROM audit_logs
      WHERE entity_type = 'site_content'
        AND entity_id = ${entityId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!rows[0]) return null
    return {
      action: rows[0].action,
      actorUserId: rows[0].actor_user_id,
      payload: rows[0].payload,
    }
  })
}
