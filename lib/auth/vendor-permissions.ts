/**
 * Vendor permission matrix — the pure authorization core for multi-seat
 * Vendor accounts (ADR-0006 revision 2026-06-15, issue #03).
 *
 * This module is DELIBERATELY pure: no DB, no session, no I/O. It encodes the
 * PRD's five-role matrix verbatim and answers a single question —
 * `can(role, permission)`. The DB-backed gate (`resolveVendorRole`,
 * `requireVendorAccess`, `hasVendorAccess`) lives in `./permissions` and
 * composes this module.
 *
 * A Vendor role is a *permission shape*, mirroring the sub-admin precedent
 * (an Admin whose `permissions` array is a strict subset). Owner holds every
 * permission via the `'*'` wildcard — exactly like a full Admin.
 */

/**
 * The five Vendor-side roles. `'owner'` is implicit (resolved from
 * `vendor_profiles`, never stored as a `vendor_team_members` row), but it is
 * a first-class entry in this matrix so `can('owner', …)` is total.
 */
export const VENDOR_ROLES = [
  'owner',
  'manager',
  'booking_staff',
  'guide',
  'accountant',
] as const

export type VendorRole = (typeof VENDOR_ROLES)[number]

/**
 * The Vendor permission vocabulary. Each existing Vendor route/Server Action
 * maps to exactly one of these.
 *
 * - experiences:manage  — create/edit/upload/delete Experiences (pricing).
 * - availability:manage — patterns, materialize, block/unblock dates.
 * - bookings:read       — view bookings (manifest, list, assigned roster).
 * - bookings:manage     — mark complete, vendor-cancel, no-show.
 * - bookings:checkin    — scan QR / mark customer arrived / completed.
 * - analytics:read      — earnings, booking revenue, dashboard analytics.
 * - payouts:read        — payouts, invoices.
 * - bank:manage         — edit payout destination / bank details.
 * - kyc:manage          — business details, profile, KYC.
 * - team:manage         — invite / deactivate team members.
 * - account:close       — self-serve Vendor account closure.
 */
export const VENDOR_PERMISSIONS = [
  'experiences:manage',
  'availability:manage',
  'bookings:read',
  'bookings:manage',
  'bookings:checkin',
  'analytics:read',
  'payouts:read',
  'bank:manage',
  'kyc:manage',
  'team:manage',
  'account:close',
] as const

export type VendorPermission = (typeof VENDOR_PERMISSIONS)[number]

/**
 * Wildcard marker for a role that holds every permission. Only Owner uses it,
 * mirroring the admin model's `'*'`.
 */
const WILDCARD = '*' as const

/**
 * The role → permission-set matrix, encoded VERBATIM from the PRD. The
 * explicit denies (a permission absent from a role's set) are the security
 * contract and are individually asserted in the test suite.
 *
 * Owner holds `'*'` (full access). Every other role lists exactly the
 * permissions the PRD grants it; everything not listed is denied.
 */
export const ROLE_PERMISSIONS: Readonly<
  Record<VendorRole, readonly (VendorPermission | typeof WILDCARD)[]>
> = {
  // Owner — full access (profile, KYC, bank, payouts, experiences, bookings,
  // availability, team). Wildcard.
  owner: [WILDCARD],

  // Manager — manage experiences, bookings, availability; view analytics.
  // NOT: delete account, edit bank, manage team.
  manager: [
    'experiences:manage',
    'availability:manage',
    'bookings:read',
    'bookings:manage',
    'bookings:checkin',
    'analytics:read',
  ],

  // Booking Staff — view/manage bookings, scan QR, mark check-in/completed.
  // NOT: pricing, payouts, KYC, team.
  booking_staff: ['bookings:read', 'bookings:manage', 'bookings:checkin'],

  // Guide — view assigned bookings, mark customers arrived/completed.
  // NOT: earnings, payouts, bank, KYC, team. Assigned-only is read + checkin,
  // NOT general booking management (no cancel / no-show).
  guide: ['bookings:read', 'bookings:checkin'],

  // Accountant — view earnings, payouts, invoices, booking revenue (READ).
  // NOT: edit experiences/availability, KYC, team.
  accountant: ['payouts:read', 'analytics:read', 'bookings:read'],
}

/**
 * Pure authorization check: does `role` hold `permission`?
 *
 * Owner (`'*'`) passes every check. Every other role passes only for the
 * permissions explicitly granted in {@link ROLE_PERMISSIONS}.
 */
export function can(role: VendorRole, permission: VendorPermission): boolean {
  const grants = ROLE_PERMISSIONS[role]
  return grants.includes(WILDCARD) || grants.includes(permission)
}
