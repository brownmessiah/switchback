/**
 * Pure timeline-builder for the Vendor Booking-detail "Money-State Timeline"
 * rail (redesign #79, direction A "Money-State Timeline rail").
 *
 * It collapses the Booking lifecycle dates and the `payments` rows into ONE
 * chronological vertical rail:
 *
 *   Created → Confirmed → Advance captured → balance auto-captured at T-24h
 *           → Completed  (+ cancelled / disputed branches)
 *
 * Every node is driven from REAL data — the lifecycle timestamps and the
 * payment-capture events — so a Partial-pay Booking always renders both its
 * Advance (booking-create) and its T-24h balance capture, fixing the dead
 * "No payments recorded yet." empty state the as-is page showed.
 *
 * Pure over its inputs: no DB, no Next.js request infrastructure, so it is
 * unit-testable in isolation and the Server Component renders its output
 * directly. Money is integer rupees throughout (rupee precision — what
 * Razorpay round-trips and the GST / TDS / TCS filings carry).
 */

/** Semantic status mapped to a DESIGN.md §2.1 status role (color + icon). */
export type TimelineStatus = 'success' | 'warning' | 'info' | 'credit' | 'danger'

export interface TimelineNode {
  /** Stable identity for keys + `data-testid`; never localized. */
  key: string
  /** Human-readable node title (English-only on this surface). */
  label: string
  /** Short sub-line describing the event. */
  detail: string
  /** Event timestamp; drives chronological ordering. Null = scheduled/undated. */
  at: Date | null
  /** Money attached to this node (capture amount), integer rupees, or null. */
  amountRupees: number | null
  /** Semantic status role — paired with a lucide icon at the call site. */
  status: TimelineStatus
  /**
   * Canonical lifecycle phase rank (Created < Confirmed < payment captures <
   * terminal). The rail is the Booking's lifecycle, so the canonical order is
   * the primary sort key; the event timestamp is the tie-break that orders
   * multiple captures within the money phase. For well-formed Bookings
   * (created ≤ confirmed ≤ advance ≤ balance ≤ completed) phase rank and
   * chronology agree.
   */
  phase: number
}

/** Canonical phase ranks for the lifecycle rail. */
const PHASE_CREATED = 0
const PHASE_CONFIRMED = 1
const PHASE_PAYMENT = 2
const PHASE_TERMINAL = 3

export interface PaymentEvent {
  amountRupees: number
  captureTrigger:
    | 'booking_create'
    | 'auto_capture_t_minus_24h'
    | 'escrow_full_capture'
    | 'manual_admin'
    | 'refund_reverse'
  capturedAt: Date | null
}

export interface BookingTimelineArgs {
  state: string
  /**
   * Payment mode. Only 'partial_pay' splits into an Advance + T-24h balance;
   * anything else (full_upfront — and the schema-named-but-v1-unused
   * reserve_now_pay_later) renders the single booking-create capture as a
   * paid-in-full node. Accepts the full schema enum so callers need no cast.
   */
  paymentMode: string
  grossRupees: number
  createdAt: Date
  confirmedAt: Date | null
  completedAt: Date | null
  autoCompleted: boolean
  cancelledAt: Date | null
  payments: readonly PaymentEvent[]
}

const CANCELLED_STATES = new Set([
  'cancelled_by_customer',
  'cancelled_by_vendor',
  'cancelled_post_experience',
])

/**
 * Build the ordered Money-State timeline for a Booking.
 *
 * Ordering is by event timestamp (true chronology). Undated nodes (e.g. a
 * scheduled-but-not-yet-captured balance) sort after their dated siblings so
 * the rail still reads top-to-bottom as the Booking progresses.
 */
export function buildBookingTimeline(args: BookingTimelineArgs): TimelineNode[] {
  const {
    state,
    paymentMode,
    createdAt,
    confirmedAt,
    completedAt,
    autoCompleted,
    cancelledAt,
    payments,
  } = args

  const nodes: TimelineNode[] = []

  // ── Created ─────────────────────────────────────────────────────────
  nodes.push({
    key: 'created',
    label: 'Booking Created',
    detail: 'Booking request placed',
    at: createdAt,
    amountRupees: null,
    status: 'info',
    phase: PHASE_CREATED,
  })

  // ── Confirmed ───────────────────────────────────────────────────────
  if (confirmedAt) {
    nodes.push({
      key: 'confirmed',
      label: 'Confirmed',
      detail: 'Slot reserved for the Customer',
      at: confirmedAt,
      amountRupees: null,
      status: 'success',
      phase: PHASE_CONFIRMED,
    })
  }

  // ── Payment-capture events (the money path) ─────────────────────────
  // For a Partial-pay Booking the Advance (booking_create) and the T-24h
  // balance auto-capture render as two distinct money nodes; for a
  // full-upfront Booking the single booking_create capture is the Advance.
  for (const p of payments) {
    if (p.captureTrigger === 'auto_capture_t_minus_24h') {
      nodes.push({
        key: 'payment-balance',
        label: 'Balance auto-captured at T-24h',
        detail: 'Remaining balance auto-captured 24h before the Experience',
        at: p.capturedAt,
        amountRupees: p.amountRupees,
        status: 'success',
        // Sort balance just after the advance within the money phase.
        phase: PHASE_PAYMENT + 0.5,
      })
    } else if (p.captureTrigger === 'booking_create') {
      const isPartial = paymentMode === 'partial_pay'
      nodes.push({
        key: 'payment-advance',
        label: isPartial ? 'Advance captured (25%)' : 'Paid in full',
        detail: isPartial
          ? 'Advance captured at Booking create'
          : 'Full amount captured at Booking create',
        at: p.capturedAt,
        amountRupees: p.amountRupees,
        status: 'credit',
        phase: PHASE_PAYMENT,
      })
    } else if (p.captureTrigger === 'refund_reverse') {
      nodes.push({
        key: `payment-refund-${nodes.length}`,
        label: 'Refund reversed',
        detail: 'Captured payment reversed for a refund',
        at: p.capturedAt,
        amountRupees: p.amountRupees,
        status: 'danger',
        phase: PHASE_PAYMENT + 0.7,
      })
    } else {
      nodes.push({
        key: `payment-${p.captureTrigger}-${nodes.length}`,
        label: 'Payment captured',
        detail: 'Payment captured',
        at: p.capturedAt,
        amountRupees: p.amountRupees,
        status: 'credit',
        phase: PHASE_PAYMENT + 0.6,
      })
    }
  }

  // ── Terminal lifecycle branch ───────────────────────────────────────
  if (CANCELLED_STATES.has(state)) {
    nodes.push({
      key: 'cancelled',
      label: state === 'cancelled_by_vendor' ? 'Cancelled by Vendor' : 'Cancelled',
      detail: 'Booking cancelled — refund issued where applicable',
      at: cancelledAt,
      amountRupees: null,
      status: 'danger',
      phase: PHASE_TERMINAL,
    })
  } else if (state === 'disputed') {
    nodes.push({
      key: 'disputed',
      label: 'Disputed',
      detail: 'A Customer dispute is open — completion is blocked',
      at: null,
      amountRupees: null,
      status: 'warning',
      phase: PHASE_TERMINAL,
    })
  } else if (completedAt) {
    nodes.push({
      key: 'completed',
      label: autoCompleted ? 'Auto-completed' : 'Completed',
      detail: autoCompleted
        ? 'Auto-completed after the Experience date'
        : 'Marked complete — Payout countdown started (T+7)',
      at: completedAt,
      amountRupees: null,
      status: 'success',
      phase: PHASE_TERMINAL,
    })
  }

  // ── Order the rail ──────────────────────────────────────────────────
  // Primary key: canonical lifecycle phase (the rail IS the lifecycle).
  // Tie-break: event timestamp (orders captures within the money phase;
  // dated before undated/scheduled). For well-formed Bookings phase rank
  // and chronology agree.
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      if (a.node.phase !== b.node.phase) return a.node.phase - b.node.phase
      const at = a.node.at?.getTime()
      const bt = b.node.at?.getTime()
      if (at == null && bt == null) return a.index - b.index
      if (at == null) return 1
      if (bt == null) return -1
      if (at === bt) return a.index - b.index
      return at - bt
    })
    .map(({ node }) => node)
}
