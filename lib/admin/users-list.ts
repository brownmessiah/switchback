import { and, eq, ilike, isNotNull, or, sql, type SQL } from 'drizzle-orm'

import { adminProfiles } from '@/db/schema/admin-profiles'
import { customerProfiles } from '@/db/schema/customer-profiles'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * #17 — the pure, PGlite-testable loader behind the general `/admin/users`
 * screen. There is NO single place in the app to see ALL users; this is it.
 *
 * Role derivation is a function of profile-table membership (ADR-0006). A
 * User row carries no intrinsic role column — customer / vendor / admin /
 * sub_admin are all derived from the presence of a row in the matching
 * profile table:
 *   - `customer`  ⇐ a customer_profiles row
 *   - `vendor`    ⇐ a vendor_profiles row
 *   - `admin`     ⇐ an admin_profiles row with permissions = ['*'] and no
 *                    invitedByUserId (a founder/full admin)
 *   - `sub_admin` ⇐ an admin_profiles row that is invited (invitedByUserId set)
 *                    OR whose permissions are a strict subset (≠ ['*'])
 *
 * userId is the PRIMARY KEY of every profile table, so each LEFT JOIN
 * contributes at most one row — there is no join fan-out and a multi-role
 * user appears exactly once.
 */

export type UserRole = 'customer' | 'vendor' | 'admin' | 'sub_admin'

export interface UsersListRow {
  id: string
  name: string | null
  email: string | null
  image: string | null
  roles: UserRole[]
  /** Only present when the user is a vendor; mirrors vendor_profiles.suspended. */
  vendorSuspended?: boolean
}

export interface UsersListParams {
  query?: string
  role?: UserRole
  page: number
  pageSize: number
}

export interface UsersListResult {
  users: UsersListRow[]
  total: number
  page: number
  totalPages: number
}

/**
 * SQL boolean: the admin_profiles row represents a full (founder) admin —
 * permissions is exactly ['*'] AND it was not invited by another admin.
 * Anything else with an admin_profiles row is a sub-admin.
 */
function isFullAdminExpr(): SQL<boolean> {
  return sql<boolean>`(
    ${adminProfiles.userId} is not null
    and ${adminProfiles.invitedByUserId} is null
    and ${adminProfiles.permissions} = array['*']::text[]
  )`
}

function roleFilterCondition(role: UserRole): SQL {
  switch (role) {
    case 'customer':
      return isNotNull(customerProfiles.userId)
    case 'vendor':
      return isNotNull(vendorProfiles.userId)
    case 'admin':
      return isFullAdminExpr()
    case 'sub_admin':
      return sql`(${adminProfiles.userId} is not null and not ${isFullAdminExpr()})`
  }
}

function deriveRoles(row: {
  hasCustomer: boolean
  hasVendor: boolean
  hasAdmin: boolean
  isFullAdmin: boolean
}): UserRole[] {
  const roles: UserRole[] = []
  if (row.hasCustomer) roles.push('customer')
  if (row.hasVendor) roles.push('vendor')
  if (row.hasAdmin) roles.push(row.isFullAdmin ? 'admin' : 'sub_admin')
  return roles
}

export async function listUsers(
  db: DBOrTx,
  params: UsersListParams,
): Promise<UsersListResult> {
  const page = Math.max(1, Math.floor(params.page) || 1)
  const pageSize = Math.max(1, Math.floor(params.pageSize) || 20)
  const offset = (page - 1) * pageSize

  const conditions: SQL[] = []

  const trimmedQuery = params.query?.trim()
  if (trimmedQuery) {
    const pattern = `%${trimmedQuery}%`
    const search = or(ilike(users.name, pattern), ilike(users.email, pattern))
    if (search) conditions.push(search)
  }

  if (params.role) {
    conditions.push(roleFilterCondition(params.role))
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const baseQuery = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      createdAt: users.createdAt,
      hasCustomer: sql<boolean>`${customerProfiles.userId} is not null`,
      hasVendor: sql<boolean>`${vendorProfiles.userId} is not null`,
      vendorSuspended: vendorProfiles.suspended,
      hasAdmin: sql<boolean>`${adminProfiles.userId} is not null`,
      isFullAdmin: isFullAdminExpr(),
    })
    .from(users)
    .leftJoin(customerProfiles, eq(customerProfiles.userId, users.id))
    .leftJoin(vendorProfiles, eq(vendorProfiles.userId, users.id))
    .leftJoin(adminProfiles, eq(adminProfiles.userId, users.id))

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .leftJoin(customerProfiles, eq(customerProfiles.userId, users.id))
    .leftJoin(vendorProfiles, eq(vendorProfiles.userId, users.id))
    .leftJoin(adminProfiles, eq(adminProfiles.userId, users.id))
    .where(whereClause)

  const total = countResult?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const rows = await baseQuery
    .where(whereClause)
    .orderBy(sql`${users.createdAt} asc nulls last`, users.id)
    .limit(pageSize)
    .offset(offset)

  const list: UsersListRow[] = rows.map((r) => {
    const roles = deriveRoles({
      hasCustomer: r.hasCustomer,
      hasVendor: r.hasVendor,
      hasAdmin: r.hasAdmin,
      isFullAdmin: r.isFullAdmin,
    })
    const row: UsersListRow = {
      id: r.id,
      name: r.name,
      email: r.email,
      image: r.image,
      roles,
    }
    if (r.hasVendor) {
      row.vendorSuspended = r.vendorSuspended ?? false
    }
    return row
  })

  return { users: list, total, page, totalPages }
}
