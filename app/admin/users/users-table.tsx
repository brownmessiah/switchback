import Link from 'next/link'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from '@/components/ui/responsive-table'
import type { UsersListRow } from '@/lib/admin/users-list'

import { UserRoleBadge } from './user-role-badge'

/**
 * #17 — the general user-management LIST as a DESIGN.md §4 A3 table, now via the
 * shared `<ResponsiveTable>` so it reverses to a stacked label:value Card list
 * below `md` (the A3 reversal — DESIGN.md §8.3/§8.5; ADR-0018).
 *
 *  - role chips are semantic `UserRoleBadge`s (color token + paired icon,
 *    never color alone — DESIGN.md §1.3 / §5); a multi-role user shows several
 *  - a suspended vendor surfaces a destructive "Suspended" badge inline
 *  - the manage/view-profile link points at the existing admin detail route
 *    for vendors (`/admin/vendors/[id]`); there is no customer admin detail
 *    page today, so non-vendor rows have no manage target (the cell shows "—")
 *  - `data-user-id` is preserved per row via `rowProps` so the admin E2E
 *    selectors survive the reversal
 *
 * The presentational table is split out so it is unit-testable in isolation;
 * the page owns the data load + permission gate. There is NO destructive
 * suspend control on this LIST — suspend lives on the vendor [id] detail
 * (#101) and is reached via the Manage link, so the money/KYC-adjacent flow is
 * never duplicated here. Because non-vendor rows have no detail route, the row
 * itself is NOT a link (no `rowHref`); the Manage link lives in the Actions
 * column for vendor rows only.
 */
function initials(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.trim() || '?'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

const COLUMNS: ResponsiveTableColumn<UsersListRow>[] = [
  {
    key: 'user',
    header: 'User',
    primary: true,
    cell: (u) => (
      <span className="inline-flex items-center gap-3 font-medium">
        <Avatar className="size-8">
          {u.image ? <AvatarImage src={u.image} alt="" /> : null}
          <AvatarFallback className="text-xs">
            {initials(u.name, u.email)}
          </AvatarFallback>
        </Avatar>
        <span>{u.name ?? '—'}</span>
      </span>
    ),
  },
  {
    key: 'email',
    header: 'Email',
    cell: (u) => (
      <span className="text-sm text-muted-foreground">{u.email ?? '—'}</span>
    ),
  },
  {
    key: 'roles',
    header: 'Roles',
    cell: (u) => (
      <div className="flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
        {u.roles.length === 0 ? (
          <Badge variant="outline">No role</Badge>
        ) : (
          u.roles.map((role) => <UserRoleBadge key={role} role={role} />)
        )}
        {u.vendorSuspended ? (
          <Badge variant="destructive">Suspended</Badge>
        ) : null}
      </div>
    ),
  },
  {
    key: 'actions',
    header: 'Actions',
    align: 'right',
    cell: (u) =>
      u.roles.includes('vendor') ? (
        <Link
          href={`/admin/vendors/${u.id}`}
          className="text-sm font-medium text-primary hover:underline"
        >
          Manage
        </Link>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      ),
  },
]

export function UsersTable({ rows }: { rows: UsersListRow[] }) {
  return (
    <ResponsiveTable<UsersListRow>
      columns={COLUMNS}
      rows={rows}
      getRowKey={(u) => u.id}
      rowProps={(u) => ({ 'data-user-id': u.id })}
      caption="All platform users with their derived roles"
      empty="No users found."
    />
  )
}
