import {
  BadgeCheck,
  CalendarCheck,
  Sparkles,
  ShieldCheck,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import type { TrustBadgeId } from '@/lib/trust-badges/derive'

/**
 * `TrustBadge` — the single, shared rendering for every data-honest badge in
 * the canonical vocabulary (lib/trust-badges/derive.ts). Both the experience
 * card and the PDP render through this component so the two surfaces can never
 * drift in icon, colour, or accessibility treatment.
 *
 * Each badge pairs a lucide icon with the (already i18n-resolved) label text so
 * status is never conveyed by colour alone (DESIGN.md §1.3 / WCAG 1.4.1). The
 * label is passed in by the call site — the component owns icon + variant only,
 * keeping it framework-pure and trivially unit-testable.
 */

interface BadgeStyle {
  icon: LucideIcon
  /** Semantic Badge variant (see components/ui/badge.tsx). */
  variant: 'success' | 'info' | 'credit' | 'secondary'
}

const BADGE_STYLES: Record<TrustBadgeId, BadgeStyle> = {
  'verified-vendor': { icon: BadgeCheck, variant: 'success' },
  'safety-checked': { icon: ShieldCheck, variant: 'success' },
  'instant-confirmation': { icon: Zap, variant: 'info' },
  'partial-pay': { icon: Wallet, variant: 'credit' },
  'flexible-cancellation': { icon: CalendarCheck, variant: 'success' },
  'beginner-friendly': { icon: Sparkles, variant: 'secondary' },
}

export interface TrustBadgeProps {
  id: TrustBadgeId
  /** i18n-resolved label text (e.g. "Identity verified", "Flexible cancellation"). */
  label: string
  className?: string
}

export function TrustBadge({ id, label, className }: TrustBadgeProps) {
  const { icon: Icon, variant } = BADGE_STYLES[id]
  return (
    <Badge variant={variant} className={className}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  )
}
