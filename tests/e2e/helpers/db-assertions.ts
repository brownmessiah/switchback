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
