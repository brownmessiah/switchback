import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { AdminStatusBadge } from '@/app/admin/_components/admin-status-badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { db } from '@/db/client'
import { adminProfiles } from '@/db/schema/admin-profiles'
import { users } from '@/db/schema/users'
import { auth } from '@/lib/auth'
import { ADMIN_PERMISSIONS, requirePermission } from '@/lib/auth/permissions'

import { InviteSubAdminForm } from './invite-form'
import { SubAdminActionsCell } from './sub-admin-actions-cell'

// ── Helpers ────────────────────────────────────────────────────────

function formatDate(d: Date | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function isFullAdmin(permissions: string[]): boolean {
  return ADMIN_PERMISSIONS.every((p) => permissions.includes(p))
}

function permissionLabel(p: string): string {
  return p.replace(/_/g, ' ')
}

// ── Page ───────────────────────────────────────────────────────────

export default async function SubAdminsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()
  await requirePermission(db, session.user.id, 'sub_admins')

  // Fetch all admin profiles with user info
  const admins = await db
    .select({
      userId: adminProfiles.userId,
      permissions: adminProfiles.permissions,
      invitedByUserId: adminProfiles.invitedByUserId,
      createdAt: adminProfiles.createdAt,
      email: users.email,
      name: users.name,
    })
    .from(adminProfiles)
    .innerJoin(users, eq(adminProfiles.userId, users.id))
    .orderBy(adminProfiles.createdAt)

  const fullAdmins = admins.filter((a) => isFullAdmin(a.permissions))
  const subAdmins = admins.filter((a) => !isFullAdmin(a.permissions))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-h1 font-semibold tracking-tight">
          Sub-Admin Management
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {admins.length} admin{admins.length === 1 ? '' : 's'} &middot;{' '}
          {fullAdmins.length} full admin{fullAdmins.length === 1 ? '' : 's'} &middot;{' '}
          {subAdmins.length} sub-admin{subAdmins.length === 1 ? '' : 's'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-h3">Invite Sub-Admin</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteSubAdminForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-h3">Current Admins</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <caption className="sr-only">
                Admins and sub-admins with their permission subset and status
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">User</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Permission subset</TableHead>
                  <TableHead scope="col">Since</TableHead>
                  <TableHead scope="col" className="text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No admins found.
                    </TableCell>
                  </TableRow>
                )}
                {admins.map((admin) => {
                  const isFull = isFullAdmin(admin.permissions)
                  const isSelf = admin.userId === session.user.id

                  return (
                    <TableRow key={admin.userId} className="hover:bg-muted/50">
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">
                            {admin.name ?? admin.email ?? admin.userId}
                          </p>
                          {admin.email && admin.name && (
                            <p className="text-xs text-muted-foreground">
                              {admin.email}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <span data-testid="subadmin-status-badge">
                            <AdminStatusBadge
                              status={isFull ? 'active' : 'restricted'}
                              label={isFull ? 'Full Admin' : 'Sub-Admin'}
                            />
                          </span>
                          {isSelf && (
                            <Badge variant="outline" className="text-2xs">
                              You
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[320px]">
                        {isFull ? (
                          <span className="text-sm text-muted-foreground">
                            All {ADMIN_PERMISSIONS.length} permissions
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {admin.permissions.map((p) => (
                              <Badge key={p} variant="outline" className="text-2xs">
                                {permissionLabel(p)}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">
                        {formatDate(admin.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {isSelf ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <SubAdminActionsCell
                            userId={admin.userId}
                            email={admin.email}
                            name={admin.name}
                            permissions={admin.permissions}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
