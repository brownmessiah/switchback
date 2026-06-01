import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { listUsers, type UserRole } from '@/lib/admin/users-list'
import { requirePermission } from '@/lib/auth/permissions'

import { UserFilters } from './user-filters'
import { UsersTable } from './users-table'

const PAGE_SIZE = 25

const VALID_ROLES: ReadonlySet<UserRole> = new Set([
  'customer',
  'vendor',
  'admin',
  'sub_admin',
])

interface UsersSearchParams {
  query?: string
  role?: string
  page?: string
}

/**
 * #17 — `/admin/users`: the single place to see ALL users with their derived
 * role badges (customer / vendor / admin / sub_admin), search, role filter and
 * pagination. Gated on the `users` permission (ADR-0006): a full admin (`'*'`)
 * passes; a sub-admin sees it only if explicitly granted `users` — it is NOT
 * part of the default sub-admin grid.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<UsersSearchParams>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()
  await requirePermission(db, session.user.id, 'users')

  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const role =
    params.role && VALID_ROLES.has(params.role as UserRole)
      ? (params.role as UserRole)
      : undefined
  const query = params.query?.trim() || undefined

  const result = await listUsers(db, { query, role, page, pageSize: PAGE_SIZE })

  function pageUrl(p: number): string {
    const sp = new URLSearchParams()
    if (query) sp.set('query', query)
    if (role) sp.set('role', role)
    if (p > 1) sp.set('page', String(p))
    const qs = sp.toString()
    return `/admin/users${qs ? `?${qs}` : ''}`
  }

  const isFiltered = Boolean(query || role)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-h1 font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{result.total}</span> user
          {result.total === 1 ? '' : 's'}
          {isFiltered ? ' (filtered)' : ''}
        </p>
      </div>

      <UserFilters currentFilters={{ query, role }} />

      <UsersTable rows={result.users} />

      {result.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {result.page} of {result.totalPages}
          </p>
          <div className="flex gap-2">
            {result.page > 1 && (
              <a href={pageUrl(result.page - 1)}>
                <Button variant="outline" size="sm">
                  Previous
                </Button>
              </a>
            )}
            {result.page < result.totalPages && (
              <a href={pageUrl(result.page + 1)}>
                <Button variant="outline" size="sm">
                  Next
                </Button>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
