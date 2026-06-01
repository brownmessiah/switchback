import {
  ShieldIcon,
  ShieldCheckIcon,
  StoreIcon,
  UserIcon,
  type LucideIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'

import type { UserRole } from '@/lib/admin/users-list'

/**
 * #17 — semantic role badge for the general user-management list.
 *
 * DESIGN.md §1.3 / §5: role is NEVER conveyed by color alone — every badge
 * pairs a semantic color token WITH a lucide icon so it is distinguishable
 * without color (e.g. for color-blind operators / greyscale print). Roles are
 * derived from profile-table membership (ADR-0006), so a single user can carry
 * several badges (e.g. both customer + vendor).
 */
interface RoleSpec {
  variant: 'info' | 'success' | 'destructive' | 'secondary'
  icon: LucideIcon
  label: string
}

const ROLE_MAP: Record<UserRole, RoleSpec> = {
  // A customer is a baseline marketplace participant — informational.
  customer: { variant: 'info', icon: UserIcon, label: 'Customer' },
  // A vendor takes Bookings — affirmative success token.
  vendor: { variant: 'success', icon: StoreIcon, label: 'Vendor' },
  // A full (founder) admin holds the platform-wide '*' grant — emphasised.
  admin: { variant: 'destructive', icon: ShieldCheckIcon, label: 'Admin' },
  // A sub-admin holds a strict permission subset — neutral governance token.
  sub_admin: { variant: 'secondary', icon: ShieldIcon, label: 'Sub-admin' },
}

export function UserRoleBadge({ role, className }: { role: UserRole; className?: string }) {
  const spec = ROLE_MAP[role]
  const Icon = spec.icon
  return (
    <Badge variant={spec.variant} className={className}>
      <Icon data-icon="inline-start" aria-hidden />
      {spec.label}
    </Badge>
  )
}
