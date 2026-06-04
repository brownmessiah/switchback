import {
  Ban,
  CircleCheck,
  Clock,
  CreditCard,
  Info,
  ShieldCheck,
  TriangleAlert,
  UserX,
  type LucideIcon,
} from 'lucide-react'
import type { ReactElement } from 'react'

import { Badge } from '@/components/ui/badge'
import {
  bookingStatusBadge,
  type BookingBadgeIcon,
} from '@/lib/bookings/booking-status-badge'

/**
 * Shared Booking-status badge for the customer dashboard cards AND the vendor
 * bookings table (critique D). Status is conveyed by a semantic colour family
 * PAIRED WITH a DISTINCT lucide icon and a text label — never colour alone
 * (WCAG 1.4.1), and the two green states (Confirmed / Completed) use different
 * icons so they are tellable apart without reading the label.
 *
 * The state→{variant, icon-key, label-key} mapping is the TDD'd pure helper
 * `bookingStatusBadge`; this component only resolves the icon-key to a lucide
 * component and renders the (caller-supplied, already-translated) label.
 */
const ICON_MAP: Record<BookingBadgeIcon, LucideIcon> = {
  // Confirmed: filled circle-check (money captured).
  confirmed: CircleCheck,
  // Completed: shield-check — a DISTINCT glyph from confirmed's circle-check so
  // the two green states differ by icon, not just label/colour.
  completed: ShieldCheck,
  awaiting: Clock,
  pending: CreditCard,
  alert: TriangleAlert,
  cancelled: Ban,
  no_show: UserX,
  info: Info,
}

export interface BookingStatusBadgeProps {
  /** Booking lifecycle state (schema enum value). */
  state: string
  /** Already-resolved, human-readable status label (English or translated). */
  label: string
  className?: string
}

export function BookingStatusBadge({
  state,
  label,
  className,
}: BookingStatusBadgeProps): ReactElement {
  const spec = bookingStatusBadge(state)
  const Icon = ICON_MAP[spec.icon]
  return (
    <Badge
      data-testid="booking-status"
      data-booking-state={state}
      variant={spec.variant}
      className={className}
    >
      <Icon data-icon="inline-start" aria-hidden />
      {label}
    </Badge>
  )
}
