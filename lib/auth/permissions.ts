import { and, asc, eq, isNull, type ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { notFound } from 'next/navigation'

import type * as schema from '@/db/schema'
import { adminProfiles } from '@/db/schema/admin-profiles'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { vendorTeamMembers } from '@/db/schema/vendor-team-members'

import { can, type VendorPermission, type VendorRole } from './vendor-permissions'

/**
 * Drizzle db or transaction handle. Same shape as DBOrTx in
 * commission-resolver but defined locally to avoid a cross-domain
 * dependency from auth → payments.
 */
type DBOrTx = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

/**
 * The 17 admin permissions per ADR-0006. A full admin has all 17;
 * a sub-admin holds a strict subset. The distinction is purely
 * governance — there is no separate "sub-admin" role in the schema.
 *
 * `users` (the general user-management screen, #17) is intentionally NOT
 * part of any default sub-admin grant — it is only reachable by a full
 * admin (`'*'`) or a sub-admin explicitly granted `users`.
 */
export const ADMIN_PERMISSIONS = [
  'overview',
  'analytics',
  'vendors',
  'experiences',
  'bookings',
  'payouts',
  'refunds',
  'commission',
  'region_closures',
  'reviews',
  'support',
  'blog',
  'site_builder',
  'audit',
  'sub_admins',
  'reports',
  'users',
] as const

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number]

/** Convenience constant: all 17 permissions for full-admin creation. */
export const FULL_ADMIN_PERMISSIONS: readonly AdminPermission[] = [...ADMIN_PERMISSIONS]

/**
 * Verify that `userId` holds the given `permission` in `admin_profiles`.
 *
 * Calls `notFound()` (throws a Next.js NOT_FOUND error) if:
 *   - no admin_profiles row exists for the userId
 *   - the row's permissions array does not include the requested permission
 *
 * Accepts any Drizzle-compatible db handle (production db or test PGlite)
 * so the function is testable without mocking.
 */
export async function requirePermission(
  db: DBOrTx,
  userId: string,
  permission: AdminPermission,
): Promise<void> {
  const [admin] = await db
    .select({ permissions: adminProfiles.permissions })
    .from(adminProfiles)
    .where(eq(adminProfiles.userId, userId))
    .limit(1)

  if (!admin || !(admin.permissions.includes('*') || admin.permissions.includes(permission))) {
    notFound()
  }
}

/**
 * Non-throwing variant of {@link requirePermission} for use inside admin
 * Server Actions (write boundary).
 *
 * Per ADR-0006 every privileged action must be permission-gated server-side,
 * not merely hidden in the UI. Page-level Server Components gate reads via
 * `requirePermission` (which calls `notFound()`); Server Actions instead
 * return a typed result envelope, so they need a boolean check rather than a
 * `notFound()` throw. A full admin (`'*'`) passes every check; a Sub-admin
 * passes only for permissions in their strict subset.
 *
 * @returns `true` if the user holds `permission` (or the `'*'` wildcard),
 *          `false` otherwise (no admin_profiles row, or permission absent).
 */
export async function hasAdminPermission(
  db: DBOrTx,
  userId: string,
  permission: AdminPermission,
): Promise<boolean> {
  const [admin] = await db
    .select({ permissions: adminProfiles.permissions })
    .from(adminProfiles)
    .where(eq(adminProfiles.userId, userId))
    .limit(1)

  if (!admin) return false
  return admin.permissions.includes('*') || admin.permissions.includes(permission)
}

/**
 * Verify that `userId` has an ACTIVE `vendor_profiles` row.
 *
 * Throws a redirect to `/vendor/onboarding` if no vendor profile exists OR
 * the profile is soft-closed (closed_at IS NOT NULL — issue 06). A closed
 * Vendor reverts to a Customer-only account WITHOUT the row being deleted;
 * re-onboarding reactivates it (ADR-0006). `closed_at` (self-serve) and
 * `suspended` (admin) are ORTHOGONAL — a row is an active Vendor only when
 * closed_at IS NULL; suspension is handled separately, not here.
 *
 * Used by the vendor layout to gate access.
 */
export async function requireVendorProfile(
  db: DBOrTx,
  userId: string,
): Promise<void> {
  const [vendor] = await db
    .select({ userId: vendorProfiles.userId })
    .from(vendorProfiles)
    .where(and(eq(vendorProfiles.userId, userId), isNull(vendorProfiles.closedAt)))
    .limit(1)

  if (!vendor) {
    // Dynamic import to avoid pulling next/navigation into unit tests
    // when it's not needed. The redirect function throws internally.
    const { redirect } = await import('next/navigation')
    redirect('/vendor/onboarding')
  }
}

// ── Vendor team-member access gate (ADR-0006 rev 2026-06-15, issue #03) ──
//
// The Vendor analogue of the admin gate above. `resolveVendorRole` answers
// "what role does `actingUserId` hold on the `vendorUserId` account?", then
// `requireVendorAccess` (throwing — for reads) and `hasVendorAccess` (boolean
// — for Server Actions) authorize against the pure matrix in
// `./vendor-permissions`. Owner is implicit (resolved from `vendor_profiles`,
// `closed_at IS NULL`), never a `vendor_team_members` row. Inactive members
// and non-members resolve to null (denied).

export type { VendorPermission, VendorRole } from './vendor-permissions'

/**
 * Resolve the Vendor-side role that `actingUserId` holds on the Vendor account
 * identified by `vendorUserId`.
 *
 *   1. `actingUserId === vendorUserId` AND an ACTIVE vendor_profiles row
 *      (closed_at IS NULL) → `'owner'` (Owner is implicit, never stored).
 *   2. else an ACTIVE vendor_team_members row for (vendorUserId, actingUserId)
 *      → its `role`.
 *   3. else `null` (denied). An INACTIVE member resolves to null — the
 *      mechanism for deactivation-without-deletion (ADR-0006 Story 36).
 *
 * For today's single-seat routes `vendorUserId === actingUserId`, so this
 * always resolves to Owner = full access → zero behavior change.
 */
export async function resolveVendorRole(
  db: DBOrTx,
  vendorUserId: string,
  actingUserId: string,
): Promise<VendorRole | null> {
  if (actingUserId === vendorUserId) {
    const [vendor] = await db
      .select({ userId: vendorProfiles.userId })
      .from(vendorProfiles)
      .where(and(eq(vendorProfiles.userId, vendorUserId), isNull(vendorProfiles.closedAt)))
      .limit(1)

    if (vendor) return 'owner'
    // Fall through: a closed/absent profile is not an owner; the acting user
    // may still be a team member of someone else's account (not this one).
  }

  const [member] = await db
    .select({ role: vendorTeamMembers.role })
    .from(vendorTeamMembers)
    .where(
      and(
        eq(vendorTeamMembers.vendorUserId, vendorUserId),
        eq(vendorTeamMembers.memberUserId, actingUserId),
        eq(vendorTeamMembers.status, 'active'),
      ),
    )
    .limit(1)

  return member?.role ?? null
}

/**
 * The resolved Vendor context for an acting human (issue #11): which Vendor
 * account ("shop") they are acting on, and the role they hold there.
 */
export interface ActingVendorContext {
  /** The Vendor account being acted on (= `vendor_profiles.user_id`). */
  vendorUserId: string
  /** The acting user's role on that account. */
  role: VendorRole
}

/**
 * Resolve the single Vendor account + role an acting human operates as, WITHOUT
 * redirecting (issue #11). Returns `null` when there is no active context —
 * the variant Server Actions use to map "no context" to a typed error envelope
 * (the throwing/redirecting {@link resolveActingVendorContext} wraps this for
 * page/layout reads).
 *
 * The vendor surface historically assumed "logged-in user = shop owner" (every
 * loader/action used `session.user.id` AS the Vendor-account id). This resolves
 * the acting user's `{ vendorUserId, role }` ONCE so members can log in and the
 * resolved `vendorUserId` is threaded through the surface in place of the
 * session id, while every gate keys on the resolved `role`.
 *
 * Precedence (single-account model, NO switcher — the switcher is v2 and this
 * function is the seam):
 *   1. **Owner** — if the acting user owns an ACTIVE `vendor_profiles` row
 *      (closed_at IS NULL), they act on their OWN account as `owner`. Owner
 *      wins even if they are also a member of another account.
 *   2. **Single membership** — else the earliest-invited ACTIVE
 *      `vendor_team_members` row (deterministic `invited_at ASC, vendor_user_id
 *      ASC` tie-break for the rare multi-membership case) → that shop + role.
 *   3. **None** → `null` (a profile-less non-member, OR a closed-only profile
 *      with no active membership).
 *
 * For the single-seat owner this resolves to `{ vendorUserId: actingUserId,
 * role: 'owner' }` — zero behavior change.
 */
export async function resolveActingVendorScope(
  db: DBOrTx,
  actingUserId: string,
): Promise<ActingVendorContext | null> {
  // 1. Owner of an active own profile takes precedence.
  const ownRole = await resolveVendorRole(db, actingUserId, actingUserId)
  if (ownRole === 'owner') {
    return { vendorUserId: actingUserId, role: 'owner' }
  }

  // 2. Earliest-invited ACTIVE membership (deterministic tie-break). NULLS in
  //    invited_at sort LAST in Postgres ASC, so the vendor_user_id ASC arm is
  //    the stable fallback when invited_at is absent on both rows.
  const [member] = await db
    .select({
      vendorUserId: vendorTeamMembers.vendorUserId,
      role: vendorTeamMembers.role,
    })
    .from(vendorTeamMembers)
    .where(
      and(
        eq(vendorTeamMembers.memberUserId, actingUserId),
        eq(vendorTeamMembers.status, 'active'),
      ),
    )
    .orderBy(asc(vendorTeamMembers.invitedAt), asc(vendorTeamMembers.vendorUserId))
    .limit(1)

  if (member && member.role !== 'owner') {
    // `role` is the stored enum (`'owner'` is never a row — DB CHECK + invite
    // flow guarantee it); the guard narrows the type and is defense-in-depth.
    return { vendorUserId: member.vendorUserId, role: member.role }
  }

  // 3. None — no active account context.
  return null
}

/**
 * Page/layout variant of {@link resolveActingVendorScope}: redirects to
 * `/vendor/onboarding` when there is no active context (mirrors
 * {@link requireVendorProfile}; the redirect throws), otherwise returns the
 * resolved `{ vendorUserId, role }`. This is what the `(dashboard)` layout and
 * every page call.
 */
export async function resolveActingVendorContext(
  db: DBOrTx,
  actingUserId: string,
): Promise<ActingVendorContext> {
  const scope = await resolveActingVendorScope(db, actingUserId)
  if (scope) return scope

  // No active account context. Redirect to onboarding (same dynamic import
  // pattern as requireVendorProfile so unit tests that never hit this branch
  // don't pull next/navigation; the redirect function throws).
  const { redirect } = await import('next/navigation')
  redirect('/vendor/onboarding')
  // `redirect` throws (NEXT_REDIRECT) and never returns; this is unreachable
  // and exists only so the function's non-undefined return type type-checks.
  throw new Error('unreachable: redirect did not throw')
}

/**
 * Verify that `actingUserId` may perform `permission` on the `vendorUserId`
 * account; throws Next.js `notFound()` if denied. The throwing variant for
 * page/layout/Server-Component reads (mirrors {@link requirePermission}).
 *
 * `vendorUserId` defaults to `actingUserId` (the single-seat case: a Vendor
 * accesses their own account).
 */
export async function requireVendorAccess(
  db: DBOrTx,
  actingUserId: string,
  permission: VendorPermission,
  vendorUserId: string = actingUserId,
): Promise<void> {
  const role = await resolveVendorRole(db, vendorUserId, actingUserId)
  if (!role || !can(role, permission)) {
    notFound()
  }
}

/**
 * Non-throwing variant of {@link requireVendorAccess} for use inside Vendor
 * Server Actions (write boundary), which return a typed result envelope rather
 * than calling `notFound()` (mirrors {@link hasAdminPermission}).
 *
 * `vendorUserId` defaults to `actingUserId` (single-seat case).
 *
 * @returns `true` if `actingUserId` holds `permission` on the account,
 *          `false` otherwise (no role resolved, or permission denied).
 */
export async function hasVendorAccess(
  db: DBOrTx,
  actingUserId: string,
  permission: VendorPermission,
  vendorUserId: string = actingUserId,
): Promise<boolean> {
  const role = await resolveVendorRole(db, vendorUserId, actingUserId)
  if (!role) return false
  return can(role, permission)
}
