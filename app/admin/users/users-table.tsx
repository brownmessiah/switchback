import Link from 'next/link'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { UsersListRow } from '@/lib/admin/users-list'

import { UserRoleBadge } from './user-role-badge'

/**
 * #17 — the general user-management LIST as a DESIGN.md §4 A3 table.
 *
 *  - role chips are semantic `UserRoleBadge`s (color token + paired icon,
 *    never color alone — DESIGN.md §1.3 / §5); a multi-role user shows several
 *  - a suspended vendor surfaces a destructive "Suspended" badge inline
 *  - the manage/view-profile link points at the existing admin detail route
 *    for vendors (`/admin/vendors/[id]`); there is no customer admin detail
 *    page today, so non-vendor rows have no manage target (the cell shows "—")
 *
 * The presentational table is split out so it is unit-testable in isolation;
 * the page owns the data load + permission gate. There is NO destructive
 * suspend control on this LIST — suspend lives on the vendor [id] detail
 * (#101) and is reached via the Manage link, so the money/KYC-adjacent flow is
 * never duplicated here.
 */
function initials(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.trim() || '?'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

export function UsersTable({ rows }: { rows: UsersListRow[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <caption className="sr-only">All platform users with their derived roles</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">User</TableHead>
                <TableHead scope="col">Email</TableHead>
                <TableHead scope="col">Roles</TableHead>
                <TableHead scope="col" className="w-24 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((u) => {
                  const isVendor = u.roles.includes('vendor')
                  return (
                    <TableRow key={u.id} data-user-id={u.id} className="hover:bg-muted/50">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            {u.image ? <AvatarImage src={u.image} alt="" /> : null}
                            <AvatarFallback className="text-xs">
                              {initials(u.name, u.email)}
                            </AvatarFallback>
                          </Avatar>
                          <span>{u.name ?? '—'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.email ?? '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {u.roles.length === 0 ? (
                            <Badge variant="outline">No role</Badge>
                          ) : (
                            u.roles.map((role) => <UserRoleBadge key={role} role={role} />)
                          )}
                          {u.vendorSuspended ? (
                            <Badge variant="destructive">Suspended</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {isVendor ? (
                          <Link
                            href={`/admin/vendors/${u.id}`}
                            className="text-sm font-medium text-primary hover:underline"
                          >
                            Manage
                          </Link>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
