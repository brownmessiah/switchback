/**
 * Confirmation-page headline presentation, derived purely from the Booking
 * state (db/schema/bookings.ts `booking_state` enum).
 *
 * The confirmation loader does NOT filter by state — it keys only on
 * (bookingId, customerUserId) — so this page can render for ANY booking the
 * Customer owns, including cancelled and disputed ones. The headline, the body
 * clause, and the status icon/tone must therefore all agree: a green success
 * check may appear ONLY for a confirmed/paid booking, never on a cancelled or
 * disputed one. This pure mapping is the single source of that coherence.
 */

/** Status-icon + headline tone. Maps onto the §2 semantic-status tokens. */
export type ConfirmationTone = 'success' | 'warning' | 'muted'

/** Which lucide glyph the success-indicator renders. Resolved at the call site. */
export type ConfirmationIcon = 'check' | 'alert' | 'cancelled'

export interface ConfirmationPresentation {
  /** H1 text. The E2E asserts "Booking confirmed" for the confirmed seed. */
  headline: string
  /** Trailing clause appended after the Experience link in the sub-paragraph. */
  bodyClause: string
  /** Icon glyph for the success indicator. */
  icon: ConfirmationIcon
  /** Color tone for the indicator + headline accent. */
  tone: ConfirmationTone
}

// Settlement-positive states: money is captured (or pending only the partial-pay
// balance auto-charge, which is still a confirmed booking — there is no separate
// "reserved" enum state). These are the only states that earn the success check.
const CONFIRMED: ConfirmationPresentation = {
  headline: 'Booking confirmed',
  bodyClause: 'is confirmed.',
  icon: 'check',
  tone: 'success',
}

const CANCELLED: ConfirmationPresentation = {
  headline: 'Booking cancelled',
  bodyClause: 'has been cancelled.',
  icon: 'cancelled',
  tone: 'muted',
}

const DISPUTED: ConfirmationPresentation = {
  headline: 'Under review',
  bodyClause: 'is under review.',
  icon: 'alert',
  tone: 'warning',
}

// Pre-confirmation (ADR-0003 rev 2026-06-01): the row exists but payment has
// not been captured. MUST NOT earn the success check — payment is still owed.
const PENDING_PAYMENT: ConfirmationPresentation = {
  headline: 'Payment pending',
  bodyClause: 'is awaiting payment.',
  icon: 'alert',
  tone: 'warning',
}

// No-show (ADR-0003 rev 2026-06-01): terminal; the customer did not attend.
const NO_SHOW: ConfirmationPresentation = {
  headline: 'Marked as no-show',
  bodyClause: 'was marked as a no-show.',
  icon: 'cancelled',
  tone: 'muted',
}

// Safe neutral fallback for any unrecognised/future state — never a success check.
const NEUTRAL: ConfirmationPresentation = {
  headline: 'Booking details',
  bodyClause: 'is on record.',
  icon: 'cancelled',
  tone: 'muted',
}

const BY_STATE: Record<string, ConfirmationPresentation> = {
  pending_payment: PENDING_PAYMENT,
  confirmed: CONFIRMED,
  awaiting_completion: CONFIRMED,
  completed: CONFIRMED,
  disputed: DISPUTED,
  cancelled_by_customer: CANCELLED,
  cancelled_by_vendor: CANCELLED,
  cancelled_post_experience: CANCELLED,
  no_show: NO_SHOW,
}

export function getConfirmationPresentation(
  state: string,
): ConfirmationPresentation {
  return BY_STATE[state] ?? NEUTRAL
}
