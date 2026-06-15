import type { VendorMemberStatus } from '@/db/schema/vendor-team-members'

import type { AssignableRole } from './team-core'

/**
 * Pure display helpers for the Team & Roles UI (issue #05).
 *
 * Framework-free (no React, no next-intl) so the role→colour, status→colour,
 * and date-formatting contracts are unit-testable in isolation. The page/list
 * consume these to render colored `Badge`s and a formatted "last active" cell.
 *
 * Role-dropdown decision: the Vendor may assign only the FOUR roles below.
 * `'owner'` is deliberately absent — the Owner is the implicit account holder
 * (`vendor_profiles.user_id`), rendered as a protected top row, never an
 * assignable option (the issue-04 backend rejects `'owner'` and the DB has a
 * CHECK). So "the five roles" surface as: Owner (implicit top row) + these four.
 */

/** The four roles a Vendor may assign, in dropdown order. */
export const ASSIGNABLE_ROLE_OPTIONS = [
  'manager',
  'booking_staff',
  'guide',
  'accountant',
] as const satisfies readonly AssignableRole[]

/** A Badge variant from `components/ui/badge.tsx` (the subset we use here). */
export type RoleBadgeVariant = 'info' | 'secondary' | 'success' | 'credit'
export type StatusBadgeVariant = 'success' | 'outline'

/**
 * The `VendorTeam` translation key for a role's human label. Kept as a pure
 * key→key map so the i18n parity test can assert the keys exist in every locale.
 */
export function roleLabelKey(role: AssignableRole): string {
  const keys: Record<AssignableRole, string> = {
    manager: 'roleManager',
    booking_staff: 'roleBookingStaff',
    guide: 'roleGuide',
    accountant: 'roleAccountant',
  }
  return keys[role]
}

/**
 * Map a role to a distinct, stable Badge variant (DESIGN.md §3 semantic tints,
 * each paired with a text label so colour is never the sole signal). Distinct
 * colours let the Owner scan the roster at a glance.
 */
export function roleBadgeVariant(role: AssignableRole): RoleBadgeVariant {
  const variants: Record<AssignableRole, RoleBadgeVariant> = {
    manager: 'info',
    booking_staff: 'secondary',
    guide: 'success',
    accountant: 'credit',
  }
  return variants[role]
}

/** Active → success tint; inactive → neutral outline. */
export function statusBadgeVariant(status: VendorMemberStatus): StatusBadgeVariant {
  return status === 'active' ? 'success' : 'outline'
}

/**
 * Format a nullable `lastActiveAt` as a short en-IN date (no time), or an em
 * dash when the member has never been active. Mirrors the date formatting in
 * `kyc-display.tsx` / `payout-method-form.tsx`.
 */
export function formatLastActive(date: Date | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
