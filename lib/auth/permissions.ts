import { eq, type ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { notFound } from 'next/navigation'

import type * as schema from '@/db/schema'
import { adminProfiles } from '@/db/schema/admin-profiles'
import { vendorProfiles } from '@/db/schema/vendor-profiles'

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
 * The 16 admin permissions per ADR-0006. A full admin has all 16;
 * a sub-admin holds a strict subset. The distinction is purely
 * governance — there is no separate "sub-admin" role in the schema.
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
] as const

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number]

/** Convenience constant: all 16 permissions for full-admin creation. */
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

  if (!admin || !admin.permissions.includes(permission)) {
    notFound()
  }
}

/**
 * Verify that `userId` has a `vendor_profiles` row.
 *
 * Throws a redirect to `/vendor/onboarding` if no vendor profile exists.
 * Used by the vendor layout to gate access.
 */
export async function requireVendorProfile(
  db: DBOrTx,
  userId: string,
): Promise<void> {
  const [vendor] = await db
    .select({ userId: vendorProfiles.userId })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, userId))
    .limit(1)

  if (!vendor) {
    // Dynamic import to avoid pulling next/navigation into unit tests
    // when it's not needed. The redirect function throws internally.
    const { redirect } = await import('next/navigation')
    redirect('/vendor/onboarding')
  }
}
