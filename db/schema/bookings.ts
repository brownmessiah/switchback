import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { availabilitySlots } from './availability-slots'
import { experiences } from './experiences'
import { users } from './users'
import { payoutMethodEnum } from './vendor-profiles'

/**
 * Payout processing state per ADR-0016. Tracks admin approval flow
 * for Vendor payouts. Only applies to completed Bookings.
 *
 *   pending     → default; awaiting payout processing
 *   approved    → admin-approved; ready for Razorpay X disbursement
 *   rejected    → admin-rejected with reason
 *   held        → dispute-paused; payout timer frozen
 */
export const payoutStateEnum = pgEnum('payout_state', [
  'pending',
  'approved',
  'rejected',
  'held',
])

/**
 * Booking state machine per ADR-0003.
 *
 *   confirmed                  (after payment success, before start_at)
 *     └─→ awaiting_completion  (at scheduled end_at)
 *           ├─→ completed      (Vendor mark_complete OR end_at + 24h auto)
 *           └─→ disputed       (Customer raises before completed)
 *                 ├─→ completed
 *                 └─→ cancelled_post_experience
 *
 * Plus inside-policy cancellations move to cancelled_by_customer and
 * Vendor-initiated cancellations move to cancelled_by_vendor (ADR-0005).
 */
export const bookingStateEnum = pgEnum('booking_state', [
  // Pre-confirmation: the Booking row exists but payment has not been captured
  // yet. Sanctioned target state for the "create pending → confirm on capture"
  // checkout flow (ADR-0003 revision 2026-06-01). Not payout/refund-eligible.
  'pending_payment',
  'confirmed',
  'awaiting_completion',
  'completed',
  'disputed',
  'cancelled_by_customer',
  'cancelled_by_vendor',
  'cancelled_post_experience',
  // Terminal: Vendor-attested customer no-show after the slot end (ADR-0003
  // revision 2026-06-01). No customer refund (vendor retains per policy);
  // no completion ⇒ excluded from the payout countdown.
  'no_show',
])

/**
 * Payment-mode enum on Bookings. Mirrors the Experience's
 * payment_modes_allowed enum, but on the row itself. RNPL is stored
 * here but rejected by the Server Action layer per ADR-0002.
 */
export const paymentModeBookingEnum = pgEnum('payment_mode_booking', [
  'full_upfront',
  'partial_pay',
  'reserve_now_pay_later',
])

/**
 * Money-path central table. Every row carries SNAPSHOTS — commission
 * rate, basis, cancellation preset, per-participant price, pricing
 * basis, TDS amount — all locked at create. The Booking-create
 * Server Action will write all of these in a single db.transaction.
 *
 * Snapshot rule (ADR-0008 / ADR-0011 / ADR-0016): once the row exists,
 * the snapshot columns MUST NOT be updated. Enforcement in M2 will be
 * an UPDATE trigger that raises an exception; for M1 we rely on the
 * Server Action layer and code review.
 *
 * FK semantics:
 *  - customer_user_id, experience_id, slot_id → ON DELETE RESTRICT.
 *    Live Bookings block deletion of their dependencies; admin must
 *    archive instead.
 *  - trip_group_id is nullable; Trip Groups never own Bookings (ADR-0009).
 */
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerUserId: text('customer_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    experienceId: uuid('experience_id')
      .references(() => experiences.id, { onDelete: 'restrict' })
      .notNull(),
    slotId: uuid('slot_id')
      .references(() => availabilitySlots.id, { onDelete: 'restrict' })
      .notNull(),
    participantCount: integer('participant_count').notNull(),
    state: bookingStateEnum('state').default('confirmed').notNull(),
    paymentMode: paymentModeBookingEnum('payment_mode').notNull(),

    // ===== Snapshots (LOCKED at create; never recomputed) =====
    grossTotalSnapshot: numeric('gross_total_snapshot', { precision: 14, scale: 2 }).notNull(),
    pricePerParticipantSnapshot: numeric('price_per_participant_snapshot', {
      precision: 12,
      scale: 2,
    }).notNull(),
    pricingBasisSnapshot: text('pricing_basis_snapshot').notNull(),
    commissionRateSnapshot: numeric('commission_rate_snapshot', { precision: 5, scale: 2 }).notNull(),
    commissionBasisSnapshot: text('commission_basis_snapshot').notNull(),
    cancellationPresetSnapshot: text('cancellation_preset_snapshot').notNull(),
    // ADR-0005 revision 2026-06-16 (issue #09): the Experience's reschedule
    // right, snapshotted at create. Locked like cancellation_preset_snapshot —
    // a later change to experiences.reschedule_allowed never alters this row.
    rescheduleAllowedSnapshot: boolean('reschedule_allowed_snapshot')
      .default(true)
      .notNull(),
    tdsAmountSnapshot: numeric('tds_amount_snapshot', { precision: 14, scale: 2 })
      .default('0.00')
      .notNull(),
    // ADR-0016 — GST rate on Outvers commission. Snapshotted so historical
    // payout math doesn't drift if the IGST rate changes (currently 18%).
    gstRateOnCommissionSnapshot: numeric('gst_rate_on_commission_snapshot', {
      precision: 5,
      scale: 2,
    })
      .default('18.00')
      .notNull(),
    // ADR-0016 — GST TCS under Section 52 (e-commerce operator). 0.5% on the
    // Vendor's net taxable supply value, collected per Booking and remitted
    // monthly via GSTR-8. Amount + rate snapshot at create so historical
    // payout math doesn't drift if the rate changes. Separate from and
    // additional to the commission GST above.
    tcsAmountSnapshot: numeric('tcs_amount_snapshot', { precision: 14, scale: 2 })
      .default('0.00')
      .notNull(),
    tcsRateSnapshot: numeric('tcs_rate_snapshot', { precision: 5, scale: 2 })
      .default('0.50')
      .notNull(),
    // ADR-0016 — TDS under Section 194-O only applies to resident-Indian
    // Vendors. PAN snapshot is required for quarterly Form 26Q (deductee
    // identification). Nullable to allow non-resident Vendor edge case.
    vendorPanSnapshot: text('vendor_pan_snapshot'),
    vendorIsResidentSnapshot: boolean('vendor_is_resident_snapshot')
      .default(true)
      .notNull(),
    // ADR-0016 — Snapshot the Vendor's Payout destination at Booking-create
    // so a T+7 Payout (M3) honours the destination as it was when the
    // Customer booked, not the current value. NULL when the Vendor hasn't
    // configured payouts yet (early-onboarding edge — the Booking is held
    // by the application layer until destination is provided). Both
    // columns must be NULL together or both non-NULL — see CHECK below.
    payoutMethodSnapshot: payoutMethodEnum('payout_method_snapshot'),
    payoutDestinationSnapshot: jsonb('payout_destination_snapshot'),

    // ADR-0016 — Payout processing state. Tracks the admin approval flow
    // for Vendor payouts. Only meaningful for completed Bookings. Defaults
    // to 'pending'; admin can approve/reject/hold.
    payoutState: payoutStateEnum('payout_state').default('pending').notNull(),
    payoutRejectionReason: text('payout_rejection_reason'),

    // Optional ref — set when the Customer chose to book from a TripGroup itinerary
    tripGroupId: uuid('trip_group_id'),

    // Lifecycle timestamps (ADR-0003)
    confirmedAt: timestamp('confirmed_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // Arrival timestamp set by the QR check-in flow (issue #06). This is a NEW
    // timestamp field, NOT a lifecycle state — `state` is UNCHANGED by check-in
    // (ADR-0003 untouched). Nullable: null until the customer is scanned in;
    // set once, never overwritten (idempotent re-scan). Completion still flows
    // exclusively through the existing mark-complete / auto-complete path.
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    // True if Completion was triggered by the end_at + 24h auto-transition
    // (per ADR-0003 — used for Vendor-attestation-laziness SLA tracking).
    autoCompleted: boolean('auto_completed').default(false).notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),

    ...timestamps,
  },
  (t) => [
    check('positive_participants', sql`${t.participantCount} > 0`),
    check('non_negative_gross', sql`${t.grossTotalSnapshot} >= 0`),
    check('non_negative_price_per_participant', sql`${t.pricePerParticipantSnapshot} >= 0`),
    check('commission_rate_in_range', sql`${t.commissionRateSnapshot} >= 0 AND ${t.commissionRateSnapshot} <= 100`),
    check(
      'gst_rate_in_range',
      sql`${t.gstRateOnCommissionSnapshot} >= 0 AND ${t.gstRateOnCommissionSnapshot} <= 100`,
    ),
    check('non_negative_tds', sql`${t.tdsAmountSnapshot} >= 0`),
    check('non_negative_tcs', sql`${t.tcsAmountSnapshot} >= 0`),
    check('tcs_rate_in_range', sql`${t.tcsRateSnapshot} >= 0 AND ${t.tcsRateSnapshot} <= 100`),
    // ADR-0016 — Payout snapshot consistency. Either both columns are NULL
    // (Vendor has not configured payouts yet — the Booking is held by the
    // application layer until destination is provided) or both are set.
    check(
      'payout_snapshot_consistency',
      sql`(${t.payoutMethodSnapshot} IS NULL AND ${t.payoutDestinationSnapshot} IS NULL)
       OR (${t.payoutMethodSnapshot} IS NOT NULL AND ${t.payoutDestinationSnapshot} IS NOT NULL)`,
    ),
    index('bookings_by_customer').on(t.customerUserId),
    index('bookings_by_experience').on(t.experienceId),
    index('bookings_by_slot').on(t.slotId),
    index('bookings_by_state').on(t.state),
    index('bookings_by_payout_state').on(t.payoutState),
  ],
)

export type Booking = typeof bookings.$inferSelect
export type NewBooking = typeof bookings.$inferInsert
