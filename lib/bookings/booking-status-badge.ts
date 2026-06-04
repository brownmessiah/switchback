/**
 * Pure Booking-state → presentation mapper shared by the customer dashboard
 * booking cards AND the vendor bookings table (critique D — status-by-colour
 * a11y, WCAG 1.4.1).
 *
 * The defect: Confirmed and Completed were BOTH the green `success` variant
 * with the SAME check icon, distinguished by text label alone. For two states
 * in the same colour family the ICON must differ so they are tellable apart
 * without reading the label — mirroring the admin `AdminStatusBadge` principle
 * (status is never conveyed by colour alone; colour is always paired with a
 * distinct icon + a text label).
 *
 * Returns a stable icon-KEY (the call site maps it to a lucide component, so
 * this module stays free of React/lucide imports and is unit-testable in
 * isolation), a semantic Badge variant, and an i18n label-key.
 */

import { BOOKING_TRANSITIONS, type BookingState } from './state-machine'

export type BookingBadgeVariant =
  | 'success'
  | 'warning'
  | 'info'
  | 'destructive'
  | 'outline'

/** Stable icon keys — the call site resolves these to lucide components. */
export type BookingBadgeIcon =
  | 'confirmed'
  | 'completed'
  | 'awaiting'
  | 'pending'
  | 'alert'
  | 'cancelled'
  | 'no_show'
  | 'info'

export interface BookingStatusSpec {
  variant: BookingBadgeVariant
  icon: BookingBadgeIcon
  /** i18n label-key under BookingStatus; raw state for an unknown fallback. */
  labelKey: string
}

const SPEC_MAP: Record<string, BookingStatusSpec> = {
  // Pre-confirmation (ADR-0003 rev 2026-06-01): payment not yet captured.
  pending_payment: { variant: 'warning', icon: 'pending', labelKey: 'pending_payment' },
  // Affirmative, money captured — a filled green check.
  confirmed: { variant: 'success', icon: 'confirmed', labelKey: 'confirmed' },
  // Slot elapsed, awaiting vendor sign-off — amber clock.
  awaiting_completion: {
    variant: 'warning',
    icon: 'awaiting',
    labelKey: 'awaiting_completion',
  },
  // Done. Green like confirmed but a DISTINCT icon (badge/award check) so the
  // two green states are tellable apart without reading the label.
  completed: { variant: 'success', icon: 'completed', labelKey: 'completed' },
  // Active money-on-hold conflict — destructive + alert.
  disputed: { variant: 'destructive', icon: 'alert', labelKey: 'disputed' },
  cancelled_by_customer: {
    variant: 'destructive',
    icon: 'cancelled',
    labelKey: 'cancelled_by_customer',
  },
  cancelled_by_vendor: {
    variant: 'destructive',
    icon: 'cancelled',
    labelKey: 'cancelled_by_vendor',
  },
  cancelled_post_experience: {
    variant: 'destructive',
    icon: 'cancelled',
    labelKey: 'cancelled_post_experience',
  },
  // No-show (ADR-0003 rev 2026-06-01): terminal, customer absent — its own icon.
  no_show: { variant: 'destructive', icon: 'no_show', labelKey: 'no_show' },
}

/**
 * Map a Booking state to its badge presentation. Unknown states fall back to a
 * neutral outline + info icon and echo the raw state as the label-key so a
 * future schema state still renders something legible rather than nothing.
 */
export function bookingStatusBadge(state: string): BookingStatusSpec {
  const known = SPEC_MAP[state]
  if (known) return known
  return { variant: 'outline', icon: 'info', labelKey: state }
}

/** Type-guard helper kept honest: every real state must have a mapping. */
export const ALL_BOOKING_STATES_HAVE_SPEC: boolean = Object.keys(
  BOOKING_TRANSITIONS,
).every((s) => SPEC_MAP[s as BookingState] !== undefined)
