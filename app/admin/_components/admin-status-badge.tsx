import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  InfoIcon,
  PauseCircleIcon,
  WalletIcon,
  XCircleIcon,
  type LucideIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'

/**
 * Shared status badge for admin money queues. DESIGN.md §1.3 / §5: status is
 * NEVER conveyed by color alone — every badge pairs a semantic status color
 * token WITH a lucide icon (check / clock / info / wallet / pause / alert).
 *
 * One mapping reused across refunds / payouts / commission (and the later
 * admin-table batches), so semantic status stays consistent.
 */
type StatusKind = 'success' | 'warning' | 'info' | 'credit' | 'destructive' | 'neutral'

interface StatusSpec {
  variant: 'success' | 'warning' | 'info' | 'credit' | 'destructive' | 'outline'
  icon: LucideIcon
}

const STATUS_MAP: Record<string, StatusSpec> = {
  // Affirmative / money released
  approved: { variant: 'success', icon: CheckCircle2Icon },
  credited: { variant: 'success', icon: CheckCircle2Icon },
  completed: { variant: 'success', icon: CheckCircle2Icon },
  active: { variant: 'success', icon: CheckCircle2Icon },
  // Awaiting operator action
  pending: { variant: 'warning', icon: ClockIcon },
  upcoming: { variant: 'info', icon: ClockIcon },
  awaiting_completion: { variant: 'warning', icon: ClockIcon },
  // Frozen
  held: { variant: 'warning', icon: PauseCircleIcon },
  // Refund-to-credit bucket
  credit: { variant: 'credit', icon: WalletIcon },
  // Negative / failed
  rejected: { variant: 'destructive', icon: XCircleIcon },
  failed: { variant: 'destructive', icon: AlertTriangleIcon },
  expired: { variant: 'destructive', icon: XCircleIcon },
}

const FALLBACK: StatusSpec = { variant: 'outline', icon: InfoIcon }

export interface AdminStatusBadgeProps {
  /** A queue state key (e.g. 'pending', 'approved', 'held', 'rejected'). */
  status: string
  /** Human label rendered in the badge (English-only). */
  label: string
  className?: string
}

export function AdminStatusBadge({ status, label, className }: AdminStatusBadgeProps) {
  const spec = STATUS_MAP[status] ?? FALLBACK
  const Icon = spec.icon
  return (
    <Badge variant={spec.variant} className={className}>
      <Icon data-icon="inline-start" aria-hidden />
      {label}
    </Badge>
  )
}

export type { StatusKind }
